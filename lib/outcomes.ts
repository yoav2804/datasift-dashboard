// READ ONLY: reads GHL opportunities, records which funnel steps each contact has reached,
// and ties each contact back to the property / pull / list / ZIP it came from.
import { ghlGet } from "./ghl";
import { select, upsert } from "./sb";

// Funnel steps reached, by pipeline stage name. Steps accumulate: once reached, never removed.
const STEP: Record<string, string[]> = {
  "Initial Outreach": ["contacted"],
  "Unresponsive": ["contacted"],
  "Responded": ["contacted", "replied"],
  "Not Interested": ["contacted", "replied"],
  "Property Sold": ["contacted", "replied"],
  "Attention": ["contacted", "replied", "interested"],
  "Processing - A Leads": ["contacted", "replied", "interested"],
  "Not Ready F/U": ["contacted", "replied", "interested"],
  "Qualified: Send to Capital": ["contacted", "replied", "interested", "qualified"],
  "Transferred": ["contacted", "replied", "interested", "qualified"],
  "Wrong Number": ["contacted", "replied", "wrong_number"],
  "DNC": ["contacted", "replied", "opt_out"],
  // older Texting Leads pipeline
  "New reply": ["contacted", "replied"],
  "Not interested": ["contacted", "replied"],
  "Follow up": ["contacted", "replied", "interested"],
  "Potential Lead": ["contacted", "replied", "interested"],
  "Qualified": ["contacted", "replied", "interested", "qualified"],
  "DND/opt out": ["contacted", "replied", "opt_out"],
};
const SELLER_PIPELINES = ["Initial Engagement", "Texting Leads"];

export async function syncOutcomes() {
  const loc = process.env.GHL_LOCATION_ID!;
  const pls = (await ghlGet("opportunities/pipelines", { locationId: loc })).pipelines || [];
  const stage = new Map<string, { pipeline: string; stage: string }>();
  for (const p of pls) if (SELLER_PIPELINES.includes(p.name)) for (const s of p.stages) stage.set(s.id, { pipeline: p.name, stage: s.name });

  const opps: any[] = [];
  for (let page = 1; page < 500; page++) {
    const d = await ghlGet("opportunities/search", { location_id: loc, limit: 100, page });
    const o = d.opportunities || []; opps.push(...o);
    if (o.length < 100) break;
  }

  // attribution: contact -> property we exported (only if the contact was created after our export)
  const exported = await select("export_rows", { bucket: "eq.new", select: "phone,property_id,batch_id" });
  const batches = new Map((await select("export_batches", { select: "batch_id,pull_id,created_at" })).map((b: any) => [b.batch_id, b]));
  const byPhone = new Map<string, any>();
  for (const e of exported) {
    const b: any = batches.get(e.batch_id); if (!b) continue;
    const prev = byPhone.get(e.phone);
    if (!prev || b.created_at < prev.at) byPhone.set(e.phone, { property_id: e.property_id, pull_id: b.pull_id, at: b.created_at });
  }
  const contactIds = Array.from(new Set(opps.map((o) => o.contactId)));
  const cPhones = new Map<string, string[]>(), cAdded = new Map<string, string>(), cWrong = new Set<string>();
  for (let i = 0; i < contactIds.length; i += 150) {
    const part = contactIds.slice(i, i + 150);
    for (const r of await select("ghl_contact_phones", { contact_id: `in.(${part.join(",")})`, select: "phone,contact_id" }))
      cPhones.set(r.contact_id, [...(cPhones.get(r.contact_id) || []), r.phone]);
    for (const r of await select("ghl_contacts", { contact_id: `in.(${part.join(",")})`, select: "contact_id,date_added,raw,tags" })) {
      cAdded.set(r.contact_id, r.date_added);
      if ((r.tags || []).some((t: string) => /wrong number/i.test(t))) cWrong.add(r.contact_id);  // tag stays even after the phone rotates
      if (r.raw?.dsPropertyId) cPhones.set(r.contact_id, [`PID:${r.raw.dsPropertyId}`, ...(cPhones.get(r.contact_id) || [])]);
    }
  }
  const pulls = new Map((await select("pull_tasks", { select: "pull_id,profile_id" })).map((p: any) => [p.pull_id, p]));
  const attr = (cid: string) => {
    const added = cAdded.get(cid) || "";
    for (const ph of cPhones.get(cid) || []) {
      if (ph.startsWith("PID:")) { const pid = ph.slice(4); const hit = Array.from(byPhone.values()).find((v) => v.property_id === pid); if (hit) return hit; continue; }
      const hit = byPhone.get(ph);
      if (hit && added >= hit.at.slice(0, 10)) return hit;  // imported after our export = came from our pull
    }
    return null;
  };

  const rows: any[] = [];
  for (const o of opps) {
    const st = stage.get(o.pipelineStageId); if (!st) continue;
    const a = attr(o.contactId); if (!a) continue;   // only count contacts that came from our pulls
    const steps = new Set(STEP[st.stage] || ["contacted"]);
    if (o.status === "won") steps.add("qualified");
    if (cWrong.has(o.contactId)) { steps.add("contacted"); steps.add("replied"); steps.add("wrong_number"); }
    for (const ev of Array.from(steps)) rows.push({ ghl_location_id: loc, ghl_contact_id: o.contactId, ghl_opportunity_id: o.id, property_id: a.property_id,
      pull_id: a.pull_id, primary_profile_id: (pulls.get(a.pull_id) as any)?.profile_id || null, event: ev, pipeline: st.pipeline, stage: st.stage,
      occurred_at: o.lastStageChangeAt || o.updatedAt || o.createdAt });
  }
  await upsert("outcomes", rows, { onConflict: "ghl_opportunity_id,event", ignore: true });  // first time a step is reached is kept
  return { opportunities: opps.length, attributed_events: rows.length };
}

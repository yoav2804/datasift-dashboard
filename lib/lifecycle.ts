// Data lifecycle per list / market / source / skip trace provider.
// Processing numbers come from the Data Manager; everything after export comes ONLY from platform data
// (GHL contacts, GHL pipeline, message events). Anything not confirmed is shown as waiting / missing / not connected.
import { select } from "./sb";
import { marketShort } from "./lists";

export type By = "list" | "market" | "source" | "provider";
export type Stage = {
  uploads: number; properties: number; received: number; removed: number; removedWhy: Record<string, number>;
  inTexting: number; repeated: number; prepared: number; imported: number; waiting: number; missing: number;
  msgNumbers: number; msgSent: number; delivered: number; failed: number; msgReplied: number;
  contacted: Set<string>; replied: Set<string>; wrong: Set<string>; qualified: Set<string>;
  q: { n: number; unique: number; repeated: number; inDb: number; inTexting: number; shared: number; diffOwner: number };
};
const blank = (): Stage => ({ uploads: 0, properties: 0, received: 0, removed: 0, removedWhy: {}, inTexting: 0, repeated: 0, prepared: 0, imported: 0, waiting: 0, missing: 0,
  msgNumbers: 0, msgSent: 0, delivered: 0, failed: 0, msgReplied: 0, contacted: new Set(), replied: new Set(), wrong: new Set(), qualified: new Set(),
  q: { n: 0, unique: 0, repeated: 0, inDb: 0, inTexting: 0, shared: 0, diffOwner: 0 } });

export async function loadLifecycle(by: By) {
  const [ups, batches, counts, reasons, msgs, tasks, profiles, sources, markets, outcomes, msgAny] = await Promise.all([
    select("uploads", { status: "eq.confirmed", select: "upload_id,pull_id,report,skip_trace_provider,original_source_id" }),
    select("export_batches", { approved: "eq.true", voided_at: "is.null", select: "batch_id,upload_id,pull_id,imported_to_ghl_at" }),
    select("export_bucket_counts", {}), select("export_excluded_reasons", {}), select("message_counts_by_batch", {}),
    select("pull_tasks", { select: "pull_id,profile_id,market_fips,zip_group" }), select("profiles", { select: "profile_id,name" }),
    select("sources", { select: "source_id,name" }), select("markets", { select: "fips,name" }),
    select("outcomes", { select: "property_id,pull_id,event" }), select("message_events", { select: "message_id", limit: "1" })]);
  const tk = new Map(tasks.map((t: any) => [t.pull_id, t])); const pf = new Map(profiles.map((p: any) => [p.profile_id, p.name]));
  const sn = new Map(sources.map((s: any) => [s.source_id, s.name])); const mn = new Map(markets.map((m: any) => [m.fips, m.name]));
  const upOf = new Map(ups.map((u: any) => [u.upload_id, u])); const upByPull = new Map(ups.map((u: any) => [u.pull_id, u]));
  const keyOf = (pullId: string, u: any) => { const t: any = tk.get(pullId) || {};
    if (by === "market") return (mn.get(t.market_fips) as string) || "Other";
    if (by === "source") return (sn.get(u?.original_source_id) as string) || u?.original_source_id || "Unknown";
    if (by === "provider") return u?.skip_trace_provider || "Unknown";
    return `${pf.get(t.profile_id) || "no list"} (${marketShort(t.market_fips)})${t.zip_group && t.zip_group !== "ALL" ? ` · ZIP group ${t.zip_group}` : ""}`; };
  const groups = new Map<string, Stage>(); const get = (k: string) => { if (!groups.has(k)) groups.set(k, blank()); return groups.get(k)!; };
  const bKey = new Map<string, string>();
  for (const b of batches as any[]) {
    const u: any = upOf.get(b.upload_id) || upByPull.get(b.pull_id); const k = keyOf(b.pull_id, u); bKey.set(b.batch_id, k);
    const G = get(k), r = u?.report || {};
    G.uploads++; G.properties += r.unique_properties || 0;
    G.received += r.total_phone_entries ?? ((r.property_phone_pairs || 0) + (r.invalid_numbers || 0));
    if (r.unique_phone_numbers != null) { const q = G.q; q.n++; q.unique += r.unique_phone_numbers; q.repeated += r.numbers_on_2plus_properties_in_list || 0;
      q.inDb += r.numbers_already_in_our_database || 0; q.inTexting += r.numbers_already_in_texting || 0; q.shared += r.numbers_shared_with_other_property || 0; q.diffOwner += r.numbers_shared_different_owner || 0; }
  }
  const imported = new Set(batches.filter((b: any) => b.imported_to_ghl_at).map((b: any) => b.batch_id));
  for (const c of counts as any[]) { const k = bKey.get(c.batch_id); if (!k) continue; const G = get(k);
    if (c.bucket === "new") { G.prepared += c.phones; G.imported += c.imported_phones; if (imported.has(c.batch_id)) G.missing += c.phones - c.imported_phones; else G.waiting += c.phones; }
    else if (c.bucket === "in_texting" || c.bucket === "existing") G.inTexting += c.phones;   // "existing" = older uploads
    else if (c.bucket === "dup_in_list") G.repeated += c.phones; }
  for (const r of reasons as any[]) { const k = bKey.get(r.batch_id); if (!k) continue; const G = get(k); G.removed += r.phones; G.removedWhy[r.reason] = (G.removedWhy[r.reason] || 0) + r.phones; }
  for (const m of msgs as any[]) { const k = bKey.get(m.batch_id); if (!k) continue; const G = get(k);
    G.msgNumbers += m.numbers_messaged; G.msgSent += m.messages_sent; G.delivered += m.messages_delivered; G.failed += m.messages_failed; G.msgReplied += m.numbers_replied; }
  for (const o of outcomes as any[]) { const u = upByPull.get(o.pull_id); if (!o.property_id || (!u && !tk.has(o.pull_id))) continue; const G = get(keyOf(o.pull_id, u));
    if (o.event === "contacted") G.contacted.add(o.property_id); if (o.event === "replied") G.replied.add(o.property_id);
    if (o.event === "wrong_number") G.wrong.add(o.property_id); if (o.event === "qualified") G.qualified.add(o.property_id); }
  const rows = Array.from(groups.entries()).sort((a, b) => b[1].received - a[1].received);
  const total = blank(); for (const [, G] of rows) for (const f of ["uploads", "properties", "received", "removed", "inTexting", "repeated", "prepared", "imported", "waiting", "missing", "msgNumbers", "msgSent", "delivered", "failed", "msgReplied"] as const) (total as any)[f] += G[f];
  for (const [, G] of rows) { for (const s of ["contacted", "replied", "wrong", "qualified"] as const) G[s].forEach((x) => total[s].add(x));
    for (const [w, n] of Object.entries(G.removedWhy)) total.removedWhy[w] = (total.removedWhy[w] || 0) + n;
    for (const f of Object.keys(total.q) as (keyof Stage["q"])[]) total.q[f] += G.q[f]; }
  return { rows, total, messagesConnected: msgAny.length > 0 };
}

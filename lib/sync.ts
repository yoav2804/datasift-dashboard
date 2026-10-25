// READ ONLY copy of GHL contacts + phones into Supabase.
import { ghlGet } from "./ghl";
import { upsert, update } from "./sb";
import { norm } from "./phones";

export async function syncGhl() {
  const loc = process.env.GHL_LOCATION_ID!;
  const cf = await ghlGet(`locations/${loc}/customFields`, {});
  const phoneFields: Record<string, string> = {};
  let dsPid = "";
  for (const f of cf.customFields || []) { if (["Phone 2", "Phone 3", "Phone 4"].includes(f.name)) phoneFields[f.id] = f.name; if (f.name === "DS Property ID") dsPid = f.id; }
  const contacts: any[] = [], links: any[] = [];
  let afterId: string | undefined, after: string | undefined;
  for (;;) {
    const d = await ghlGet("contacts/", { locationId: loc, limit: 100, startAfterId: afterId, startAfter: after });
    const batch = d.contacts || [];
    if (!batch.length) break;
    for (const c of batch) {
      contacts.push({ contact_id: c.id, location_id: loc, name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" "), dnd: !!c.dnd, tags: c.tags || [],
        date_added: c.dateAdded, synced_at: new Date().toISOString(),
        raw: { address: [c.address1, c.city, c.state, c.postalCode].filter(Boolean).join(" "), address1: c.address1, postalCode: c.postalCode, firstName: c.firstName, lastName: c.lastName,
          dsPropertyId: (c.customFields || []).find((f: any) => f.id === dsPid)?.value || null } });
      const seen = new Set<string>();
      const vals: [string, any][] = [["phone", c.phone], ...(c.customFields || []).filter((f: any) => phoneFields[f.id]).map((f: any) => [phoneFields[f.id], f.value] as [string, any])];
      for (const [field, v] of vals) { const n = norm(v); if (n && !seen.has(n)) { seen.add(n); links.push({ phone: n, contact_id: c.id, field }); } }
    }
    afterId = d.meta?.startAfterId; after = d.meta?.startAfter;
    if (!afterId || batch.length < 100) break;
  }
  await upsert("ghl_contacts", contacts, { onConflict: "contact_id" });
  await upsert("ghl_contact_phones", links, { onConflict: "phone,contact_id" });
  await update("markets", { fips: "eq.29510" }, { notes: `Pilot. Last GHL sync ${new Date().toISOString().slice(0, 16)} UTC, ${contacts.length} contacts.` }).catch(() => {});
  return { contacts: contacts.length, phones: links.length, dnd: contacts.filter((c) => c.dnd).length };
}

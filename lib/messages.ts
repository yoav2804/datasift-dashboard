// READ ONLY: copies GHL SMS message records (direction, status, error, time, numbers) into message_events.
// Message text is NOT stored. Continues from the last synced message, within a time budget.
import { ghlGet } from "./ghl";
import { select, upsert } from "./sb";
import { norm } from "./phones";

export async function syncMessages(budgetMs = 240_000) {
  const loc = process.env.GHL_LOCATION_ID!;
  const t0 = Date.now();
  const last = (await select("message_events", { platform: "eq.ghl", order: "sent_at.desc", limit: "1", select: "sent_at" }))[0]?.sent_at;
  // re-read the last day too, so late status updates (sent -> delivered/failed) are picked up
  const startDate = last ? new Date(Date.parse(last) - 864e5).toISOString() : "2024-01-01T00:00:00.000Z";
  let cursor: string | undefined, pages = 0, saved = 0, done = false;
  while (Date.now() - t0 < budgetMs) {
    const d = await ghlGet("conversations/messages/export", { locationId: loc, channel: "SMS", limit: 100, sortBy: "dateAdded", sortOrder: "asc", startDate, cursor });
    const ms = d.messages || []; pages++;
    const rows = ms.map((m: any) => {
      const out = m.direction === "outbound";
      return { platform: "ghl", message_id: m.id, contact_id: m.contactId || null, phone: norm(out ? m.to : m.from) || null, direction: m.direction || null,
        status: m.status || null, error: m.error ? String(typeof m.error === "object" ? JSON.stringify(m.error) : m.error).slice(0, 500) : (m.meta?.error ? String(m.meta.error).slice(0, 500) : null),
        sent_at: m.dateAdded || null, raw: { type: m.type, messageType: m.messageType, source: m.source || null, conversationId: m.conversationId || null }, synced_at: new Date().toISOString() };
    });
    if (rows.length) { await upsert("message_events", rows, { onConflict: "platform,message_id" }); saved += rows.length; }
    cursor = d.nextCursor || undefined;
    if (!cursor || !ms.length) { done = true; break; }
  }
  return { messages_saved: saved, message_pages: pages, messages_caught_up: done, messages_from: startDate };
}

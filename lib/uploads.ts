// Draft -> confirmed / voided. Supabase only, never GHL.
// Nothing is deleted: undone rows get voided_at (or status "voided") and every page ignores them.
import { select, upsert, update } from "./sb";

// Mark everything one pull wrote as voided, so it stops counting anywhere.
// Only rows this pull CREATED carry its pull_id, so links that existed before are not touched.
export async function voidPullRows(pullId: string, at: string) {
  await update("property_pulls", { pull_id: `eq.${pullId}`, voided_at: "is.null" }, { voided_at: at });
  await update("property_profiles", { first_pull_id: `eq.${pullId}`, voided_at: "is.null" }, { voided_at: at });
  await update("property_phones", { first_pull_id: `eq.${pullId}`, voided_at: "is.null" }, { voided_at: at });
  await update("review_cases", { pull_id: `eq.${pullId}`, status: "neq.voided" }, { status: "voided", decided_at: at });
}

async function loadDraft(uploadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId || "")) throw new Error("Bad upload id.");
  const [u] = await select("uploads", { upload_id: `eq.${uploadId}` });
  if (!u) throw new Error("Upload not found.");
  if (u.status !== "draft") throw new Error(`This upload is ${u.status || "not a draft"}, so it can't be changed here.`);
  const [pt] = await select("pull_tasks", { pull_id: `eq.${u.pull_id}` });
  if (!pt) throw new Error("The pull for this upload was not found.");
  return { u, pt };
}

// Undo a draft: the wrong list link, phone history, review cases and export rows stop counting,
// the pull goes back on the calendar, and the same file can be processed again under the right pull.
export async function undoUpload(uploadId: string, reason?: string) {
  const { u, pt } = await loadDraft(uploadId);
  const at = new Date().toISOString();
  await voidPullRows(u.pull_id, at);
  await update("export_batches", { upload_id: `eq.${uploadId}` }, { voided_at: at });
  const backTo = !pt.profile_id && /created at upload/.test(pt.notes || "") ? "cancelled" : "planned";
  await update("pull_tasks", { pull_id: `eq.${u.pull_id}` }, { status: backTo });
  await update("uploads", { upload_id: `eq.${uploadId}` }, { status: "voided", voided_at: at, void_reason: reason || null, voided_sha256: u.file_sha256, file_sha256: null });
  return { ok: true, pull_status: backTo };
}

// Confirm a draft: the GHL CSV unlocks, the pull counts as done, and the next pull of the list is scheduled.
export async function confirmUpload(uploadId: string) {
  const { u, pt } = await loadDraft(uploadId);
  const rep = u.report || {};
  if (!rep.files) throw new Error("This draft has no output files. Undo it and process the file again.");
  const at = new Date().toISOString();
  await update("export_batches", { upload_id: `eq.${uploadId}` }, { approved: true, approved_at: at });
  await update("pull_tasks", { pull_id: `eq.${u.pull_id}` }, { status: "processed", completed_date: at.slice(0, 10), rows_pulled: rep.rows_in_file ?? null,
    net_new_properties: rep.net_new_properties ?? null, contacts_generated: rep.import_rows ?? null, next_pull_date: rep.next_pull_date || null });
  if (pt.profile_id && rep.next_pull_date)
    await upsert("pull_tasks", [{ pull_id: `${u.pull_id.replace(/-\d{8}$/, "")}-${String(rep.next_pull_date).replace(/-/g, "")}`, market_fips: pt.market_fips, profile_id: pt.profile_id,
      zip_group: pt.zip_group, zips: pt.zips, source_id: pt.source_id, priority: pt.priority, planned_date: rep.next_pull_date, status: "planned", notes: `recycle: ${rep.refresh_note || ""}` }],
      { onConflict: "pull_id", ignore: true });
  await update("uploads", { upload_id: `eq.${uploadId}` }, { status: "confirmed", confirmed_at: at });
  return { ok: true, next_pull_date: rep.next_pull_date || null };
}

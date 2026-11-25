-- 2026-11-25 · Undo for uploads, step 2 of 2. Run after step 1. Safe to run again (re-run right before merging to main).
-- Marks existing uploads so current stats are kept. Changes flags only; nothing is deleted.
-- Reviewed with Johnny: the 4 uploads below failed at the properties step (error 21000, fixed Oct 27),
-- wrote no property rows, and each of their pulls was later processed successfully by another upload.

-- 1. link each export batch to the upload that made it (same output files = same run)
update export_batches b set upload_id = u.upload_id
from uploads u where b.upload_id is null and u.report->'files' = b.counts->'files';

-- 2. the 4 failed uploads: failed, never confirmed
update uploads set status = 'failed'
where status is null and upload_id in ('53ac2825-0271-48e8-b538-354a2b60aa8b','ed4e4d15-2190-4f06-9531-5d135bda064b',
                                       '42cbec97-4d80-4d0b-869c-5e6cd062184d','052b0e0e-2eb2-450e-98c6-0a8f390a06b9');

-- 3. every upload that finished and has its export batch: confirmed
update uploads u set status = 'confirmed', confirmed_at = coalesce(u.confirmed_at, u.uploaded_at)
where u.status is null and u.report ? 'files' and exists (select 1 from export_batches b where b.upload_id = u.upload_id);

-- 4. their export batches: approved
update export_batches set approved = true, approved_at = coalesce(approved_at, created_at)
where approved = false and voided_at is null and upload_id in (select upload_id from uploads where status = 'confirmed');

-- check: expect confirmed 21, failed 4, nothing blank
select coalesce(u.status, '(blank)') as status, count(*) as uploads,
  count(*) filter (where exists (select 1 from export_batches b where b.upload_id = u.upload_id and b.approved)) as with_approved_batch
from uploads u group by 1 order by 1;

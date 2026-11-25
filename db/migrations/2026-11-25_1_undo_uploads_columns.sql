-- 2026-11-25 · Undo for uploads, step 1 of 2.
-- ADDS columns and indexes only. Nothing existing is changed or removed. Safe to run more than once.

alter table uploads add column if not exists status text;            -- draft | confirmed | voided | failed
alter table uploads add column if not exists storage_path text;      -- where the original file is stored, for "process again"
alter table uploads add column if not exists confirmed_at timestamptz;
alter table uploads add column if not exists voided_at timestamptz;
alter table uploads add column if not exists void_reason text;
alter table uploads add column if not exists voided_sha256 text;     -- fingerprint kept here so the same file can be uploaded again

alter table export_batches add column if not exists upload_id uuid;
alter table export_batches add column if not exists voided_at timestamptz;

alter table property_pulls    add column if not exists voided_at timestamptz;
alter table property_profiles add column if not exists voided_at timestamptz;
alter table property_phones   add column if not exists voided_at timestamptz;

create index if not exists uploads_status               on uploads (status);
create index if not exists export_batches_upload        on export_batches (upload_id);
create index if not exists property_pulls_pull          on property_pulls (pull_id);
create index if not exists property_profiles_first_pull on property_profiles (first_pull_id);
create index if not exists property_phones_first_pull   on property_phones (first_pull_id);
create index if not exists review_cases_pull            on review_cases (pull_id);

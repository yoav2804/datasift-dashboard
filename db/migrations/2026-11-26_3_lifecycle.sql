-- 2026-11-26 · Data lifecycle: what actually happened to every exported number, confirmed from the platforms.
-- Adds columns, one table and one function. Nothing existing is changed or removed.

-- 1. each exported number can be confirmed as imported (found on a GHL contact created after the export)
alter table export_rows add column if not exists row_id bigserial;
alter table export_rows add column if not exists ghl_contact_id text;
alter table export_rows add column if not exists imported_at timestamptz;
create unique index if not exists export_rows_row_id on export_rows (row_id);

-- 2. messages from the texting platforms (GHL today, Textivo later). Filled only from confirmed platform data.
create table if not exists message_events (
  platform     text not null,                 -- ghl | textivo
  message_id   text not null,
  contact_id   text,
  phone        text,
  direction    text,                          -- outbound | inbound
  status       text,                          -- as the platform reports it: delivered, failed, undelivered, sent, ...
  error        text,
  sent_at      timestamptz,
  raw          jsonb,
  synced_at    timestamptz not null default now(),
  primary key (platform, message_id)
);
create index if not exists message_events_phone on message_events (phone);

-- 3. called after every GHL sync: confirm imports. Evidence only:
--    a number counts as imported when it is on a GHL contact created after the export (1 day of slack for time zones).
--    A batch counts as imported once at least one of its numbers is confirmed; the time is the first confirmed contact.
create or replace function refresh_import_status() returns json language plpgsql as $$
declare n_rows int; n_batches int;
begin
  with m as (
    select r.row_id, min(gp.contact_id) as contact_id, min(c.date_added) as added
    from export_rows r
    join export_batches b on b.batch_id = r.batch_id and b.approved and b.voided_at is null
    join ghl_contact_phones gp on gp.phone = r.phone
    join ghl_contacts c on c.contact_id = gp.contact_id
    where r.bucket = 'new' and r.imported_at is null and c.date_added >= b.created_at - interval '1 day'
    group by r.row_id)
  update export_rows r set ghl_contact_id = m.contact_id, imported_at = m.added from m where r.row_id = m.row_id;
  get diagnostics n_rows = row_count;

  with f as (select batch_id, min(imported_at) as first from export_rows where imported_at is not null group by batch_id)
  update export_batches b set imported_to_ghl_at = f.first from f where b.batch_id = f.batch_id and b.imported_to_ghl_at is null;
  get diagnostics n_batches = row_count;
  return json_build_object('rows_confirmed', n_rows, 'batches_confirmed', n_batches);
end $$;

-- 4. counts per export batch, so pages don't load every row
create or replace view export_bucket_counts as
  select batch_id, bucket, count(distinct phone) as phones, count(distinct property_id) as props,
         count(distinct phone) filter (where imported_at is not null) as imported_phones,
         count(distinct property_id) filter (where imported_at is not null) as imported_props
  from export_rows group by batch_id, bucket;
create or replace view export_excluded_reasons as
  select batch_id, case when reason like 'non-residential%' then 'non-residential' else reason end as reason, count(distinct phone) as phones
  from export_rows where bucket = 'excluded' group by 1, 2;
-- messages to numbers we exported, per batch (empty until a platform's messages are synced)
create or replace view message_counts_by_batch as
  select r.batch_id,
         count(distinct m.phone) filter (where m.direction = 'outbound') as numbers_messaged,
         count(*) filter (where m.direction = 'outbound') as messages_sent,
         count(*) filter (where m.direction = 'outbound' and m.status = 'delivered') as messages_delivered,
         count(*) filter (where m.direction = 'outbound' and m.status in ('failed', 'undelivered')) as messages_failed,
         count(distinct m.phone) filter (where m.direction = 'inbound') as numbers_replied
  from export_rows r join message_events m on m.phone = r.phone and m.sent_at >= r.imported_at
  where r.bucket = 'new' and r.imported_at is not null group by r.batch_id;

select refresh_import_status();

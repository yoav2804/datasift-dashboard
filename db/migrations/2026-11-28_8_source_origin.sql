-- 2026-11-28 · Optional: where each source's data originally comes from, and how it reaches us.
-- Not required for the Tracker's "Where our data comes from" table: without it, lib/origin.ts infers the origin from the source id and name.
-- Adds 2 nullable columns. Nothing is updated or deleted.
alter table sources add column if not exists origin_type text;   -- provider | municipality | county | court (overrides the inferred value)
alter table sources add column if not exists channel text;       -- propstream_export | datasift_export | records_request | court_search | notice_subscription | open_data_api

select source_id, name, kind, origin_type, channel from sources order by kind, source_id;

-- 2026-11-26 · Original data source + skip trace provider on every upload.
-- Adds 2 columns, then labels the existing uploads (all were skip traced by PropStream). Nothing is deleted.
alter table uploads add column if not exists skip_trace_provider text;   -- PropStream, BatchLeads, ...
alter table uploads add column if not exists original_source_id text;    -- sources.source_id: where the list came from

update uploads set skip_trace_provider = 'PropStream' where skip_trace_provider is null;
update uploads u set original_source_id = coalesce(t.source_id, p.source_id, 'PROPSTREAM')
from pull_tasks t left join profiles p on p.profile_id = t.profile_id
where u.pull_id = t.pull_id and u.original_source_id is null;

select skip_trace_provider, original_source_id, status, count(*) from uploads group by 1, 2, 3 order by 1, 2, 3;

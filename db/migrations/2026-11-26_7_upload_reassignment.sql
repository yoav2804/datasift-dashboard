-- 2026-11-26 · Correct a confirmed upload's list without losing history.
-- Adds an audit table and one function. The function only RE-LABELS rows (which pull / list they belong to);
-- it never deletes, never creates an export, and never changes what was sent or what happened in GHL.

create table if not exists upload_corrections (
  correction_id uuid primary key default gen_random_uuid(),
  corrected_at  timestamptz not null default now(),
  kind          text not null,           -- move | swap
  upload_id     uuid,                    -- the upload that was moved
  other_upload_id uuid,                  -- in a swap: the upload that came back the other way
  from_pull_id  text not null,
  to_pull_id    text not null,
  from_profile_id text, to_profile_id text,
  reason        text,
  details       jsonb                    -- row counts that were re-labelled
);
alter table upload_corrections enable row level security;

-- Swap everything that belongs to pull A with everything that belongs to pull B.
-- If B has nothing yet, this is a plain move of A's upload to B (and A goes back to planned).
create or replace function swap_pull_data(a text, b text, p_reason text) returns json language plpgsql as $$
declare pa text; pb text; ua uuid; ub uuid; d jsonb := '{}'; n int; tmp text;
begin
  if a = b then raise exception 'Pick a different pull.'; end if;
  select profile_id into pa from pull_tasks where pull_id = a;
  select profile_id into pb from pull_tasks where pull_id = b;
  if not found then raise exception 'Target pull % not found.', b; end if;
  if exists (select 1 from uploads where pull_id in (a, b) and status = 'draft') then raise exception 'One of these pulls has a draft. Confirm or undo it first.'; end if;
  select upload_id into ua from uploads where pull_id = a and status = 'confirmed' order by uploaded_at desc limit 1;
  select upload_id into ub from uploads where pull_id = b and status = 'confirmed' order by uploaded_at desc limit 1;
  if ua is null then raise exception 'Pull % has no confirmed upload to move.', a; end if;

  update uploads set pull_id = case pull_id when a then b else a end,
    report = case when report ? 'pull_id' then jsonb_set(report, '{pull_id}', to_jsonb(case pull_id when a then b else a end)) else report end
    where pull_id in (a, b);
  get diagnostics n = row_count; d := d || jsonb_build_object('uploads', n);
  update export_batches set pull_id = case pull_id when a then b else a end,
    counts = case when counts ? 'pull_id' then jsonb_set(counts, '{pull_id}', to_jsonb(case pull_id when a then b else a end)) else counts end
    where pull_id in (a, b);
  get diagnostics n = row_count; d := d || jsonb_build_object('export_batches', n);
  -- property rows go through a temporary pull, because a property can be on both pulls (same key on both sides)
  tmp := 'TMP-SWAP-' || replace(gen_random_uuid()::text, '-', '');
  insert into pull_tasks (pull_id, market_fips, status, notes) select tmp, market_fips, 'cancelled', 'temporary, used inside one correction' from pull_tasks where pull_id = a;
  update property_pulls set pull_id = tmp where pull_id = a;
  get diagnostics n = row_count; d := d || jsonb_build_object('property_pulls', n);
  update property_pulls set pull_id = a where pull_id = b;
  update property_pulls set pull_id = b where pull_id = tmp;
  delete from pull_tasks where pull_id = tmp;   -- the temporary row created above, nothing else
  -- list membership: a property linked to the wrong list moves to the right one; if it is already on the right list, the wrong link is voided (kept, ignored)
  update property_profiles pp set voided_at = now()
    where pp.first_pull_id in (a, b) and pp.voided_at is null
      and exists (select 1 from property_profiles x where x.property_id = pp.property_id and x.voided_at is null
                  and x.profile_id = case pp.first_pull_id when a then pb else pa end and x.first_pull_id not in (a, b));
  -- a property that is on both pulls already has both list links: those stay exactly as they are
  update property_profiles pp set profile_id = case pp.first_pull_id when a then pb else pa end, first_pull_id = case pp.first_pull_id when a then b else a end
    where pp.first_pull_id in (a, b) and pp.voided_at is null
      and not exists (select 1 from property_profiles y where y.property_id = pp.property_id and y.voided_at is null
                      and y.first_pull_id = case pp.first_pull_id when a then b else a end);
  get diagnostics n = row_count; d := d || jsonb_build_object('property_profiles', n);
  update property_phones set first_pull_id = case first_pull_id when a then b else a end where first_pull_id in (a, b);
  get diagnostics n = row_count; d := d || jsonb_build_object('property_phones', n);
  update property_owners set first_pull_id = case first_pull_id when a then b else a end where first_pull_id in (a, b);
  update review_cases set pull_id = case pull_id when a then b else a end where pull_id in (a, b);
  get diagnostics n = row_count; d := d || jsonb_build_object('review_cases', n);
  update outcomes set primary_profile_id = case pull_id when a then pb else pa end, pull_id = case pull_id when a then b else a end where pull_id in (a, b);
  get diagnostics n = row_count; d := d || jsonb_build_object('outcomes', n);
  -- the pulls' own results follow their upload
  with s as (select pull_id, status, completed_date, rows_pulled, net_new_properties, contacts_generated, next_pull_date from pull_tasks where pull_id in (a, b))
  update pull_tasks t set status = s.status, completed_date = s.completed_date, rows_pulled = s.rows_pulled, net_new_properties = s.net_new_properties,
    contacts_generated = s.contacts_generated, next_pull_date = s.next_pull_date
  from s where s.pull_id = case t.pull_id when a then b else a end and t.pull_id in (a, b);
  -- a pull with no confirmed upload left goes back to planned
  update pull_tasks set status = 'planned', completed_date = null, rows_pulled = null, net_new_properties = null, contacts_generated = null, next_pull_date = null
    where pull_id in (a, b) and not exists (select 1 from uploads u where u.pull_id = pull_tasks.pull_id and u.status = 'confirmed');

  insert into upload_corrections (kind, upload_id, other_upload_id, from_pull_id, to_pull_id, from_profile_id, to_profile_id, reason, details)
    values (case when ub is null then 'move' else 'swap' end, ua, ub, a, b, pa, pb, p_reason, d);
  return json_build_object('ok', true, 'kind', case when ub is null then 'move' else 'swap' end, 'moved_upload', ua, 'swapped_upload', ub, 'rows', d);
end $$;

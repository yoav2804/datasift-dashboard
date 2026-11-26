-- 2026-11-26 · Smart recycling + ZIP coverage. Functions and views only. Nothing is changed or removed.

-- the phone numbers on one PropStream row (raw), as sorted 10-digit strings
create or replace function raw_phones(r jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct right(d, 10) order by right(d, 10)), '{}')
  from (select regexp_replace(coalesce(r->>('Phone ' || i), ''), '\D', '', 'g') as d from generate_series(1, 5) i) x
  where length(d) >= 10
$$;

-- every confirmed pull of every list (list = DataSift profile + ZIP group), with the pull before it
create or replace view list_pulls with (security_invoker = on) as
  select t.pull_id, t.profile_id, coalesce(t.zip_group, 'ALL') as zip_group, t.market_fips, u.upload_id, u.uploaded_at, u.report,
         lag(t.pull_id) over w as prev_pull_id, lag(u.uploaded_at) over w as prev_uploaded_at
  from pull_tasks t join uploads u on u.pull_id = t.pull_id and u.status = 'confirmed'
  where t.profile_id is not null
  window w as (partition by t.profile_id, coalesce(t.zip_group, 'ALL') order by u.uploaded_at, t.pull_id);

-- each re-pull compared with the pull before it
create or replace view recycle_stats with (security_invoker = on) as
  select p.pull_id, p.prev_pull_id, p.profile_id, p.zip_group, p.market_fips, p.uploaded_at, p.prev_uploaded_at,
         round(extract(epoch from p.uploaded_at - p.prev_uploaded_at) / 86400) as days_between, s.*
  from list_pulls p
  cross join lateral (
    select count(a.property_id) as cur_props, count(b.property_id) as prev_props,
           count(*) filter (where a.property_id is not null and b.property_id is not null) as remained,
           count(*) filter (where a.property_id is not null and b.property_id is null) as added,
           count(*) filter (where a.property_id is null and b.property_id is not null) as dropped,
           count(*) filter (where a.property_id is not null and b.property_id is not null and (
             upper(trim(coalesce(a.raw->>'Owner 1 Last Name', ''))) <> upper(trim(coalesce(b.raw->>'Owner 1 Last Name', '')))
             or upper(trim(coalesce(a.raw->>'Mailing Address', ''))) <> upper(trim(coalesce(b.raw->>'Mailing Address', ''))))) as owner_changed,
           count(*) filter (where a.property_id is not null and b.property_id is not null and raw_phones(a.raw) <> raw_phones(b.raw)) as phones_changed
    from (select property_id, raw from property_pulls where pull_id = p.pull_id and voided_at is null) a
    full join (select property_id, raw from property_pulls where pull_id = p.prev_pull_id and voided_at is null) b on b.property_id = a.property_id
  ) s
  where p.prev_pull_id is not null;

-- ZIP activity per day: properties pulled (confirmed pulls) and properties first messaged (platform data)
create or replace view property_first_outreach with (security_invoker = on) as
  select r.property_id, min(m.sent_at) as first_at, bool_or(m.status in ('delivered', 'read')) as delivered
  from export_rows r join message_events m on m.phone = r.phone and m.direction = 'outbound' and m.sent_at >= r.imported_at
  where r.bucket = 'new' and r.imported_at is not null group by 1;
create or replace view zip_daily with (security_invoker = on) as
  select p.zip, p.market_fips, (u.uploaded_at at time zone 'America/Chicago')::date as day, 'pulled' as kind, count(distinct pp.property_id) as n
  from property_pulls pp join uploads u on u.pull_id = pp.pull_id and u.status = 'confirmed' join properties p on p.property_id = pp.property_id
  where pp.voided_at is null group by 1, 2, 3
  union all
  select p.zip, p.market_fips, (o.first_at at time zone 'America/Chicago')::date, 'messaged', count(*)
  from property_first_outreach o join properties p on p.property_id = o.property_id group by 1, 2, 3;

select pull_id, prev_pull_id, days_between, prev_props, cur_props, remained, added, dropped, owner_changed, phones_changed from recycle_stats order by uploaded_at;

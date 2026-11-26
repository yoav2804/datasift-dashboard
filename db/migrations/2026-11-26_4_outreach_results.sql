-- 2026-11-26 · Outreach results per property (one message per property, to the primary number).
-- Views only. Nothing is changed or removed.
-- Each exported property gets ONE result from the platform's own message records:
--   delivered       any outbound message to it was delivered
--   pending         sent but no final status yet
--   bad_number      carrier says the number is unreachable / inactive / landline (30003, 30004, 30005, 30006): a data-quality problem
--   carrier_block   carrier blocked it (30007): content / compliance, not the data
--   platform_limit  our account's daily sending limit or opt-out/error limit stopped it: a capacity problem, not the data
--   other_error     anything else
create or replace view outreach_by_property with (security_invoker = on) as
with x as (
  select r.batch_id, r.property_id, r.ghl_contact_id,
    case when m.status in ('delivered', 'read') then 'delivered'
         when m.status in ('sent', 'pending', 'queued', 'scheduled', 'accepted') then 'pending'
         when m.error ilike '%sending limit%' or m.error ilike '%opt-out/error limit%' then 'platform_limit'
         when m.error ~ '3000[3456]' then 'bad_number'
         when m.error ~ '30007' then 'carrier_block'
         else 'other_error' end as cat
  from export_rows r
  join message_events m on m.phone = r.phone and m.direction = 'outbound' and m.sent_at >= r.imported_at
  where r.bucket = 'new' and r.imported_at is not null)
select batch_id, property_id, min(ghl_contact_id) as ghl_contact_id, count(*) as messages,
  case when bool_or(cat = 'delivered') then 'delivered' when bool_or(cat = 'pending') then 'pending'
       when bool_or(cat = 'bad_number') then 'bad_number' when bool_or(cat = 'carrier_block') then 'carrier_block'
       when bool_or(cat = 'platform_limit') then 'platform_limit' else 'other_error' end as result
from x group by 1, 2;

create or replace view outreach_counts_by_batch with (security_invoker = on) as
select o.batch_id,
  count(*) as doors_messaged, sum(o.messages) as messages_sent,
  count(*) filter (where result = 'delivered') as doors_delivered,
  count(*) filter (where result = 'pending') as doors_pending,
  count(*) filter (where result = 'bad_number') as doors_bad_number,
  count(*) filter (where result = 'carrier_block') as doors_carrier_block,
  count(*) filter (where result = 'platform_limit') as doors_platform_limit,
  count(*) filter (where result = 'other_error') as doors_other_error,
  count(*) filter (where g.dnd) as doors_opted_out
from outreach_by_property o left join ghl_contacts g on g.contact_id = o.ghl_contact_id
group by 1;

select sum(doors_messaged) messaged, sum(doors_delivered) delivered, sum(doors_bad_number) bad_number, sum(doors_carrier_block) carrier_block,
       sum(doors_platform_limit) platform_limit, sum(doors_other_error) other, sum(doors_pending) pending, sum(doors_opted_out) opted_out
from outreach_counts_by_batch;

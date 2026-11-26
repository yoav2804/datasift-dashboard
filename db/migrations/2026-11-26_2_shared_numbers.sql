-- 2026-11-26 · Shared numbers are logged automatically (no manual review).
-- Adds owner_relation, classifies the existing cases, and moves open cases to status 'logged'. Nothing is deleted.
alter table review_cases add column if not exists owner_relation text;   -- same_owner | different_owner | unknown
create index if not exists export_rows_phone on export_rows (phone);    -- fast "already sent?" check

-- cases from GHL or from the same file: name / mailing were already compared
update review_cases set owner_relation = case
    when owner_name_match is true or mailing_match is true then 'same_owner'
    when owner_name_match is false and mailing_match is not true then 'different_owner'
    else 'unknown' end
where owner_relation is null and reason <> 'shared_in_history';

-- cases from history: compare the owners of the two properties
update review_cases rc set
  owner_name_match = exists (select 1 from property_owners a join owners oa on oa.owner_id = a.owner_id
                             join property_owners b on b.property_id = rc.original_property_id join owners ob on ob.owner_id = b.owner_id
                             where a.property_id = rc.new_property_id and coalesce(trim(oa.owner1_last), '') <> '' and upper(trim(oa.owner1_last)) = upper(trim(ob.owner1_last))),
  mailing_match = exists (select 1 from property_owners a join owners oa on oa.owner_id = a.owner_id
                          join property_owners b on b.property_id = rc.original_property_id join owners ob on ob.owner_id = b.owner_id
                          where a.property_id = rc.new_property_id and coalesce(trim(oa.mailing_address), '') <> '' and upper(trim(oa.mailing_address)) = upper(trim(ob.mailing_address)))
where rc.owner_relation is null and rc.reason = 'shared_in_history' and rc.original_property_id is not null;
update review_cases set owner_relation = case
    when owner_name_match is true or mailing_match is true then 'same_owner'
    when owner_name_match is false then 'different_owner' else 'unknown' end
where owner_relation is null;

-- a GHL contact with no last name can't be compared
update review_cases rc set owner_relation = 'unknown', owner_name_match = null
from ghl_contacts g where g.contact_id = rc.ghl_contact_id and rc.reason = 'in_ghl_other_property'
  and coalesce(trim(g.raw->>'lastName'), '') = '' and rc.mailing_match is not true;

update review_cases set status = 'logged' where status = 'open';

select reason, owner_relation, status, count(*) from review_cases group by 1, 2, 3 order by 1, 2, 3;

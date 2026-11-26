-- Removes ONLY the fake "ZZTEST" test data (Johnny approved deleting test data, 2026-11-25).
-- Real data can't be hit: every delete is limited to ZZTEST pulls/profiles, fake "ZZTEST UNDO ST" addresses,
-- fake owners, and fictional 314-555-010x numbers. It all runs as one transaction: if anything fails, nothing is deleted.
begin;
create temp table t_props on commit drop as
  select p.property_id from properties p
  where p.address like '% ZZTEST UNDO ST'
    and not exists (select 1 from property_pulls pp where pp.property_id = p.property_id and pp.pull_id not like 'ZZTEST-%');
create temp table t_owners on commit drop as
  select owner_id from owners where owner1_first = 'ZZTEST' and mailing_address like '% ZZTEST MAIL AVE';

delete from export_rows       where batch_id in (select batch_id from export_batches where pull_id like 'ZZTEST-%');
delete from export_batches    where pull_id like 'ZZTEST-%';
delete from review_cases      where pull_id like 'ZZTEST-%' or new_property_id in (select property_id from t_props) or original_property_id in (select property_id from t_props);
delete from outcomes          where pull_id like 'ZZTEST-%' or property_id in (select property_id from t_props);
delete from property_phones   where property_id in (select property_id from t_props);
delete from property_owners   where property_id in (select property_id from t_props);
delete from property_profiles where property_id in (select property_id from t_props) or profile_id like 'ZZTEST-%';
delete from property_pulls    where pull_id like 'ZZTEST-%';
delete from uploads           where pull_id like 'ZZTEST-%';
delete from properties        where property_id in (select property_id from t_props);
delete from owners o where o.owner_id in (select owner_id from t_owners)
  and not exists (select 1 from property_owners po where po.owner_id = o.owner_id)
  and not exists (select 1 from property_phones pp where pp.owner_id = o.owner_id);
delete from phones ph where ph.phone like '+1314555010%'
  and not exists (select 1 from property_phones pp where pp.phone = ph.phone);
delete from pull_tasks        where pull_id like 'ZZTEST-%';
delete from profiles          where profile_id in ('ZZTEST-A', 'ZZTEST-B');
delete from ghl_contacts      where contact_id like 'ZZTEST%';
delete from upload_corrections where from_pull_id like 'ZZTEST-%' or to_pull_id like 'ZZTEST-%';   -- fake GHL contacts used to test 'already in texting' (phones cascade)
commit;

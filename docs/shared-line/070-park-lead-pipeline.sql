-- 070: the outreach pipeline on top of 069's park owners.
--
-- An owner is keyed by name + mailing address + zip, hashed, the same way
-- the view groups them -- so a refresh of the parcels never orphans a
-- lead's stage, notes or touches.
--
-- A stage is a person's typing. Nothing here deletes or resets one.

-- The view gains a stable `key` and puts each owner on the map at their
-- LARGEST parcel, not the average of them: an owner with a park in Wilson
-- and another in Wilmington averaged to a dot in a field between the two.
create or replace view mhp_owners with (security_invoker = true) as
select
  upper(trim(ownname))                                   as owner,
  max(ownname2)                                          as owner2,
  max(mailadd)                                           as mail_address,
  max(mcity)                                             as mail_city,
  max(mstate)                                            as mail_state,
  max(mzip)                                              as mail_zip,
  count(*)                                               as parcels,
  round(sum(coalesce(acres,0)), 1)                       as acres,
  sum(coalesce(parval,0))                                as assessed_value,
  string_agg(distinct cnty, ', ')                        as counties,
  string_agg(distinct coalesce(siteadd, '') || case when scity is not null then ', ' || scity else '' end, ' | ') as sites,
  bool_or(matched_on && array['use','owner'])            as strong,
  bool_or('use'    = any(matched_on))                    as by_use,
  bool_or('owner'  = any(matched_on))                    as by_owner,
  bool_or('legal'  = any(matched_on))                    as by_legal,
  bool_or('subdiv' = any(matched_on))                    as by_subdiv,
  bool_or(coalesce(mstate,'NC') <> 'NC')                 as out_of_state,
  min(saledate)                                          as earliest_sale,
  (array_agg(lat order by acres desc nulls last))[1]     as lat,
  (array_agg(lon order by acres desc nulls last))[1]     as lon,
  md5(upper(trim(ownname)) || '|' || upper(coalesce(mailadd,'')) || '|' || upper(coalesce(mzip,''))) as key
from mhp_parcels
where ownname is not null
group by upper(trim(ownname)), upper(coalesce(mailadd,'')), upper(coalesce(mzip,''));
grant select on mhp_owners to authenticated;

create table if not exists mhp_leads (
  owner_key   text primary key,
  stage       text not null default 'new'
              check (stage in ('new','researching','contacted','talking','offer','contract','closed','dead')),
  starred     boolean not null default false,
  next_touch  date,
  phone       text,
  email       text,
  notes       text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff(id)
);

create table if not exists mhp_touches (
  id         bigserial primary key,
  owner_key  text not null,
  kind       text not null check (kind in ('letter','call','text','email','visit','note')),
  body       text,
  at         timestamptz not null default now(),
  by         uuid references staff(id)
);
create index if not exists mhp_touches_owner on mhp_touches (owner_key, at desc);

alter table mhp_leads   enable row level security;
alter table mhp_touches enable row level security;
revoke all on mhp_leads, mhp_touches from anon;
grant select, insert, update on mhp_leads   to authenticated;
grant select, insert         on mhp_touches to authenticated;
-- A blanket grant elsewhere must not hand out deletes: the history is the record.
revoke delete on mhp_leads, mhp_touches from authenticated;
grant usage on sequence mhp_touches_id_seq to authenticated;

drop policy if exists office_works_mhp_leads on mhp_leads;
create policy office_works_mhp_leads on mhp_leads
  for all using (staff_has_role('admin','office')) with check (staff_has_role('admin','office'));
drop policy if exists office_reads_mhp_touches on mhp_touches;
create policy office_reads_mhp_touches on mhp_touches
  for select using (staff_has_role('admin','office'));
drop policy if exists office_logs_mhp_touches on mhp_touches;
create policy office_logs_mhp_touches on mhp_touches
  for insert with check (staff_has_role('admin','office') and by = auth.uid());

-- 069: every mobile home park parcel in North Carolina, and who owns it.
--
-- The source is NC OneMap's statewide parcel layer (all 100 counties, one
-- schema). It is fetched by the DATABASE through pg_net, so nothing passes
-- through a file or a laptop: `mhp_fetch` asks, `mhp_ingest` reads the reply
-- out of net._http_response and upserts it.
--
-- A parcel is found four ways and remembers every way it was found
-- (`matched_on`), because they are not equally good evidence:
--   use     the county's land-use code says park           -- strong
--   owner   the owner's name says park (an LLC like "X MHP") -- strong
--   legal   the legal description says park                -- often a single
--   subdiv  the subdivision name says park                    lot inside a
--                                                             park subdivision
-- The owner view ranks on that, rather than throwing the weaker ones away:
-- an owner holding six lots in "Pine Acres MHP" IS the park owner.
--
-- Nothing here deletes a row. Re-running a fetch upserts.

create table if not exists mhp_parcels (
  key          text primary key,            -- county fips : parcel number
  cnty         text,
  cntyfips     text,
  parno        text,
  ownname      text,
  ownname2     text,
  owntype      text,
  mailadd      text,
  mcity        text,
  mstate       text,
  mzip         text,
  siteadd      text,
  scity        text,
  szip         text,
  acres        numeric,
  parval       numeric,
  landval      numeric,
  improvval    numeric,
  usedesc      text,
  legal        text,
  subdivision  text,
  saledate     text,
  structyear   text,
  lat          double precision,
  lon          double precision,
  matched_on   text[] not null default '{}',
  raw          jsonb,
  first_seen   timestamptz not null default now(),
  refreshed_at timestamptz not null default now()
);
create index if not exists mhp_parcels_owner on mhp_parcels (upper(ownname));
create index if not exists mhp_parcels_lon on mhp_parcels (lon);

alter table mhp_parcels enable row level security;
revoke all on mhp_parcels from anon;
grant select on mhp_parcels to authenticated;
drop policy if exists office_reads_mhp_parcels on mhp_parcels;
create policy office_reads_mhp_parcels on mhp_parcels
  for select using (staff_has_role('admin','office'));

-- The four searches, kept in the database so a refresh is one call.
create table if not exists mhp_searches (
  tag    text primary key,
  clause text not null
);
alter table mhp_searches enable row level security;
revoke all on mhp_searches from anon, authenticated;

insert into mhp_searches (tag, clause) values
 ('use', $$upper(parusedesc) like '%MOBILE HOME PAR%' or upper(parusedesc) like '%MOBILEHOMEPARK%' or upper(parusedesc) like '%TRAILER P%' or upper(parusedesc) like 'MHP%' or upper(parusedesc) like '%MH PARK%'$$),
 ('owner', $$upper(ownname) like '%MOBILE HOME PARK%' or upper(ownname) like '%MHP%' or upper(ownname) like '%TRAILER PARK%' or upper(ownname) like '%MH PARK%' or upper(ownname) like '%MOBILE HOME COMM%' or upper(ownname) like '%MOBILE HOME VILL%' or upper(ownname) like '%MOBILE ESTATES%' or upper(ownname) like '%MOBILE HOME EST%' or upper(ownname) like '%MHC %' or upper(ownname) like '%MOBILE HOMES%' or upper(ownname2) like '%MOBILE HOME PARK%'$$),
 ('legal', $$upper(legdecfull) like '%MOBILE HOME PARK%' or upper(legdecfull) like '%MHP%' or upper(legdecfull) like '%TRAILER PARK%' or upper(legdecfull) like '%MH PARK%' or upper(legdecfull) like '%TRAILER CT%'$$),
 ('subdiv', $$upper(subdivisio) like '%MOBILE HOME PARK%' or upper(subdivisio) like '%MHP%' or upper(subdivisio) like '%TRAILER PARK%' or upper(subdivisio) like '%MH PARK%'$$)
on conflict (tag) do update set clause = excluded.clause;

-- Ask NC OneMap for one search, one page. Returns the pg_net request id.
create or replace function mhp_fetch(p_tag text, p_offset int default 0)
returns bigint language sql security definer set search_path = public, net as $$
  select net.http_get(
    'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/0/query',
    params := jsonb_build_object(
      'where', (select clause from mhp_searches where tag = p_tag),
      'outFields', '*', 'returnGeometry', 'true', 'outSR', '4326',
      'orderByFields', 'objectid',
      'resultOffset', p_offset::text, 'resultRecordCount', '2000',
      'f', 'json'),
    timeout_milliseconds := 120000);
$$;

-- Read a reply and upsert it. Returns how many parcels it carried, and
-- raises with the body when the reply is not what was asked for, so a
-- failure says what it got rather than loading nothing quietly.
create or replace function mhp_ingest(p_id bigint, p_tag text)
returns int language plpgsql security definer set search_path = public, net as $$
declare r record; body jsonb; n int;
begin
  select status_code, content into r from net._http_response where id = p_id;
  if not found then raise exception 'no reply yet for request %', p_id; end if;
  if r.status_code <> 200 then raise exception 'NC OneMap said %: %', r.status_code, left(r.content, 400); end if;
  body := r.content::jsonb;
  if body ? 'error' then raise exception 'NC OneMap error: %', body->'error'; end if;

  insert into mhp_parcels as p (key, cnty, cntyfips, parno, ownname, ownname2, owntype,
    mailadd, mcity, mstate, mzip, siteadd, scity, szip, acres, parval, landval, improvval,
    usedesc, legal, subdivision, saledate, structyear, lat, lon, matched_on, raw)
  -- A county can list one parcel number more than once (the land, and
  -- each home on it as personal property). One row per parcel: the most
  -- valuable record, which is the land.
  select distinct on (1)
    coalesce(a->>'stcntyfips', a->>'cntyname') || ':' || coalesce(nullif(a->>'parno',''), nullif(a->>'altparno',''), 'oid' || (a->>'objectid')),
    a->>'cntyname', a->>'stcntyfips', a->>'parno',
    nullif(trim(a->>'ownname'),''), nullif(trim(a->>'ownname2'),''), a->>'owntype',
    nullif(trim(a->>'mailadd'),''), a->>'mcity', a->>'mstate', a->>'mzip',
    nullif(trim(a->>'siteadd'),''), a->>'scity', a->>'szip',
    (a->>'gisacres')::numeric, (a->>'parval')::numeric, (a->>'landval')::numeric, (a->>'improvval')::numeric,
    a->>'parusedesc', a->>'legdecfull', a->>'subdivisio', a->>'saledatetx', a->>'structyear',
    (f->'geometry'->>'y')::double precision, (f->'geometry'->>'x')::double precision,
    array[p_tag], a
  from jsonb_array_elements(body->'features') f, lateral (select f->'attributes' a) x
  order by 1, (a->>'parval')::numeric desc nulls last
  on conflict (key) do update set
    ownname = excluded.ownname, ownname2 = excluded.ownname2, owntype = excluded.owntype,
    mailadd = excluded.mailadd, mcity = excluded.mcity, mstate = excluded.mstate, mzip = excluded.mzip,
    siteadd = excluded.siteadd, scity = excluded.scity, szip = excluded.szip,
    acres = excluded.acres, parval = excluded.parval, landval = excluded.landval, improvval = excluded.improvval,
    usedesc = excluded.usedesc, legal = excluded.legal, subdivision = excluded.subdivision,
    saledate = excluded.saledate, structyear = excluded.structyear,
    lat = excluded.lat, lon = excluded.lon, raw = excluded.raw,
    matched_on = (select array_agg(distinct t order by t) from unnest(p.matched_on || excluded.matched_on) t),
    refreshed_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function mhp_fetch(text,int), mhp_ingest(bigint,text) from public, anon, authenticated;

-- One row per owner: the outreach list. An owner is a name at a mailing
-- address, so two LLCs at one address stay two rows and one LLC at two
-- addresses stays two rows -- merging them is a person's call.
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
  bool_or('use'    = any(matched_on))                  as by_use,
  bool_or('owner'  = any(matched_on))                  as by_owner,
  bool_or('legal'  = any(matched_on))                  as by_legal,
  bool_or('subdiv' = any(matched_on))                  as by_subdiv,
  bool_or(coalesce(mstate,'NC') <> 'NC')                 as out_of_state,
  min(saledate)                                          as earliest_sale,
  avg(lat) as lat, avg(lon) as lon
from mhp_parcels
where ownname is not null
group by upper(trim(ownname)), upper(coalesce(mailadd,'')), upper(coalesce(mzip,''));
grant select on mhp_owners to authenticated;

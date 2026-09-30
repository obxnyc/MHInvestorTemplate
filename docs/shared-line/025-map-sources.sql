-- Where the pictures and the parcel lines come from
--
-- Run in the Supabase SQL editor, after 024. Safe to run twice.
--
-- Three layers make a map like the listing sites', and all three are free.
-- The aerial photograph is a backdrop. The parcel boundary is the legal edge
-- of what we own, and only the county has it. The lots inside a park are ours
-- and exist nowhere else on earth -- a park is ONE parcel to the county, and
-- the sixty-four pads inside it are an arrangement of our own land that no
-- public dataset has ever recorded.
--
-- Sources live in a table rather than in the code because the portfolio is in
-- at least six counties already -- Pasquotank, Cumberland, Gates, Dare,
-- Hertford, Chowan -- and every purchase outside that footprint adds another.
-- Wiring each one into a deployment would mean a release per county. This way
-- a new source is a row, added by whoever is looking at the map.

create table if not exists map_sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- imagery: a picture to draw under everything
  -- parcels:  boundaries to draw on top of it
  kind        text not null check (kind in ('imagery','parcels')),
  -- Either an {z}/{x}/{y} tile template or an ArcGIS export/query endpoint.
  -- One field, because both are just a URL with holes in it and having two
  -- would mean deciding which one a new source is before knowing.
  url         text not null,
  -- Whose picture it is. Most free imagery is free on condition of being
  -- credited, and a credit nobody recorded is a licence nobody kept.
  attribution text,
  -- Null means everywhere. A county source names its county, and a property
  -- picks up whichever source covers it.
  county      text,
  state       text default 'NC',
  -- Lower is preferred where several cover the same ground, so a county
  -- flight can outrank the statewide one without deleting anything.
  rank        smallint not null default 100,
  active      boolean not null default true,
  -- What happened last time somebody tested it, so a source that quietly
  -- stopped answering is visible rather than merely blank.
  checked_at  timestamptz,
  checked_ok  boolean,
  checked_say text,
  created_at  timestamptz not null default now()
);

create index if not exists map_sources_pick on map_sources (kind, active, rank);

alter table map_sources enable row level security;
revoke all on map_sources from anon;
revoke insert, update, delete on map_sources from authenticated;
drop policy if exists staff_reads_map_sources on map_sources;
create policy staff_reads_map_sources on map_sources for select using (is_active_staff());
grant select on map_sources to authenticated;

-- The parcel a property sits on, once we have fetched it.
--
-- Cached rather than fetched per view: it is somebody else's public service,
-- a parcel line does not move, and a map that redraws on every pan should not
-- be asking a county server each time.
alter table properties
  add column if not exists parcel_geojson jsonb,
  add column if not exists parcel_ref     text,
  add column if not exists parcel_at      timestamptz;

-- The lots themselves, as shapes rather than points. A pin says roughly
-- where; an outline says which pad, which is the question actually being
-- asked at the gate.
alter table units
  add column if not exists outline jsonb;

do $$ begin
  raise notice 'map sources are rows, parcels are cached, lots can be shapes';
end $$;

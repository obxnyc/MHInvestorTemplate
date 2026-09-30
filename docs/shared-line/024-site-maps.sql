-- A map of every property, and what sits on each lot
--
-- Run in the Supabase SQL editor, after 023. Safe to run twice.
--
-- The question a park raises constantly is "which one is lot 34" -- asked by a
-- tech at the gate, by whoever is taking the call, and by anybody trying to
-- work out which homes back onto the tree line. A list cannot answer it. A
-- picture with the lots marked on it can, and it is the same picture that
-- answers "which ones are empty" at a glance.
--
-- Two ways to hold a position, because there are two kinds of backdrop and
-- they are not interchangeable.
--
-- Over a real aerial, a lot has a latitude and longitude. Those columns
-- already exist on units, from 016, and they are worth more than a pin on a
-- picture: a tech can be given directions to them, and they survive the
-- backdrop being replaced -- Google today, a county flight next spring, a
-- drone photograph after that. Not one pin moves.
--
-- Over an uploaded image -- a site plan, a county parcel map, a screenshot
-- taken before the lots existed on any aerial -- there is no such thing as a
-- coordinate. A position is a fraction of the way across and down THAT image,
-- and it means nothing without it. Which is fine, and is exactly what is
-- needed while 1140 and Pamalee are being built and the imagery shows dirt.

alter table properties
  -- 'aerial' — drawn over live satellite imagery, positions are real
  -- 'image'  — drawn over the uploaded plan below, positions are fractions
  -- 'none'   — nobody has set one up
  add column if not exists map_kind text not null default 'none'
    check (map_kind in ('none','aerial','image')),
  -- Path in the private attachments bucket. Never a public URL: a site plan
  -- shows where people live.
  add column if not exists map_image  text,
  -- What the uploaded image is, so a pin placed on it can be re-checked
  -- against what it was placed on.
  add column if not exists map_note   text,
  add column if not exists map_zoom   smallint;

alter table units
  -- Fractions of the uploaded image, 0 to 1. Null on an aerial-backed map,
  -- where lat/lng from 016 is the truth instead.
  add column if not exists map_x numeric(6,5),
  add column if not exists map_y numeric(6,5),
  -- The two numbers somebody rings up about, and which nobody can find when
  -- the water company is on the phone.
  add column if not exists meter_water    text,
  add column if not exists meter_electric text;

create index if not exists units_placed on units (property_id)
  where map_x is not null or lat is not null;

-- Notes about a PLACE rather than about a conversation.
--
-- "The crawl space hatch is behind the skirting on the left" belongs to the
-- lot. It was true before the text that mentioned it and stays true after the
-- thread is closed, and filing it under whichever conversation happened to
-- surface it is how it gets lost.
create table if not exists unit_notes (
  id         uuid primary key default gen_random_uuid(),
  unit_id    uuid not null references units(id) on delete cascade,
  author_id  uuid references staff(id) on delete set null,
  body       text not null,
  -- Something a person should be told before they go, rather than something
  -- worth reading afterwards: a dog, a gate code, a resident who works nights.
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists unit_notes_by_unit on unit_notes (unit_id, created_at desc);

alter table unit_notes enable row level security;
revoke all on unit_notes from anon;
revoke insert, update, delete on unit_notes from authenticated;

drop policy if exists staff_reads_unit_notes on unit_notes;
create policy staff_reads_unit_notes on unit_notes for select using (is_active_staff());
grant select on unit_notes to authenticated;

do $$ begin
  raise notice 'properties can carry a map, lots can carry a position, meters and notes';
end $$;

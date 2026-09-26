-- Rent Manager's identifiers, kept alongside our own
--
-- Run in the Supabase SQL editor, after 018. Safe to run twice.
--
-- An import that cannot recognise what it already imported is not an import,
-- it is a way of creating everything twice. So every record that came from
-- Rent Manager remembers which record it was.
--
-- Their id and not their code, deliberately. ShortName is what everybody
-- says out loud -- 214Ever, 1140Nort58 -- and it is therefore the thing
-- somebody will one day rename. PropertyID is a number nobody sees and
-- nobody edits, which is exactly what an identity should be. The code is
-- carried too, because it is what goes on an invoice, but the join is on the
-- id.

alter table properties
  add column if not exists rm_property_id integer,
  add column if not exists rm_synced_at   timestamptz;

alter table units
  add column if not exists rm_unit_id     integer,
  add column if not exists rm_synced_at   timestamptz;

alter table owners
  add column if not exists rm_owner_id    integer,
  add column if not exists rm_synced_at   timestamptz;

-- Unique so a second import updates rather than duplicates, and so a bug
-- that tried to would be refused by the database rather than discovered in a
-- list of ninety properties where there should be forty-five.
create unique index if not exists properties_rm_id on properties (rm_property_id)
  where rm_property_id is not null;
create unique index if not exists units_rm_id on units (rm_unit_id)
  where rm_unit_id is not null;
create unique index if not exists owners_rm_id on owners (rm_owner_id)
  where rm_owner_id is not null;

-- What the last run did, so "is this up to date" has an answer that is not
-- somebody's memory of having clicked the button.
create table if not exists rm_syncs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  -- A dry run reports what it would do and writes nothing. It is the default,
  -- because the first thing anybody should see is what is about to happen.
  dry_run     boolean not null default true,
  ok          boolean,
  owners_seen     integer not null default 0,
  owners_written  integer not null default 0,
  props_seen      integer not null default 0,
  props_written   integer not null default 0,
  units_seen      integer not null default 0,
  units_written   integer not null default 0,
  -- Anything that did not fit, kept rather than logged: a property with no
  -- code, a unit whose property is missing. The list is the work queue.
  notes       text[] not null default '{}',
  error       text,
  by_staff    uuid references staff(id) on delete set null
);

alter table rm_syncs enable row level security;
revoke all on rm_syncs from anon;
revoke insert, update, delete on rm_syncs from authenticated;

drop policy if exists staff_reads_syncs on rm_syncs;
create policy staff_reads_syncs on rm_syncs for select using (is_active_staff());

grant select on rm_syncs to authenticated;

do $$ begin
  raise notice 'imported records remember where they came from';
end $$;

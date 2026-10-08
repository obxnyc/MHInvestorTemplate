-- 031 — what is on the pad, what it is plugged into, and what else is in
-- the yard.
--
-- Three things that are all answers to "what am I looking at", which is
-- why they arrive together.

-- ---------------------------------------------------------------------
-- 1. Who owns the home, and do we manage it.
-- ---------------------------------------------------------------------
--
-- Three kinds, and they are not the same question as who owns the LOT --
-- the lot is always ours. A pad with no home on it is 'none', which is a
-- fourth state rather than a null, because "nobody told us yet" and
-- "there is no home there" are different facts and only one of them is a
-- job for somebody.
--
-- home_sales already records an investor purchase in full, with terms and
-- a history. This is the at-a-glance answer that the map paints, and it
-- is kept on the unit so that painting fifty one pads is one query.
do $$ begin
  create type home_kind as enum ('poh', 'toh', 'ioh', 'none');
exception when duplicate_object then null; end $$;

alter table units
  add column if not exists home_kind home_kind not null default 'none',
  -- Whether the park manages the letting. A park-owned home always is;
  -- an investor's may or may not be, and that is the whole reason the
  -- flag exists separately from who owns it.
  add column if not exists we_manage boolean not null default false;

-- A home we own is a home we manage. Anything else is a choice.
alter table units drop constraint if exists park_owned_is_managed;
alter table units add constraint park_owned_is_managed
  check (home_kind <> 'poh' or we_manage);

-- Nothing to manage on a bare pad.
alter table units drop constraint if exists bare_pad_is_not_managed;
alter table units add constraint bare_pad_is_not_managed
  check (home_kind <> 'none' or not we_manage);

-- ---------------------------------------------------------------------
-- 2. The meters.
-- ---------------------------------------------------------------------
--
-- Two per home, water and electric, each with its own number and its own
-- provider -- they are rarely the same company and the number is what
-- anybody actually rings up about. Where it is matters too: a meter
-- nobody can find is a meter that gets read wrong.
--
-- A row per meter rather than four columns on the unit, because meters
-- get swapped. The one in service is the one with no removed_on, and the
-- old number stays readable next to the bill that was argued about.
do $$ begin
  create type meter_kind as enum ('water', 'electric', 'gas');
exception when duplicate_object then null; end $$;

create table if not exists meters (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  kind        meter_kind not null,

  -- What is written on the meter, and who to ring. Both are text: a
  -- serial is not a number (leading zeros, letters), and a provider is a
  -- name on a bill rather than anything we can enumerate.
  serial      text,
  provider    text,
  account_ref text,

  -- Where it is, as a point on the map. Null until somebody walks round
  -- with a phone, which is the normal state for a while.
  lat         double precision,
  lng         double precision,
  constraint meter_has_both_or_neither
    check ((lat is null) = (lng is null)),
  constraint meter_is_on_earth
    check (lat is null or (lat between -90 and 90 and lng between -180 and 180)),

  fitted_on   date,
  removed_on  date,
  constraint meter_removed_after_fitted
    check (removed_on is null or fitted_on is null or removed_on >= fitted_on),

  note        text,
  created_at  timestamptz not null default now()
);

-- One live meter of each kind per home. Two live electric meters on one
-- pad means a bill is about to go to the wrong person.
create unique index if not exists meters_one_live_of_each_kind
  on meters (unit_id, kind) where removed_on is null;
create index if not exists meters_by_unit on meters (unit_id);
-- "Whose meter is 81-440391?" is a question somebody asks holding a bill.
create index if not exists meters_by_serial on meters (lower(serial))
  where serial is not null;

-- ---------------------------------------------------------------------
-- 3. Storage units in the yard.
-- ---------------------------------------------------------------------
--
-- A shed on somebody's lot that they pay for monthly. It belongs to the
-- lot rather than to the tenant, because it stays when they leave, and
-- the charge stops and starts with its own dates rather than theirs.
create table if not exists yard_storage (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references units(id) on delete cascade,

  label         text,
  -- As written on the agreement: "10x12", "8x8 shed". Free text, because
  -- every park measures these differently and nobody wants a dropdown
  -- that does not have theirs in it.
  size          text,

  -- Cents, never a float. These are charged every month for years, and a
  -- balance a cent out is an argument with somebody who is right.
  monthly_cents integer not null check (monthly_cents >= 0),

  started_on    date not null default current_date,
  ended_on      date,
  ended_why     text,
  constraint storage_ended_after_started
    check (ended_on is null or ended_on >= started_on),

  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references staff(id) on delete set null
);

create index if not exists yard_storage_by_unit
  on yard_storage (unit_id, started_on desc);
-- What is being charged right now, which is the only figure that goes on
-- a statement.
create index if not exists yard_storage_live
  on yard_storage (unit_id) where ended_on is null;

-- ---------------------------------------------------------------------
-- Who may see and change any of it.
-- ---------------------------------------------------------------------
--
-- A policy filters a privilege; it does not grant one. Both are needed.
alter table meters enable row level security;
alter table yard_storage enable row level security;
revoke all on meters from anon;
revoke all on yard_storage from anon;

-- A meter reading corrected is a typo fixed, so update is allowed; a
-- meter that stopped being there gets a removed_on, which keeps the
-- history that a delete would take with it.
revoke delete on meters from authenticated;
revoke delete on yard_storage from authenticated;
grant select, insert, update on meters to authenticated;
grant select, insert, update on yard_storage to authenticated;

drop policy if exists staff_reads_meters on meters;
create policy staff_reads_meters on meters
  for select using (is_active_staff());
drop policy if exists staff_writes_meters on meters;
create policy staff_writes_meters on meters
  for insert with check (is_active_staff());
drop policy if exists staff_updates_meters on meters;
create policy staff_updates_meters on meters
  for update using (is_active_staff()) with check (is_active_staff());

drop policy if exists staff_reads_storage on yard_storage;
create policy staff_reads_storage on yard_storage
  for select using (is_active_staff());
drop policy if exists staff_writes_storage on yard_storage;
create policy staff_writes_storage on yard_storage
  for insert with check (is_active_staff());
drop policy if exists staff_updates_storage on yard_storage;
create policy staff_updates_storage on yard_storage
  for update using (is_active_staff()) with check (is_active_staff());

do $$ begin
  raise notice 'homes have an owner, meters have a number, yards have sheds';
end $$;

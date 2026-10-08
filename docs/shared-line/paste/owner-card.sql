-- The owner card, in one paste.
--
-- 031, 032 and 033 run end to end, in order. Every statement is written
-- to be safe to run twice, so if this is interrupted, or you are not
-- sure whether it went through, run the whole thing again.
--
--   031  who owns the home on each lot, its meters, and sheds in the yard
--   032  what is paid every month, and the bill of sale and lease behind it
--   033  of the homes we still own: stock, a letting we keep, or not a home
--

-- ============================================================
-- 031-homes-meters-storage.sql
-- ============================================================

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

-- ============================================================
-- 032-sale-money-and-papers.sql
-- ============================================================

-- 032 — what an owner pays us every month, and the paper it rests on.
--
-- 030 recorded the sale: price, down payment, and the note if we financed
-- it. That is the deal struck once. This is the deal running: four
-- separate monthly charges that arrive on one statement and are argued
-- about one at a time.

alter table home_sales
  -- The lot fee. The home is theirs and the ground is ours, and this is
  -- the whole reason a park is a business.
  add column if not exists lot_rent_cents    integer
    check (lot_rent_cents is null or lot_rent_cents >= 0),
  -- What we charge to run it for them -- find the tenant, collect the
  -- rent, send the plumber. Nil when the owner manages it themselves,
  -- which is why it is separate from the lot fee rather than folded in.
  add column if not exists management_cents  integer
    check (management_cents is null or management_cents >= 0),
  -- The home warranty, if they took one.
  add column if not exists warranty_cents    integer
    check (warranty_cents is null or warranty_cents >= 0),
  -- What the tenant living in it pays, where we are the ones letting it.
  -- Kept on the sale rather than the unit because it belongs to this
  -- owner's arrangement and ends when their ownership does.
  add column if not exists tenant_rent_cents integer
    check (tenant_rent_cents is null or tenant_rent_cents >= 0),
  -- A pet fee, which is monthly and is charged often enough to be a
  -- column rather than a note somebody has to read.
  add column if not exists pet_fee_cents     integer
    check (pet_fee_cents is null or pet_fee_cents >= 0),
  -- What a late payment costs. Not a monthly charge: this is the figure
  -- the agreement names, and what gets charged when is a job for the
  -- payment side, which does not exist yet.
  add column if not exists late_fee_cents    integer
    check (late_fee_cents is null or late_fee_cents >= 0);

-- A charge we make for managing a home we are not managing is a charge
-- somebody will ask about and nobody can explain.
alter table home_sales drop constraint if exists management_fee_needs_managing;

comment on column home_sales.lot_rent_cents is
  'Monthly lot fee the home owner pays the park.';
comment on column home_sales.management_cents is
  'Monthly fee for the park letting and running the home on the owner''s behalf.';
comment on column home_sales.warranty_cents is
  'Monthly home warranty, where one was taken.';
comment on column home_sales.tenant_rent_cents is
  'Monthly rent the tenant pays, where the park lets the home.';
comment on column home_sales.pet_fee_cents is
  'Monthly pet fee, where the tenant has one.';
comment on column home_sales.late_fee_cents is
  'What the agreement charges for a late payment. Not a monthly figure.';

-- ---------------------------------------------------------------------
-- The paperwork.
-- ---------------------------------------------------------------------
--
-- A bill of sale and a lease are the two documents somebody asks for
-- when a figure is disputed, and "it is in the filing cabinet" is how an
-- afternoon goes. Hung off the sale rather than the unit, because the
-- lot outlives the deal: lot 3107 has had three bills of sale and each
-- belongs to its own.
--
-- The file itself lives in the same storage bucket as every other
-- attachment; this is the path to it and what it is.
do $$ begin
  create type paper_kind as enum
    ('bill_of_sale', 'lease', 'note', 'title', 'warranty', 'other');
exception when duplicate_object then null; end $$;

create table if not exists sale_papers (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references home_sales(id) on delete cascade,
  kind       paper_kind not null,

  -- Where the file sits in the attachments bucket, and what to call it
  -- on screen. Both, because a storage path is not a filename anybody
  -- wants to read.
  path       text not null,
  name       text,

  signed_on  date,
  note       text,
  added_at   timestamptz not null default now(),
  added_by   uuid references staff(id) on delete set null
);

create index if not exists sale_papers_by_sale on sale_papers (sale_id, kind);
-- The same file attached twice to the same sale is a mistake, not two
-- documents.
create unique index if not exists sale_papers_one_of_each_file
  on sale_papers (sale_id, path);

alter table sale_papers enable row level security;
revoke all on sale_papers from anon;
-- A paper filed against the wrong sale gets detached, so delete is
-- allowed here -- unlike a vendor invoice, this is a pointer to a file
-- rather than a figure anybody relies on, and the file itself stays in
-- the bucket.
grant select, insert, update, delete on sale_papers to authenticated;

drop policy if exists staff_reads_papers on sale_papers;
create policy staff_reads_papers on sale_papers
  for select using (is_active_staff());
drop policy if exists staff_writes_papers on sale_papers;
create policy staff_writes_papers on sale_papers
  for insert with check (is_active_staff());
drop policy if exists staff_updates_papers on sale_papers;
create policy staff_updates_papers on sale_papers
  for update using (is_active_staff()) with check (is_active_staff());
drop policy if exists staff_removes_papers on sale_papers;
create policy staff_removes_papers on sale_papers
  for delete using (is_active_staff());

do $$ begin
  raise notice 'a sale has its monthly charges and its paperwork';
end $$;

-- ============================================================
-- 033-park-use-and-tenancy.sql
-- ============================================================

-- 033 — a park-owned home we will sell, one we keep, and one that is not a home
--
-- "Park owned" was being asked to mean three different things at once, and
-- the only question the owner actually opens this screen to answer -- what
-- is left to sell -- cannot be answered while it does.
--
--   to_sell    we still own it and it is inventory. This is the tally.
--   we_rent    we still own it and we are letting it. Not for sale.
--   not_home   a structure on the property: the office, the laundry, a
--              storage building. Never was a home and will not be sold.
--
-- It only means anything on a park-owned lot. A tenant's home and an
-- investor's are not ours to sell whatever this column says, and a bare
-- pad has no home on it to sell, so the constraint keeps the column null
-- on all three rather than letting a stale value sit there contradicting
-- the kind beside it.
do $$ begin
  create type park_use as enum ('to_sell','we_rent','not_home');
exception when duplicate_object then null; end $$;

alter table units
  add column if not exists park_use park_use;

-- Every park-owned home already on file is inventory until somebody says
-- otherwise, which is the answer that was true before this column existed.
update units set park_use = 'to_sell'
  where home_kind = 'poh' and park_use is null;

alter table units drop constraint if exists park_use_is_for_park_owned;
alter table units
  add constraint park_use_is_for_park_owned
  check (park_use is null or home_kind = 'poh');

-- What the person living in a park-owned home pays.
--
-- The money columns from 032 hang off home_sales, because they describe a
-- deal: an owner pays us lot rent, we charge them a management fee. A home
-- we own that we let has no sale and no second party -- we are both sides
-- of it -- so there is no row for the rent to sit on, and the rent is the
-- only money there is. It goes on the unit.
--
-- In cents, like 032, because a rent of 775.00 stored as a float is a
-- rounding argument waiting to happen.
alter table units
  add column if not exists tenant_rent_cents integer,
  add column if not exists pet_fee_cents     integer,
  add column if not exists late_fee_cents    integer;

alter table units drop constraint if exists unit_money_is_not_negative;
alter table units
  add constraint unit_money_is_not_negative
  check (coalesce(tenant_rent_cents, 0) >= 0
     and coalesce(pet_fee_cents, 0)     >= 0
     and coalesce(late_fee_cents, 0)    >= 0);

-- No grant here, deliberately. Everything else in this file follows 031,
-- which added home_kind and we_manage to the same table and granted
-- nothing: units is written through the service-role client, and the
-- table carries no privilege for `authenticated` to extend. Granting
-- select on these four columns alone would hand them to every signed-in
-- session, which is a privilege nobody asked for.

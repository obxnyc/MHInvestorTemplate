-- The trade directory, and what we buy
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- Built ON contacts rather than beside them. A plumber who texts the line is
-- already a contact with a thread, a phone number and a history; a separate
-- rolodex would be a second record for the same person that drifts from the
-- first within a month, and the one you text would not be the one with the
-- notes on it.

-- ---------------------------------------------------------------- markets
--
-- "Our plumber" stops being a single answer the moment there is a second town.
-- A table rather than a text column because a market is a thing that gets
-- renamed, split and reported on, and because "Elizabeth City", "elizabeth
-- city" and "EC" typed by three people is not a market, it is three.
create table if not exists markets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  state      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table properties add column if not exists market_id uuid references markets(id);

-- ---------------------------------------------------------------- trades
--
-- A lookup table, not an enum. Mobile-home work has trades that general
-- property management does not -- releveling, tie-downs, skirting -- and the
-- list will keep growing. An enum would mean a migration every time somebody
-- hires a new kind of contractor.
create table if not exists trades (
  id    text primary key,          -- 'plumbing', 'hvac', short and stable
  label text not null,
  sort  smallint not null default 100
);

insert into trades (id, label, sort) values
  ('plumbing',     'Plumbing',            10),
  ('hvac',         'HVAC',                20),
  ('electrical',   'Electrical',          30),
  ('handyman',     'Handyman',            40),
  ('appliance',    'Appliance repair',    50),
  ('roofing',      'Roofing',             60),
  ('flooring',     'Flooring',            70),
  ('pest',         'Pest control',        80),
  ('septic',       'Septic & sewer',      90),
  ('well_water',   'Well & water',       100),
  ('releveling',   'Releveling',         110),
  ('tiedowns',     'Tie-downs & anchors',120),
  ('skirting',     'Skirting',           130),
  ('transport',    'Home transport',     140),
  ('landscaping',  'Landscaping & trees',150),
  ('cleaning',     'Cleaning & turns',   160),
  ('hauling',      'Hauling & dumpsters',170),
  ('locksmith',    'Locksmith',          180),
  ('supplier',     'Supplier',           190),
  ('other_trade',  'Other',              900)
on conflict (id) do update set label = excluded.label, sort = excluded.sort;

-- Many-to-many both ways, because both are genuinely many.
--
-- A handyman who also does light plumbing is one person with two trades, and
-- forcing a single choice means he stops appearing in half the searches he
-- should. A supplier with branches in two towns is one company in two markets.
-- A single column for either would be a lie that costs a phone call.
create table if not exists vendor_trades (
  contact_id uuid not null references contacts(id) on delete cascade,
  trade_id   text not null references trades(id),
  primary key (contact_id, trade_id)
);

create table if not exists vendor_markets (
  contact_id uuid not null references contacts(id) on delete cascade,
  market_id  uuid not null references markets(id) on delete cascade,
  primary key (contact_id, market_id)
);

-- What the office needs to know about a trade beyond how to ring them.
alter table contacts
  add column if not exists company      text,
  add column if not exists email        text,
  add column if not exists notes        text,
  add column if not exists insured_until date,
  add column if not exists preferred    boolean not null default false;

create index if not exists vendor_trades_trade  on vendor_trades (trade_id);
create index if not exists vendor_markets_mkt   on vendor_markets (market_id);
create index if not exists contacts_preferred   on contacts (preferred) where preferred;

-- ---------------------------------------------------------------- materials
--
-- The parts that get bought over and over: a water heater element, a skirting
-- panel, a 4-inch trap. Kept apart from who sells them, because the same part
-- has a different supplier, SKU and price in every market -- and that is the
-- whole reason for writing it down.
create table if not exists materials (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text,                  -- loose on purpose; this is a shopping list
  spec       text,                  -- "40 gal, 4500W" -- the bit that gets got wrong
  unit       text not null default 'each',
  notes      text,
  created_at timestamptz not null default now(),
  unique (name, spec)
);

create table if not exists material_sources (
  id           uuid primary key default gen_random_uuid(),
  material_id  uuid not null references materials(id) on delete cascade,
  supplier_id  uuid not null references contacts(id) on delete cascade,
  market_id    uuid references markets(id) on delete set null,
  sku          text,
  price_cents  integer,
  -- A price with no date is a rumour. Everything that reads this should be
  -- able to say how old the number is.
  priced_on    date,
  updated_at   timestamptz not null default now(),
  unique (material_id, supplier_id, market_id)
);

create index if not exists material_sources_market on material_sources (market_id);

-- ---------------------------------------------------------------- access
alter table markets          enable row level security;
alter table trades           enable row level security;
alter table vendor_trades    enable row level security;
alter table vendor_markets   enable row level security;
alter table materials        enable row level security;
alter table material_sources enable row level security;

revoke all on markets, trades, vendor_trades, vendor_markets,
              materials, material_sources from anon;
revoke insert, update, delete on markets, trades, vendor_trades, vendor_markets,
              materials, material_sources from authenticated;

do $$
declare t text;
begin
  foreach t in array array['markets','trades','vendor_trades','vendor_markets',
                           'materials','material_sources'] loop
    execute format('drop policy if exists staff_reads_%1$s on %1$I', t);
    execute format(
      'create policy staff_reads_%1$s on %1$I for select using (is_active_staff())', t);
  end loop;
end $$;

-- A first market, so the directory is usable the moment it loads. Renaming it
-- is one edit; starting with an empty dropdown is a dead end.
insert into markets (name, state) values ('Elizabeth City', 'NC')
on conflict (name) do nothing;

do $$ begin
  raise notice 'trade directory and materials catalogue are ready';
end $$;

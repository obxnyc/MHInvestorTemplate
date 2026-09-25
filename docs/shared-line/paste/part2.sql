create table if not exists markets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  state      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table properties add column if not exists market_id uuid references markets(id);

create table if not exists trades (
  id    text primary key,
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

alter table contacts
  add column if not exists company      text,
  add column if not exists email        text,
  add column if not exists notes        text,
  add column if not exists insured_until date,
  add column if not exists preferred    boolean not null default false;

create index if not exists vendor_trades_trade  on vendor_trades (trade_id);
create index if not exists vendor_markets_mkt   on vendor_markets (market_id);
create index if not exists contacts_preferred   on contacts (preferred) where preferred;

create table if not exists materials (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text,
  spec       text,
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
  priced_on    date,
  updated_at   timestamptz not null default now(),
  unique (material_id, supplier_id, market_id)
);

create index if not exists material_sources_market on material_sources (market_id);

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

insert into markets (name, state) values ('Elizabeth City', 'NC')
on conflict (name) do nothing;

do $$ begin
  raise notice 'trade directory and materials catalogue are ready';
end $$;

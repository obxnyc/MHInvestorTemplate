-- 034 — what the investor is actually owed
--
-- The arrangement on an investor-owned home, in the owner's own words:
-- we sold them the home and hold the note, so they pay us a mortgage, a
-- lot fee and a consultancy fee. They either pay us a warranty fee or
-- they carry their own insurance. The tenant living in the home pays
-- rent, to us. Anything that breaks, we pay for and take off what we
-- send them. What they get is the rent, less all of it.
--
-- 032 recorded every charge in that list except the last. Without the
-- expenses there is no statement -- the figure at the bottom is the one
-- the whole page exists to produce, and it is the only one that cannot
-- be worked out from the agreement.

-- ---------------------------------------------------------------------
-- 1. Their own insurance, which is not the same as no warranty.
-- ---------------------------------------------------------------------
--
-- A blank warranty fee has meant two different things: nobody has filled
-- it in yet, and this owner insures the home themselves so there is no
-- fee to charge. On a statement those are not interchangeable -- one is
-- a gap and the other is an answer -- so the answer gets its own column.
alter table home_sales
  add column if not exists owner_insures boolean not null default false;

-- Charging for a warranty on a home the owner insures is a line nobody
-- can explain to the person paying it.
alter table home_sales drop constraint if exists own_insurance_pays_no_warranty;
alter table home_sales
  add constraint own_insurance_pays_no_warranty
  check (not owner_insures or coalesce(warranty_cents, 0) = 0);

comment on column home_sales.owner_insures is
  'The owner carries their own insurance on the home, so there is no '
  'warranty fee. Distinct from warranty_cents being null, which means '
  'nobody has said yet.';

-- ---------------------------------------------------------------------
-- 2. What we spent on the home.
-- ---------------------------------------------------------------------
--
-- A row per thing bought or paid for, against the lot. Not against the
-- sale: a water heater fitted in March is a fact about the home, and it
-- stays true when the home changes hands in June. The sale it was
-- deducted from is recorded separately, so a statement can be rebuilt
-- without guessing which owner was holding the home that month.
create table if not exists home_expenses (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  -- Whose cheque it comes off, where it comes off one at all. Null for a
  -- home we own: there is nobody to deduct it from.
  sale_id     uuid references home_sales(id) on delete set null,

  spent_on    date not null default current_date,
  -- Plain words, because this line is read by the person paying it.
  -- "Water heater" beats "MAINT-04".
  what        text not null check (length(btrim(what)) > 0),
  amount_cents integer not null check (amount_cents > 0),

  -- Whether it is deducted from what we send the owner. Not everything
  -- is: a repair covered by the warranty they are paying for is ours, and
  -- so is damage we caused.
  from_owner  boolean not null default true,

  -- Which month's statement it lands on. Usually the month it was spent,
  -- but an invoice that arrives on the 2nd belongs to the month before,
  -- and arguing about that after the statement has gone out is worse
  -- than having a column for it.
  bills_on    date,

  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references staff(id) on delete set null
);

create index if not exists home_expenses_by_unit
  on home_expenses (unit_id, spent_on desc);
create index if not exists home_expenses_by_sale
  on home_expenses (sale_id, spent_on desc) where sale_id is not null;

-- Deducting from nobody is not a deduction. A row that says it comes off
-- the owner's cheque has to say whose.
alter table home_expenses drop constraint if exists deduction_names_a_sale;
alter table home_expenses
  add constraint deduction_names_a_sale
  check (not from_owner or sale_id is not null);

alter table home_expenses enable row level security;

-- A policy filters a privilege; it does not grant one. Both are needed.
drop policy if exists staff_reads_home_expenses on home_expenses;
create policy staff_reads_home_expenses on home_expenses
  for select using (is_active_staff());
drop policy if exists staff_writes_home_expenses on home_expenses;
create policy staff_writes_home_expenses on home_expenses
  for all using (is_active_staff()) with check (is_active_staff());

grant select, insert, update, delete on home_expenses to authenticated;

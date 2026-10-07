-- 030 — a park drawn as a plan, and who bought which home
--
-- Two things, because they are the same screen.
--
-- The plan first. 024 gave a unit map_x/map_y as fractions of an uploaded
-- image. A park drawn from scratch wants the same fractions and no image:
-- every home in a park is the same home, so a lot is a rectangle of fixed
-- size at a position and an angle, and the "site plan" is the arrangement
-- rather than a photograph of one.
alter table properties
  drop constraint if exists properties_map_kind_check;
alter table properties
  add constraint properties_map_kind_check
  check (map_kind in ('none','aerial','image','plan'));

alter table units
  -- Degrees clockwise from horizontal. The homes on Lady Cheryl sit at about
  -- 30 degrees to the street and a grid of squares does not look like the
  -- place anybody is standing in.
  add column if not exists map_rot smallint;

-- Who owns the home on the lot, and on what terms.
--
-- The lot is ours and the home on it is not: an investor buys the home, it
-- sits on our pad, they pay a lot fee, and we often financed the purchase. So
-- "who owns #3107" is a question with a date on it, not a column -- homes get
-- sold on, taken back, and sold again, and a single owner_id on the unit
-- loses every one of those the moment it is overwritten.
--
-- Hence a row per sale. The current owner is the sale that has not ended.
create table if not exists home_sales (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references units(id) on delete cascade,
  -- The buying entity, which is an owner record rather than free text so the
  -- same investor across nine lots is one thing and not nine spellings.
  owner_id      uuid not null references owners(id) on delete restrict,

  sold_on       date not null,
  -- Cents, never a float. A balance a cent out is an argument with somebody
  -- who is right, and these are balances people pay monthly for years.
  price_cents   integer not null check (price_cents >= 0),
  down_cents    integer not null default 0 check (down_cents >= 0),

  -- We finance most of these ourselves and deduct the payment on the 15th
  -- rather than being paid directly, so the terms belong here next to the
  -- sale and not in somebody's spreadsheet.
  financed      boolean not null default false,
  monthly_cents integer check (monthly_cents is null or monthly_cents >= 0),
  rate_bps      smallint check (rate_bps is null or rate_bps between 0 and 5000),
  term_months   smallint check (term_months is null or term_months between 1 and 480),
  first_due_on  date,
  constraint financed_terms check (
    not financed or (monthly_cents is not null and term_months is not null)
  ),

  -- The home itself. Kept with the sale rather than on the lot because the
  -- lot outlives the home: a 1998 single-wide gets hauled off and a 2024 one
  -- arrives, and the lot is still lot 3107.
  home_year     smallint check (home_year is null or home_year between 1950 and 2100),
  home_make     text,
  home_serial   text,

  -- Null while they still own it. Set when they sell it on, when we take it
  -- back, or when the home leaves the park.
  ended_on      date,
  ended_why     text,
  constraint ended_needs_a_reason check (
    ended_on is null or length(trim(coalesce(ended_why, ''))) >= 3
  ),
  constraint ended_after_sold check (ended_on is null or ended_on >= sold_on),

  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references staff(id) on delete set null
);

create index if not exists home_sales_by_unit on home_sales (unit_id, sold_on desc);
create index if not exists home_sales_by_owner on home_sales (owner_id, sold_on desc);

-- One live sale per lot. Two people cannot both currently own the same home,
-- and the moment they appear to, every lot-fee and note-payment figure built
-- on top of this is wrong.
create unique index if not exists home_sales_one_current
  on home_sales (unit_id) where ended_on is null;

alter table home_sales enable row level security;
revoke all on home_sales from anon;
-- Recorded and corrected by the office, so update is allowed here -- unlike a
-- vendor invoice, this is our own record of our own agreement, and a typo in
-- a serial number should be fixable without a ceremony. Delete is not: a sale
-- that stopped being true gets an ended_on, which keeps the history.
revoke delete on home_sales from authenticated;
grant select, insert, update on home_sales to authenticated;

drop policy if exists staff_reads_home_sales on home_sales;
create policy staff_reads_home_sales on home_sales
  for select using (is_active_staff());
drop policy if exists staff_writes_home_sales on home_sales;
create policy staff_writes_home_sales on home_sales
  for insert with check (is_active_staff());
drop policy if exists staff_updates_home_sales on home_sales;
create policy staff_updates_home_sales on home_sales
  for update using (is_active_staff()) with check (is_active_staff());

do $$ begin
  raise notice 'a park can be drawn, and a home can be sold';
end $$;

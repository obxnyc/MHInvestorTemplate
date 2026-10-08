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

-- 062 Reserves: what we hold for an owner, and what the agreement requires.
--
-- Every statement now says what is held for the owner -- security deposits
-- and reserves -- and the screen flags "Reserves not met" when we hold none,
-- or less than the agreement requires. Reserves are the owner's, carried from
-- month to month, so they live on the payee. Deposits stay on the statement,
-- where Alex's sheet reports them each month, and can be corrected there.
--
-- The "Potential issue detected" warning is the `alter table ... add column`.
-- Nothing is removed. Safe to re-run.

alter table distribution_payees add column if not exists reserve_held_cents integer
  check (reserve_held_cents is null or reserve_held_cents >= 0);
alter table distribution_payees add column if not exists reserve_required_cents integer
  check (reserve_required_cents is null or reserve_required_cents >= 0);

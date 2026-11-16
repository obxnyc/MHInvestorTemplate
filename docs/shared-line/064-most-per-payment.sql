-- 064 The most Wells Fargo Bill Pay sends in one payment.
--
-- Bill Pay allows $25,000 a day AND $5,000 a payment. An owner owed more than
-- $5,000 -- RNMK, $17,204.08 in November 2026 -- is paid in pieces, each its
-- own Bill Pay payment with its own confirmation number. Kept with the month
-- like the daily limit, so the plan says what it was planned under.
--
-- The "Potential issue detected" warning is the `alter table ... add column`.
-- Nothing is removed. Safe to re-run.

alter table distribution_runs add column if not exists per_payment_cap_cents integer not null default 500000
  check (per_payment_cap_cents > 0);

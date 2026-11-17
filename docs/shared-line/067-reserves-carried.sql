-- 067 Reserves that move with the statements.
--
-- An expense line put into reserves ("Reserve Fund", $2,500) is money we
-- now hold for the owner. When the month's income does not cover it, the
-- part not covered ($56.10) is held anyway and comes out of the next
-- statement -- so the reserve is $2,443.90 of $2,500 now and whole once that
-- next statement is paid.
--
-- distribution_payees.reserve_pending_cents: the part not yet covered, made
--   good out of the next statement that comes out positive.
-- distribution_statements.reserve_before_cents / reserve_pending_before_cents:
--   what was held (and pending) before this statement, recorded when it is
--   sent, so a sent statement keeps saying what it said while the owner's
--   balance moves on.
--
-- The "Potential issue detected" warning is the `alter table ... add column`.
-- Nothing is removed. Safe to re-run.

alter table distribution_payees add column if not exists reserve_pending_cents integer not null default 0;
alter table distribution_statements add column if not exists reserve_before_cents integer;
alter table distribution_statements add column if not exists reserve_pending_before_cents integer;

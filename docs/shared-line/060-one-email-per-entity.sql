-- 060 One email per owning entity.
--
-- SHB Investments owns homes at 1148 Northside and at Cross Creek; that is
-- two statements and one owner, so one email with each park's P&L in its own
-- block. Gabriel Moskow owns Elizabeth City Property LLC AND 105 Twiddy LLC;
-- those are two entities and stay two emails, even to the same address.
--
-- So the grouping is an explicit name on the payee, not inferred from the
-- address: two entities sharing an inbox must not be merged, and one entity
-- spelled two ways in the sheets ("Elizabeth City Property" and "... LLC")
-- must be. Empty means the payee is its own entity.
--
-- The "Potential issue detected" warning is the `alter table ... add column`.
-- Nothing is removed. Safe to re-run.

alter table distribution_payees add column if not exists entity text;

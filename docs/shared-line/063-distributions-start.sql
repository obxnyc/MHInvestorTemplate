-- 063 When an owner's distributions start.
--
-- An owner can buy homes before they produce anything: Conor Dolan bought
-- four at Cross Creek that will not be ready until December 2026, so there is
-- no November statement to send him for them. The month distributions start
-- lives on the payee; before it, the statement is kept on the screen (Alex's
-- sheet still lists the costs) but is never emailed, never counted in what
-- is owed, and never planned for payment.
--
-- Empty: distributions have started. The "Potential issue detected" warning
-- is the `alter table ... add column`. Nothing is removed. Safe to re-run.

alter table distribution_payees add column if not exists starts_on date
  check (starts_on is null or extract(day from starts_on) = 1);

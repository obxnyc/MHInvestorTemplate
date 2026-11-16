-- 066 A statement somebody has checked.
--
-- "I want to make sure it all looks right before an owner gets an email."
-- A statement is marked checked by a person, and any change to it afterwards
-- (its lines, note, deposits, or the owner's own details) takes the mark off
-- again -- a tick on a statement that has since changed is a tick on a
-- different statement. Sending a statement nobody has checked needs saying
-- so, out loud, on the screen.
--
-- The "Potential issue detected" warning is the `alter table ... add column`.
-- Nothing is removed. Safe to re-run.

alter table distribution_statements add column if not exists checked_at timestamptz;
alter table distribution_statements add column if not exists checked_by uuid references staff(id);

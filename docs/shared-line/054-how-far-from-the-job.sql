-- 054: how far from the job a clock-in was.
--
-- The clock screen now asks where you are BEFORE which job, suggests the
-- nearest, and asks "are you sure?" when the job chosen is far away. What is
-- chosen is filed; this records how far the phone was from it, so the lead's
-- 8:45 report can say "off site, 4.2 mi" rather than only "off site", and so
-- a clock-in from bed is a number and not an impression.
--
-- Null when there was no position, or the job has no pin -- the two cases
-- where nothing could be measured, which the reports say in words.
--
-- Safe to re-run.

alter table shifts add column if not exists start_metres integer
  check (start_metres is null or start_metres >= 0);

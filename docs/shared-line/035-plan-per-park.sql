-- 035 — each park's own layout
--
-- The plan has been a constant in the code: the streets of The Retreat
-- at Cross Creek, its bearing, its spacings and its fifty one numbers.
-- That was right while there was one park and is wrong the moment there
-- are two, because the second one opens showing the first one's streets.
--
-- Stored as json rather than as tables. A plan is a description read and
-- written whole -- rows of numbers along named streets, with the angle
-- and the spacings -- and it is never queried across parks. Four tables
-- to hold a thing nothing joins to is four tables to migrate every time
-- a park turns out to have a shape nobody expected, and they keep
-- turning out to.
alter table properties
  add column if not exists plan jsonb;

comment on column properties.plan is
  'How this park is laid out: centre, bearing, pad spacing, and the rows '
  'of lot numbers along each named street. Read and written whole by the '
  'plan screen. Null means nobody has described this park yet.';

-- It is a description, not an array of them, and not a string that
-- happens to parse. A check here is worth more than a validation in one
-- caller, because the plan screen is not the only thing that will write
-- this.
alter table properties drop constraint if exists plan_is_an_object;
alter table properties
  add constraint plan_is_an_object
  check (plan is null or jsonb_typeof(plan) = 'object');

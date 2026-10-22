-- Which LOT the hours went against
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query
-- containing alter, drop or update, and this file has all three. What the
-- destructive-looking lines do: `drop trigger if exists` removes the previous
-- version of the one trigger below before recreating it, and the `update` is
-- the word `update of` in that trigger's definition, which is when it fires.
-- Nothing is deleted.
--
-- A shift records a property. A park is a hundred homes, so hours filed
-- against the park say nothing about which one -- and "if we are doing work
-- on a specific lot we need to know for tracking purposes" is the whole
-- reason the clock exists at all. Labour against the wrong home is a bill
-- somebody argues with; labour against no home is a bill nobody can check.

alter table shifts add column if not exists unit_id uuid
  references units(id) on delete set null;

create index if not exists shifts_unit on shifts (unit_id);

-- THE LOT OWNS THE ANSWER TO "WHICH PROPERTY".
--
-- Both columns are on the row, so they can disagree -- a shift against lot 20
-- of Northside and property_id pointing at The Retreat is two different
-- claims about where somebody was, and nothing in the table would object. A
-- CHECK cannot settle it, because the answer lives in another table.
--
-- So the property is DERIVED rather than checked. A mismatch is not rejected,
-- it is impossible: whatever the lot says wins, on the way in and on every
-- later change. A validation that can be forgotten at one call site is a
-- validation that will be.
create or replace function shift_property_follows_unit()
returns trigger language plpgsql as $$
begin
  if new.unit_id is not null then
    select property_id into new.property_id from units where id = new.unit_id;
  end if;
  return new;
end $$;

drop trigger if exists shift_property_follows_unit on shifts;
create trigger shift_property_follows_unit
  before insert or update of unit_id, property_id on shifts
  for each row execute function shift_property_follows_unit();

-- Deliberately NOT backfilled. Every shift already filed against a park
-- stays filed against the park, because nobody knows which lot it was and a
-- guess here is a number somebody would bill from.

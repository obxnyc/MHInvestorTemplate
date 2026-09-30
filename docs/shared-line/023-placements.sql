-- Where a lot sits HERE, when that differs from Rent Manager
--
-- Run in the Supabase SQL editor, after 022. Safe to run twice.
--
-- Twelve lots are in no park group over there and one is in the park next
-- door. The obvious fix is to correct Rent Manager, and the obvious fix is
-- wrong at this stage: nobody remembers why they were filed that way, and a
-- filing that looks like an oversight is sometimes a decision whose reason
-- has been forgotten. Writing into somebody's book of record on the strength
-- of a street number is not a thing to do while that is still an open
-- question.
--
-- So placement becomes ours. A row here says "whatever Rent Manager thinks,
-- treat this property as a lot of that park" -- or as standing on its own,
-- which is the other direction and equally necessary. Rent Manager is
-- untouched, the import reads this on top of what it finds there, and any
-- row can be deleted to fall straight back to their answer.
--
-- Keyed on their PropertyID rather than on anything of ours, because the
-- override has to exist BEFORE the import creates a unit to hang it off.

create table if not exists rm_placements (
  rm_property_id integer primary key,
  -- The rm_groups row to treat it as belonging to. Null means the opposite
  -- decision: leave it standing alone whatever group it is in over there.
  park_group     text references rm_groups(name) on update cascade on delete set null,
  -- Why, in whoever's words. A placement with no reason is one nobody can
  -- review, and the whole point of this table is that it stays reviewable.
  why            text,
  -- What Rent Manager said at the time, so a later change over there is
  -- visible rather than silently overridden for ever.
  was_in         text,
  placed_at      timestamptz not null default now(),
  placed_by      uuid references staff(id) on delete set null
);

alter table rm_placements enable row level security;
revoke all on rm_placements from anon;
revoke insert, update, delete on rm_placements from authenticated;
drop policy if exists staff_reads_placements on rm_placements;
create policy staff_reads_placements on rm_placements for select using (is_active_staff());
grant select on rm_placements to authenticated;

do $$ begin
  raise notice 'a lot can be placed here without touching Rent Manager';
end $$;

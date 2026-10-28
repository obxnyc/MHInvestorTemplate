-- What Rent Manager calls a place, and which of ours it is
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query with
-- alter, drop or update in it. Here that is `drop policy if exists`, which
-- removes the previous copy of a policy before creating it again. Nothing is
-- deleted and no existing row changes.
--
-- A maintenance request arrives from Tenant Web Access with the place in its
-- subject line: "114 Lisas Way, 114 Lisas Way". That is Rent Manager's name
-- for it, not ours, and nothing here has ever matched the two up -- so a
-- request lands with a tenant, a phone number and nowhere to file it.
--
-- Matching text to a property every time it arrives is the wrong shape: it
-- would be a guess, repeated, and a guess that lands on the wrong home is
-- worse than one that lands on none. So somebody confirms it ONCE and this
-- remembers -- "that is our SFH-014" -- and the next request from that
-- address files itself.

create table if not exists place_aliases (
  -- The subject line's place, normalised: lower case, punctuation gone, a
  -- repeated half collapsed, so "114 Lisas Way, 114 Lisas Way" and
  -- "114 Lisas Way" are one key. See placeKey() in lib/alias.ts, which is
  -- the only thing that may produce this value.
  key         text primary key,
  -- Exactly as it arrived, so somebody can see what was matched rather than
  -- the normalised form, which is for machines.
  saw         text not null,
  property_id uuid not null references properties(id) on delete cascade,
  -- Null where the property has no lots, which is most single homes.
  unit_id     uuid references units(id) on delete set null,
  -- Who said so, and when. A mapping nobody can account for is one nobody
  -- will dare correct.
  by_staff    uuid references staff(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists place_aliases_property on place_aliases (property_id);

-- WHAT THE REQUEST SAID THE PLACE WAS, kept on the thread.
--
-- Without it the screen cannot offer to match anything: the subject line is
-- inside the first message's body, and asking somebody to read it back out of
-- the text and retype it is asking them to do the computer's job. It is also
-- what the alias is stored under when they confirm.
--
-- Null on everything that did not arrive from Tenant Web Access, which is
-- most things, and null is the honest answer there -- a text message has no
-- subject line.
alter table conversations add column if not exists place_hint text;

-- The ones nobody has placed yet, which is the queue this creates.
create index if not exists conversations_unplaced
  on conversations (place_hint)
  where place_hint is not null and unit_id is null;

alter table place_aliases enable row level security;
revoke all on place_aliases from anon;

drop policy if exists staff_reads_place_aliases on place_aliases;
create policy staff_reads_place_aliases on place_aliases
  for select using (is_active_staff());

grant select on place_aliases to authenticated;
-- Written by the route with the service role, which checks who is asking.
-- Deliberately not grantable to `authenticated`: an alias decides which home
-- a work order is filed against, and a read-only guest must not be able to
-- set one by calling the database directly.
revoke insert, update, delete on place_aliases from authenticated;

-- The deal somebody is working on
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query with
-- alter, drop or update in it. Here that is `drop policy if exists`, which
-- takes the previous copy of a policy off before creating it again, and
-- `alter table ... enable row level security`. Nothing is deleted and no
-- existing row changes.
--
-- Eight homes to one investor is sixteen documents, and the figures, the
-- template, the switches and the line that identifies each home are typed in
-- on one screen. Until now all of it lived in the browser tab: reload, or
-- open the owner again tomorrow, and the afternoon was gone with no warning
-- that it was going to be.
--
-- One row per investor, because that is what a deal is here -- the terms the
-- screen is showing for them right now. It is a DRAFT and nothing else reads
-- it: the sale itself is still recorded on the lot card, and a document is
-- still the thing that was printed. This is so that coming back to the screen
-- shows what was left on it.

create table if not exists deal_drafts (
  owner_id   uuid primary key references owners(id) on delete cascade,
  -- The whole screen: terms, which homes are ticked, the homes typed in by
  -- hand, and what each home is called on the papers. Kept as one document
  -- rather than as columns because it is one thing that is saved and read
  -- back together, and because a new switch on the papers panel should not
  -- need a migration.
  deal       jsonb not null,
  updated_at timestamptz not null default now(),
  -- Who left it this way. Two people at the desk working the same investor
  -- is rare and reading "Ben, an hour ago" beats wondering.
  by_staff   uuid references staff(id) on delete set null
);

alter table deal_drafts enable row level security;
revoke all on deal_drafts from anon;

drop policy if exists staff_reads_deal_drafts on deal_drafts;
create policy staff_reads_deal_drafts on deal_drafts
  for select using (is_active_staff());

grant select on deal_drafts to authenticated;
-- Written by the route with the service role, which checks the role of
-- whoever is asking. Deliberately not grantable to `authenticated`: a
-- read-only guest looking round the app must not be able to change the terms
-- of somebody's deal by calling the database directly.
revoke insert, update, delete on deal_drafts from authenticated;

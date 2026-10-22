-- Asking for another setup link
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query with
-- alter, drop or update in it. The only one here is the `alter table` adding
-- a column. Nothing is dropped and nothing is deleted.
--
-- A setup link works once, which is right, and the screen it leaves behind
-- said "ask the office to send another" with nothing to tap and no way for
-- the office to find out. A man standing in a driveway at seven in the
-- morning does not have a better channel than the phone he is holding.
--
-- One column, deliberately. Not a request table: there is nothing to record
-- beyond "this person is waiting", the invite row already says who they are,
-- and a second asking is the same fact as the first.

alter table staff_invites add column if not exists reasked_at timestamptz;

-- The office's list is ordered by who is waiting, so this is what it sorts on.
create index if not exists staff_invites_reasked
  on staff_invites (reasked_at desc nulls last)
  where reasked_at is not null;

comment on column staff_invites.reasked_at is
  'When the holder of a spent link last asked for a new one. Null means they
   have not asked. Cleared when a fresh invite is sent.';

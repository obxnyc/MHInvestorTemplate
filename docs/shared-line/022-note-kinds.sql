-- A note somebody wrote, and a thing that happened
--
-- Run in the Supabase SQL editor, after 021. Safe to run twice.
--
-- The notes table has been carrying two different kinds of record since the
-- beginning. One is a person typing something for their colleagues: "landlord
-- says the water heater is out of warranty, do not promise a replacement".
-- The other is the system writing down what it did -- a category moved, a
-- message forwarded, a work order opened.
--
-- Both matter and both belong on the conversation. But they are not the same
-- thing to READ. Anything that gathers notes for review would bury the three
-- somebody wrote under forty the system logged, which is how a note gets
-- lost, which is the problem being solved.
--
-- Everything already there is classified by how it was phrased, because the
-- system's own lines are the ones it wrote and they are all formulaic. A
-- backfill that guesses is acceptable exactly once, on records nobody can
-- re-derive; from here each writer says which it is.

alter table notes
  add column if not exists kind text not null default 'note'
  check (kind in ('note','event'));

do $$
declare moved integer;
begin
  update notes set kind = 'event'
   where kind = 'note'
     and (body like 'Moved from %'
       or body like 'Moved to %'
       or body like 'Forwarded to %'
       or body like 'Work order opened%'
       or body like 'Still open: %'
       or author_id is null);
  get diagnostics moved = row_count;
  raise notice 'reclassified % logged events', moved;
end $$;

create index if not exists notes_kind on notes (conversation_id, kind, created_at desc);

do $$ begin
  raise notice 'a note somebody wrote is now distinguishable from a thing that happened';
end $$;

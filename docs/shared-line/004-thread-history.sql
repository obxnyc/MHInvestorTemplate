-- Notes the system writes
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- A thread can move between categories on its own now -- a tenant says
-- "excuse me?", the thread opens as General, and two minutes later they report
-- roaches. When that happens the move has to be written INTO the thread, not
-- just applied underneath it: whoever filed it as a general question needs to
-- see that it moved and why, rather than finding it in another queue and
-- assuming somebody made a mistake.
--
-- Those lines have no author. Attributing them to whoever happened to be
-- signed in would be a lie in the audit trail, and inventing a "system" staff
-- row would put a fake person in the roster, on the sign-in list, and in every
-- mention picker forever. A null author is the honest representation of
-- "nobody typed this".

alter table notes alter column author_id drop not null;

-- The insert policy is unchanged and still pins author_id to the signed-in
-- person, so a client cannot write an unattributed note and pass it off as the
-- system's. Only the service role, which no browser holds, can leave it null.

do $$ begin
  raise notice 'the system can record why a thread moved';
end $$;

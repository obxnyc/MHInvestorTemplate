-- Putting the backfill back in the past
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query
-- containing alter, drop or update. The `update` statements below are the
-- whole point of the file: they move two timestamps on rows that came from
-- the Rent Manager backfill. Nothing is deleted and no table is changed.
--
-- WHAT WENT WRONG. Every item pulled in from Rent Manager was stamped with
-- the moment it was pulled, not the moment the tenant submitted it. So a
-- backfill of months of history arrived at the top of the inbox, all dated
-- today, every one of them reading "just now" -- "I got a lot of maintenance
-- requests today but I feel like we actually only got 2 new ones."
--
-- The code no longer does that. This is for the rows already written.
--
-- The real date is recoverable because it was put in the body of the message
-- at the time: `Submitted: 2026-03-14T09:12:00`. Nothing is guessed -- a row
-- whose body does not carry a readable date is left exactly as it is.

-- 1. The messages.
with said as (
  select
    m.id,
    substring(m.body from 'Submitted:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.]+)')
      as stamp
  from messages m
  where m.body like '%From Rent Manager Service Manager, issue%'
)
update messages m
   set created_at = said.stamp::timestamptz
  from said
 where m.id = said.id
   -- WHAT PROTECTS THE CAST IS THE PATTERN ABOVE, not a second check here.
   -- `substring` only returns something when the body carries a date-shaped
   -- string, so "Submitted: whenever he gets round to it" comes back null
   -- and never reaches `::timestamptz`. A separate regex test here looked
   -- like the guard and was a no-op -- deleting it changed nothing, while
   -- loosening the pattern above failed the whole migration immediately.
   and said.stamp is not null
   -- Never into the future, and never forward: this only ever moves a row
   -- back to when it really happened. Running it twice changes nothing the
   -- second time.
   and said.stamp::timestamptz < now()
   and said.stamp::timestamptz < m.created_at;

-- 2. The threads those messages sit in, so the list sorts by when things
--    actually happened rather than when they were imported.
update conversations c
   set last_message_at = newest.at
  from (
    select m.conversation_id, max(m.created_at) as at
      from messages m
     group by m.conversation_id
  ) newest
 where c.id = newest.conversation_id
   and newest.at < c.last_message_at
   -- Only threads the backfill touched. A conversation that has a text in it
   -- as well is left alone: its newest message is the text, and that is the
   -- right answer already.
   and exists (
     select 1 from messages m2
      where m2.conversation_id = c.id
        and m2.body like '%From Rent Manager Service Manager, issue%'
   );

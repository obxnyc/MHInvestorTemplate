-- Larabee shared line — Supabase-specific setup: private file storage, and
-- the live-updating tables
--
-- Run AFTER schema.sql, in the Supabase SQL editor. This file is Supabase-only:
-- it depends on the `storage` schema that Supabase provides, which is why it is
-- kept out of schema.sql (that file is plain Postgres and is verified as such).
--
-- What lives here: photographs taken inside people's homes. A tenant sends a
-- picture of a leaking water heater and it shows their kitchen, their
-- possessions, sometimes their children. That is the standard this bucket is
-- built to, not "it's just a maintenance photo".

-- Private, not public. A public bucket serves every object to anyone who can
-- guess or leak the path, forever, with no log. Reads go through short-lived
-- signed URLs minted per request instead.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Paths are 'conversations/<conversation_id>/<message_sid>/<n>.<ext>'. Putting
-- the conversation id in the path is what lets the policy below reuse the
-- visibility rules that already exist, instead of inventing a second set that
-- can drift away from the first.
--
-- The subquery is the whole trick: `conversations` has its own row-level
-- security, so it returns nothing for a conversation this person may not open.
-- A tech who cannot see the thread cannot fetch its photographs, and that
-- follows automatically from the one rule rather than being restated here.
drop policy if exists staff_reads_conversation_media on storage.objects;
create policy staff_reads_conversation_media on storage.objects
for select to authenticated
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = 'conversations'
  -- Checked before the cast: a malformed path would otherwise raise instead of
  -- simply failing to match, and an erroring policy is a broken page.
  and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
  and exists (
    select 1 from conversations c
    where c.id = ((storage.foldername(name))[2])::uuid
  )
);

-- Nobody writes here from a browser. Uploads happen in the Twilio webhook,
-- which runs with the service role and bypasses these policies; granting
-- authenticated users insert rights would let a signed-in employee put
-- arbitrary files under any conversation's path. There is deliberately no
-- insert, update or delete policy.

-- Work-order photos live under the same bucket and the same conversation
-- folder, so a tech photographing a finished job gets the same rule as the
-- tenant who reported it. Nothing extra to configure.

-- ---------------------------------------------------------------- live updates

-- Two people work the same list at the same time, so a new text has to appear
-- on both screens without anyone refreshing. Supabase does that by streaming
-- changes to any table in the `supabase_realtime` publication.
--
-- Done here rather than by finding a toggle in the dashboard: the setting moves
-- between Database → Replication and Database → Publications depending on which
-- version of the console you get, and a missed toggle fails silently -- the app
-- works perfectly until two people are in it at once.
--
-- Each is wrapped because re-running this file must be safe: adding a table
-- that is already in the publication is an error, not a no-op.
do $$
begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then
  raise notice 'messages already streams live';
end $$;

do $$
begin
  alter publication supabase_realtime add table conversations;
exception when duplicate_object then
  raise notice 'conversations already streams live';
end $$;

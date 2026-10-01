-- 027 — photographs and files in the team's own messages
--
-- Tenant conversations got attachments in 026. Internal threads did not, and
-- that is backwards: a screenshot of somebody's ledger, a photo of a meter
-- reading, a PDF of an invoice — most of that is a thing you show a colleague,
-- not a thing you text a tenant. People were emailing them to themselves.

alter table dm_messages
  add column if not exists media_paths text[] not null default '{}';

-- Storage needs a rule of its own, because these do NOT live under
-- 'conversations/<id>/...' and must not. Putting an internal file under a
-- tenant conversation's prefix would hand it to the existing policy, which
-- grants every staff member who can open that conversation -- and a private
-- message between two colleagues is not company correspondence.
--
-- So team files live under 'dm/<thread_id>/...' and are granted by exactly the
-- rule that governs the messages themselves: in_dm_thread(), the same
-- SECURITY DEFINER function 013 wrote for dm_messages. One rule, asked twice,
-- rather than two rules that drift apart.
drop policy if exists member_reads_dm_media on storage.objects;
create policy member_reads_dm_media on storage.objects
for select to authenticated
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = 'dm'
  -- Checked before the cast: a malformed path would otherwise raise instead of
  -- simply failing to match, and an erroring policy is a broken page.
  and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
  and in_dm_thread(((storage.foldername(name))[2])::uuid)
);

-- Still no insert policy for anybody. Uploads go through the API route, which
-- establishes who you are and which thread you are in before it writes with
-- the service role. A policy generous enough to let a browser write here would
-- be generous enough to let it write into any thread's folder.

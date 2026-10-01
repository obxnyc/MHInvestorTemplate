-- 028 — let a note actually carry the attachment 026 gave it a column for
--
-- 026 added notes.media_paths. It did not grant it, and the INSERT grant on
-- this table is column-level by design:
--
--   grant insert (conversation_id, author_id, body, mentions) on notes to authenticated;
--
-- Column-level grants are the privacy mechanism here, not a nicety: row-level
-- security is row-level and cannot hide a column, so what a signed-in person
-- may write is decided by this list and nothing else. A column outside it does
-- not fail softly -- Postgres refuses the whole INSERT with "permission denied
-- for table notes", which reads like a policy problem and is not one. A policy
-- filters a privilege; it does not grant one.
--
-- The symptom was every note failing, including notes with no attachment at
-- all, because the application named the column whether or not it had anything
-- to put in it.

grant insert (media_paths) on notes to authenticated;

-- Nothing else changes. The select policy already covers the column, since it
-- is the row that is filtered and not the field, and the storage objects
-- themselves are governed by the bucket policy on the conversation prefix.

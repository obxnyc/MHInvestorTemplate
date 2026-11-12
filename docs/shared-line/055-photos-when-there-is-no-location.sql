-- 055: photos when the phone cannot say where it is.
--
-- A clock-in with no position now asks for two photos taken in the app: a
-- selfie (who) and the job -- the front of the house or the lot number
-- (where). They are stored in the private `attachments` bucket under
-- clock/<staff_id>/<server time>-<face|site>.<ext>; the time in the name is
-- the SERVER's, taken when the photo arrived, so it cannot be a phone's
-- clock set back. The clock-in route only accepts paths under the man's own
-- id and from the last fifteen minutes.
--
-- Safe to re-run.

alter table shifts add column if not exists start_photos text[];

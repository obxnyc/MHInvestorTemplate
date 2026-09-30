-- 026 — a note can carry a photograph too
--
-- Messages have had `media_paths` since the beginning: a tenant texts a
-- picture of a leaking heater and it lands in the thread. A note could not,
-- which meant the one place a screenshot of somebody's ledger actually
-- belongs -- internal, not texted to the tenant -- had nowhere to go, and
-- people were texting it to themselves instead.
--
-- Same shape as messages.media_paths, deliberately: same column name, same
-- type, same default, so the signing code reads both without a branch.
alter table notes
  add column if not exists media_paths text[] not null default '{}';

-- Nothing to change in storage. Note attachments live under the same
-- 'conversations/<id>/...' prefix as everything else in this bucket, so the
-- existing read policy -- which asks whether you may open the conversation --
-- already covers them, and there is still no insert policy for browsers.

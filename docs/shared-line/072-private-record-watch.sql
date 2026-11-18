-- 072: private conversations, the record, the watch-list, and areas a person
--      is not shown.
--
-- The owner, 18 November 2026:
--   * some conversations on the shared line are nobody else's business --
--     his with Instinct, Natashia's that Hannah should not read;
--   * but HE always sees everything, and there must be a separate place to go
--     back and check when something goes wrong -- the way a regulator keeps
--     chat logs;
--   * words and phrases he names should be brought to him as they happen;
--   * Natashia should not see owner distributions, pay and timesheets, the
--     crew trail, or investors.
--
-- Everything here is in the database rather than in the routes, because there
-- are a dozen ways a message gets written (texts in, replies out, notes, team
-- chat, forwards, broadcasts) and a rule kept in the routes is a rule the next
-- route forgets. Safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. Private conversations
--
-- private_to null: everybody who could see it before still can. A list: only
-- those people -- and whoever reads everything (staff.reads_all_dms, the
-- owner), always. A RESTRICTIVE policy, so it narrows every existing way of
-- seeing a conversation (office, team, assigned tech) rather than adding one.
-- Messages and notes are read through "the conversation is visible", so they
-- follow without a policy of their own.
-- ---------------------------------------------------------------------------
alter table conversations add column if not exists private_to uuid[];

create or replace function can_see_private(p uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select p is null or cardinality(p) = 0 or auth.uid() = any(p) or can_read_all_dms();
$$;

drop policy if exists private_stays_private on conversations;
create policy private_stays_private on conversations as restrictive
  for select using (can_see_private(private_to));

-- Calls carry a conversation and a voicemail transcript, and are readable by
-- all staff. A call on a private conversation is as private as the texts.
create or replace function call_is_visible(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_conversation is null or coalesce(
    (select can_see_private(c.private_to) from conversations c where c.id = p_conversation),
    true);
$$;
drop policy if exists private_calls_stay_private on calls;
create policy private_calls_stay_private on calls as restrictive
  for select using (call_is_visible(conversation_id));

-- ---------------------------------------------------------------------------
-- 2. The record
--
-- Every message, note and team-chat message as it was written, every edit as
-- it was edited, every deletion with what was deleted. Readable by whoever
-- reads everything and nobody else. It cannot be changed or emptied -- not by
-- the app, not by the service role, not from the SQL editor -- because a log
-- somebody could tidy is not a log.
-- ---------------------------------------------------------------------------
create table if not exists message_record (
  id bigserial primary key,
  at timestamptz not null default now(),
  event text not null check (event in ('sent', 'edited', 'deleted')),
  source text not null check (source in ('text', 'note', 'team')),
  source_id uuid not null,
  conversation_id uuid,
  thread_id uuid,
  author_id uuid,
  direction text,
  body text,
  media_paths text[],
  happened_at timestamptz
);
create index if not exists message_record_at on message_record (at desc);
create index if not exists message_record_conversation on message_record (conversation_id);
create index if not exists message_record_thread on message_record (thread_id);

alter table message_record enable row level security;
revoke all on message_record from anon, authenticated;
grant select on message_record to authenticated;
drop policy if exists owner_reads_record on message_record;
create policy owner_reads_record on message_record for select using (can_read_all_dms());

create or replace function message_record_is_permanent() returns trigger
language plpgsql as $$
begin
  raise exception 'The message record cannot be changed or deleted.';
end $$;
drop trigger if exists message_record_permanent on message_record;
create trigger message_record_permanent before update or delete on message_record
  for each row execute function message_record_is_permanent();
drop trigger if exists message_record_no_truncate on message_record;
create trigger message_record_no_truncate before truncate on message_record
  for each statement execute function message_record_is_permanent();

create or replace function keep_message_record() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  ev text;
  src text := tg_argv[0];
begin
  if tg_op = 'INSERT' then ev := 'sent'; r := new;
  elsif tg_op = 'UPDATE' then
    if new.body is not distinct from old.body
       and new.media_paths is not distinct from old.media_paths then
      return new;
    end if;
    ev := 'edited'; r := new;
  else ev := 'deleted'; r := old;
  end if;

  if src = 'text' then
    insert into message_record (event, source, source_id, conversation_id, author_id,
      direction, body, media_paths, happened_at)
    values (ev, src, r.id, r.conversation_id, r.sent_by, r.direction::text,
      r.body, r.media_paths, r.created_at);
  elsif src = 'note' then
    insert into message_record (event, source, source_id, conversation_id, author_id,
      body, media_paths, happened_at)
    values (ev, src, r.id, r.conversation_id, r.author_id, r.body, r.media_paths, r.created_at);
  else
    insert into message_record (event, source, source_id, thread_id, author_id,
      body, media_paths, happened_at)
    values (ev, src, r.id, r.thread_id, r.author_id, r.body, r.media_paths, r.created_at);
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists record_messages on messages;
create trigger record_messages after insert or update or delete on messages
  for each row execute function keep_message_record('text');
drop trigger if exists record_notes on notes;
create trigger record_notes after insert or update or delete on notes
  for each row execute function keep_message_record('note');
drop trigger if exists record_dm_messages on dm_messages;
create trigger record_dm_messages after insert or update or delete on dm_messages
  for each row execute function keep_message_record('team');

-- Everything already written, once, as it stands today.
insert into message_record (at, event, source, source_id, conversation_id, author_id,
  direction, body, media_paths, happened_at)
select m.created_at, 'sent', 'text', m.id, m.conversation_id, m.sent_by, m.direction::text,
  m.body, m.media_paths, m.created_at
from messages m
where not exists (select 1 from message_record x where x.source = 'text' and x.source_id = m.id);

insert into message_record (at, event, source, source_id, conversation_id, author_id,
  body, media_paths, happened_at)
select n.created_at, 'sent', 'note', n.id, n.conversation_id, n.author_id, n.body,
  n.media_paths, n.created_at
from notes n
where not exists (select 1 from message_record x where x.source = 'note' and x.source_id = n.id);

insert into message_record (at, event, source, source_id, thread_id, author_id,
  body, media_paths, happened_at)
select d.created_at, 'sent', 'team', d.id, d.thread_id, d.author_id, d.body,
  d.media_paths, d.created_at
from dm_messages d
where not exists (select 1 from message_record x where x.source = 'team' and x.source_id = d.id);

-- ---------------------------------------------------------------------------
-- 3. The watch-list
--
-- Words and phrases the owner names. Every new or edited message in the
-- record is checked as it is written; a match is a hit, and a hit asks the
-- app to tell the owner at once. Matching is whole words, case ignored, so
-- "loan" does not fire on "Sloane".
-- ---------------------------------------------------------------------------
create table if not exists watch_words (
  id uuid primary key default gen_random_uuid(),
  phrase text not null check (length(trim(phrase)) > 1),
  active boolean not null default true,
  created_by uuid references staff(id),
  created_at timestamptz not null default now()
);
create unique index if not exists watch_words_phrase on watch_words (lower(trim(phrase)));

create table if not exists watch_hits (
  id bigserial primary key,
  record_id bigint not null references message_record(id),
  phrase text not null,
  at timestamptz not null default now(),
  alerted_at timestamptz,
  seen_at timestamptz,
  unique (record_id, phrase)
);
create index if not exists watch_hits_unseen on watch_hits (at desc) where seen_at is null;

alter table watch_words enable row level security;
alter table watch_hits enable row level security;
revoke all on watch_words, watch_hits from anon, authenticated;
grant select, insert, update, delete on watch_words to authenticated;
grant select, update (seen_at) on watch_hits to authenticated;
drop policy if exists owner_keeps_watch_words on watch_words;
create policy owner_keeps_watch_words on watch_words for all
  using (can_read_all_dms()) with check (can_read_all_dms());
drop policy if exists owner_reads_watch_hits on watch_hits;
create policy owner_reads_watch_hits on watch_hits for select using (can_read_all_dms());
drop policy if exists owner_marks_watch_hits on watch_hits;
create policy owner_marks_watch_hits on watch_hits for update
  using (can_read_all_dms()) with check (can_read_all_dms());

-- A phrase as a whole-word, case-blind pattern. Every regex character in it is
-- escaped, so a phrase is always words and never a pattern somebody wrote.
create or replace function watch_pattern(p text) returns text
language sql immutable as $$
  select '(^|[^[:alnum:]_])'
    || regexp_replace(trim(p), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
    || '($|[^[:alnum:]_])';
$$;

create or replace function watch_the_record() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event = 'deleted' or coalesce(new.body, '') = '' then return new; end if;
  insert into watch_hits (record_id, phrase)
  select new.id, w.phrase from watch_words w
  where w.active and new.body ~* watch_pattern(w.phrase)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists watch_record on message_record;
create trigger watch_record after insert on message_record
  for each row execute function watch_the_record();

-- A hit asks the app to tell the owner. The key never leaves the database:
-- it is read from Vault here and checked by report_key_ok there, as every
-- scheduled job does (051). pg_net sends after the transaction commits, so a
-- message that is rolled back raises no alarm.
create or replace function watch_hit_alert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://app.larabeehomesllc.com/api/watch/alert',
    body := jsonb_build_object('hit', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'reports_cron_key')),
    timeout_milliseconds := 20000);
  return new;
exception when others then
  -- An alert that cannot be queued must not stop a text being received.
  -- The hit is still recorded, unalerted, and the record page shows it.
  raise warning 'watch alert not queued: %', sqlerrm;
  return new;
end $$;
drop trigger if exists watch_hit_alerts on watch_hits;
create trigger watch_hit_alerts after insert on watch_hits
  for each row execute function watch_hit_alert();

-- ---------------------------------------------------------------------------
-- 4. Areas a person is not shown
--
-- On the person, not the role: Alex is Office and runs the distributions;
-- Natashia is Office and does not see them. The app refuses the pages and
-- their APIs; these policies refuse the rows, so the data is not one direct
-- database call away either.
-- ---------------------------------------------------------------------------
alter table staff add column if not exists hidden_areas text[] not null default '{}';
grant select (hidden_areas) on staff to authenticated;

create or replace function area_hidden(p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff s where s.id = auth.uid() and p_area = any(s.hidden_areas));
$$;

do $$
declare
  t text; a text;
  pairs text[][] := array[
    array['distribution_payees','distributions'], array['distribution_payments','distributions'],
    array['distribution_recorded','distributions'], array['distribution_runs','distributions'],
    array['distribution_settings','distributions'], array['distribution_statements','distributions'],
    array['pay_runs','pay'], array['crew_setup','pay'], array['shifts','pay'],
    array['shift_breaks','pay'], array['shift_edits','pay'],
    array['shift_pings','trail'], array['staff_devices','trail'],
    array['owners','investors'], array['home_sales','investors'], array['sale_papers','investors'],
    array['signing_requests','investors'], array['deal_drafts','investors']];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    t := pairs[i][1]; a := pairs[i][2];
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists hidden_area on %I', t);
    execute format(
      'create policy hidden_area on %I as restrictive for all using (not area_hidden(%L)) with check (not area_hidden(%L))',
      t, a, a);
  end loop;
end $$;

-- Who has what hidden is set on the People screen, not here: a re-run of
-- this file must never put back an area the owner has since chosen to show.

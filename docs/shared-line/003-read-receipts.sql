-- Who has seen what
--
-- Run in the Supabase SQL editor, after schema.sql. Safe to run twice.
--
-- On a shared line the question "has anyone looked at this yet" is asked twenty
-- times a day and answered by shouting across an office. It is also the
-- question behind "why did nobody call her back" -- and the honest answer is
-- usually that four people each assumed one of the others had.
--
-- Stored per conversation rather than per message. A row per person per message
-- is a hundred times the writes for a distinction nobody uses: reading a thread
-- means reading it to the bottom. One timestamp per person per thread answers
-- "who has seen this message" exactly as well -- it is everyone whose last read
-- is at or after the message -- and it stays small enough to keep forever.

create table if not exists conversation_reads (
  conversation_id uuid not null references conversations(id) on delete cascade,
  staff_id        uuid not null references staff(id)         on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, staff_id)
);

create index if not exists conversation_reads_staff on conversation_reads (staff_id);

alter table conversation_reads enable row level security;
revoke all on conversation_reads from anon;
revoke insert, update, delete on conversation_reads from authenticated;

-- Everyone internal sees who has read what. That is the entire point: a receipt
-- only one person can see answers nothing.
drop policy if exists staff_read_receipts on conversation_reads;
create policy staff_read_receipts on conversation_reads
  for select using (is_active_staff());

-- Writes go through here rather than a table grant, so a signed-in client can
-- only ever record that IT read something -- never that somebody else did.
-- auth.uid() is taken from the session and cannot be passed in.
create or replace function mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active_staff() then
    raise exception 'only active staff can mark a conversation read';
  end if;

  -- Deliberately not checked against conversation visibility: this function
  -- runs as the owner, which bypasses row-level security, so any check here
  -- would be theatre. The worst a client can do with a conversation id it
  -- should not have is record that it read one -- no data comes back, and the
  -- id was already unguessable.
  insert into conversation_reads (conversation_id, staff_id, last_read_at)
  values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, staff_id)
    do update set last_read_at = now();
end $$;

revoke all on function mark_conversation_read(uuid) from public, anon;
grant execute on function mark_conversation_read(uuid) to authenticated;

-- Receipts appear on other people's screens as they happen, which is what makes
-- them useful in the minute that matters rather than in hindsight.
do $$
begin
  alter publication supabase_realtime add table conversation_reads;
exception when duplicate_object then
  raise notice 'conversation_reads already streams live';
end $$;

do $$ begin
  raise notice 'read receipts are on';
end $$;

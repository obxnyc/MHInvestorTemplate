-- Talking to each other
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- Deliberately NOT the conversations table. A conversation there is with
-- somebody outside -- a tenant, an applicant, a contractor -- and every part of
-- the inbox assumes that: it has a contact, a category, a claim, an SMS
-- history, a consent record. Putting "can you cover Tuesday" in there would
-- mean a thread with no contact, sitting in a queue of repair requests, that
-- somebody eventually tries to reply to over SMS.
--
-- So: a separate, much smaller thing. No categories, no claiming, no consent,
-- nothing leaves the building.

create table if not exists dm_threads (
  id         uuid primary key default gen_random_uuid(),
  -- Null for a one-to-one. A named group is a different intention and reads
  -- differently in a list.
  title      text,
  created_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  last_at    timestamptz not null default now()
);

create table if not exists dm_members (
  thread_id    uuid not null references dm_threads(id) on delete cascade,
  staff_id     uuid not null references staff(id) on delete cascade,
  last_read_at timestamptz,
  primary key (thread_id, staff_id)
);

create table if not exists dm_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references dm_threads(id) on delete cascade,
  author_id  uuid references staff(id) on delete set null,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists dm_messages_thread on dm_messages (thread_id, created_at);
create index if not exists dm_members_staff on dm_members (staff_id);

alter table dm_threads  enable row level security;
alter table dm_members  enable row level security;
alter table dm_messages enable row level security;

revoke all on dm_threads, dm_members, dm_messages from anon;
revoke insert, update, delete on dm_threads, dm_members, dm_messages from authenticated;

-- You read a thread if you are in it. Not "if you are staff" -- an admin can
-- read every tenant conversation in this system because that is the job, but a
-- private message between two colleagues is not company correspondence, and a
-- tool that quietly makes it so is a tool people stop being honest in.
--
-- SECURITY DEFINER for the same reason as elsewhere: a policy on dm_members
-- that queries dm_members would recurse.
create or replace function in_dm_thread(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dm_members m
    where m.thread_id = p_thread and m.staff_id = auth.uid()
  );
$$;

drop policy if exists member_reads_thread   on dm_threads;
drop policy if exists member_reads_members  on dm_members;
drop policy if exists member_reads_messages on dm_messages;

create policy member_reads_thread on dm_threads
  for select using (in_dm_thread(id));
create policy member_reads_members on dm_members
  for select using (in_dm_thread(thread_id));
create policy member_reads_messages on dm_messages
  for select using (in_dm_thread(thread_id));

do $$
begin
  alter publication supabase_realtime add table dm_messages;
exception when duplicate_object then
  raise notice 'dm_messages already streams live';
end $$;

do $$ begin
  raise notice 'the team can message each other';
end $$;

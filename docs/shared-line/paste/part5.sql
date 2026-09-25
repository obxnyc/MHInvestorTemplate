create table if not exists dm_threads (
  id         uuid primary key default gen_random_uuid(),
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

alter table staff
  add column if not exists reads_all_dms boolean not null default false;

update staff set reads_all_dms = true where role = 'admin' and reads_all_dms = false;

grant select (reads_all_dms) on staff to authenticated;

create or replace function can_read_all_dms() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff s
    where s.id = auth.uid() and s.active and s.reads_all_dms
  );
$$;

create or replace function in_dm_thread(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_read_all_dms() or exists (
    select 1 from dm_members m
    where m.thread_id = p_thread and m.staff_id = auth.uid()
  );
$$;

do $$ begin
  raise notice 'the owner can read every staff thread';
end $$;

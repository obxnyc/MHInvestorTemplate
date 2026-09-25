-- Oversight of staff threads, and working groups
--
-- Run in the Supabase SQL editor, after 013. Safe to run twice.
--
-- A named person can read every staff thread. Not "admins" as a class: a
-- second admin hired next year should not silently inherit the ability to read
-- everyone's private messages, so this is a flag on a person rather than a
-- property of a role. It is granted here to whoever is admin today, which is
-- the owner, and defaults to false for everybody added afterwards.
--
-- The application shows it. Every staff thread carries a line saying the owner
-- can read it. That is not decoration: people write differently when they know,
-- and a tool that watches quietly is one they stop being honest in -- which
-- destroys the thing the oversight was meant to protect. Told, it is a policy.
-- Untold, it is surveillance.

alter table staff
  add column if not exists reads_all_dms boolean not null default false;

update staff set reads_all_dms = true where role = 'admin' and reads_all_dms = false;

-- Kept readable by the same column grant everything else uses, so the badge can
-- be rendered without another round trip.
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
  raise notice 'the owner can read staff threads, and everybody is told so';
end $$;

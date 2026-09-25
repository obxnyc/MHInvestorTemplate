-- People asking for access
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- Its own table, never a staff row with a flag. A `staff` row is what every
-- policy in this database reads to decide who you are: is_active_staff() and
-- staff_has_role() are the whole access model. Writing an unapproved person
-- there and relying on a boolean means one forgotten AND somewhere turns an
-- application into an employee, and the thing they get access to is every
-- tenant's phone number and every applicant's credit score.
--
-- So an application is not a diminished staff row. It is a separate record of a
-- request, and approving it is what creates the staff row -- an act, with a
-- name and a time against it.

create table if not exists access_requests (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  email         text not null,
  phone         text,
  -- What they say they need. The office decides what they actually get, and
  -- the two are stored separately so a later question -- "who gave them
  -- admin?" -- has an answer that is not a guess.
  requested_role staff_role not null default 'office',
  granted_role   staff_role,
  reason        text,

  status      text not null default 'pending'
              check (status in ('pending','approved','declined')),
  decided_by  uuid references staff(id) on delete set null,
  decided_at  timestamptz,
  decline_reason text,
  staff_id    uuid references staff(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists access_requests_status
  on access_requests (status, created_at desc);

-- One open request per email, so somebody who submits three times because
-- nothing visibly happened does not become three items of work.
create unique index if not exists access_requests_open
  on access_requests (lower(email)) where status = 'pending';

alter table access_requests enable row level security;
revoke all on access_requests from anon;
revoke insert, update, delete on access_requests from authenticated;

-- Only admins read them. A pending request carries somebody's name, email and
-- their own account of why they should be let in; that is not roster
-- information for everyone who happens to be signed in.
drop policy if exists admin_reads_access_requests on access_requests;
create policy admin_reads_access_requests on access_requests
  for select using (staff_has_role('admin'));

do $$ begin
  raise notice 'people can ask for access, and an admin decides';
end $$;

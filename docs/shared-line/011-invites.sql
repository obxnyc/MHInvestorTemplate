-- Inviting somebody by text
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- Distinct from access_requests, and the difference is who decided. A request
-- is a stranger asking; an invite is the office having already decided, so
-- there is nothing left to approve -- the approval happened when an admin typed
-- their number. Collapsing the two would mean either approving people you just
-- invited, or letting anyone who finds a link in.
--
-- The token is a bearer credential that creates an account, which makes it the
-- most dangerous link in this system. So: single use, seven days, and revocable
-- by deleting the row.

create table if not exists staff_invites (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  full_name   text,
  phone       text not null,
  role        staff_role not null default 'office',
  invited_by  uuid references staff(id) on delete set null,
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz,
  staff_id    uuid references staff(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists staff_invites_open
  on staff_invites (expires_at) where used_at is null;

alter table staff_invites enable row level security;
revoke all on staff_invites from anon;
revoke insert, update, delete on staff_invites from authenticated;

-- Admins see who has been invited and whether they have taken it up. The token
-- column is withheld even from them in the application's queries -- a link that
-- creates an account should live in exactly one place, which is the text
-- message it was sent in.
drop policy if exists admin_reads_invites on staff_invites;
create policy admin_reads_invites on staff_invites
  for select using (staff_has_role('admin'));

do $$ begin
  raise notice 'people can be invited by text';
end $$;

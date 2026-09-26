-- Who is here, who has stepped away, and who was last in
--
-- Run in the Supabase SQL editor, after 017. Safe to run twice.
--
-- Three columns, and the difference between two of them is the whole point.
--
-- `last_seen_at` and `presence` are the green dot. Everybody can see them,
-- deliberately: if the office can see that the tech is online, the tech can
-- see that the office is online. A presence indicator that is visible in only
-- one direction is not a status board, it is a monitoring tool, and people who
-- know they are watched one-way stop leaving the tab open -- at which point
-- the feature reports that nobody is ever working.
--
-- `last_login_at` is not the same thing. "Online now" is a fact about right
-- now that a colleague has a reason to want. "Has not signed in since the
-- fourteenth" is a management fact, and it is not the office's business who
-- logged in when. So it is not granted to `authenticated` at all: the column
-- privilege is the enforcement, and the API hands it out to admins only. A
-- policy cannot do this job -- RLS is row-level and cannot hide a column.

alter table staff
  add column if not exists last_seen_at  timestamptz,
  add column if not exists presence      text,
  add column if not exists last_login_at timestamptz;

-- Text with a check rather than an enum, on purpose. An enum rejects an
-- unknown value by taking the whole statement down with it, which is how a
-- heartbeat with a typo in it would stop somebody signing in. The vocabulary
-- here is ours and the server normalises to it; the constraint is a guard, not
-- a gate.
do $$ begin
  alter table staff add constraint staff_presence_known
    check (presence is null or presence in ('active','idle'));
exception when duplicate_object then null; end $$;

-- The dot: everyone sees it.
grant select (last_seen_at, presence) on staff to authenticated;

-- last_login_at is deliberately absent from that grant. Do not add it.
-- The only reader is the service role, and /api/presence returns it to admins.

do $$
declare ok boolean;
begin
  -- The grant that must exist.
  if not has_column_privilege('authenticated', 'staff', 'presence', 'select') then
    raise exception 'presence is not readable and the dot will never light up';
  end if;
  -- And the one that must NOT.
  select has_column_privilege('authenticated', 'staff', 'last_login_at', 'select')
    into ok;
  if ok then
    raise exception 'last_login_at is readable by every employee -- revoke it';
  end if;
  raise notice 'presence is shared; last login is not';
end $$;

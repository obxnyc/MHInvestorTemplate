-- Pulling the maintenance requests when somebody looks
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query
-- containing alter, drop or update. Here that is `drop function if exists`,
-- which removes the previous copy of the one function below before creating
-- it again, and the `update` inside that function, which stamps a single row
-- to say a pull has started. No table is dropped and no data is deleted.
--
-- WHY THIS EXISTS. A tenant submits a request in Tenant Web Access, and the
-- only automatic path to this application is a cron -- which, on Vercel's
-- Hobby plan, fires ONCE A DAY and not more, whatever the expression says. So
-- a request filed at ten in the morning sat in Rent Manager until a quarter
-- past seven the next day, and the office found out by somebody ringing up.
--
-- The office opens the inbox twenty times a day. That is the schedule this
-- plan actually has, so this is what it uses: whoever opens it asks whether
-- anything has been pulled lately, and pulls if not. The cron stays as the
-- backstop for the hours when nobody is looking.

create table if not exists rm_issue_pulls (
  -- One row, forever. The same shape as clock_rules.
  id          boolean primary key default true check (id),
  started_at  timestamptz,
  finished_at timestamptz,
  ok          boolean,
  filed       integer not null default 0,
  error       text
);

insert into rm_issue_pulls (id) values (true) on conflict (id) do nothing;

alter table rm_issue_pulls enable row level security;
revoke all on rm_issue_pulls from anon;
-- Written only through the function below, which runs as its owner.
revoke insert, update, delete on rm_issue_pulls from authenticated;

drop policy if exists staff_read_issue_pulls on rm_issue_pulls;
create policy staff_read_issue_pulls on rm_issue_pulls
  for select using (is_active_staff());

-- MAY I PULL?
--
-- The whole point is that several people open the inbox at once. Asking
-- "when did it last run" and then deciding in the application is a race with
-- a window the width of a round trip: three browsers all read the same stale
-- timestamp, all decide yes, and Rent Manager gets three identical pulls.
--
-- So the question and the claim are ONE statement. The update only matches a
-- row that is still claimable, and only one of them can match it; everybody
-- else gets no row back and is told no.
--
-- `p_stale` is how old the last finished pull must be. `p_dead` is when a
-- pull that never finished is presumed dead -- a function killed at the
-- plan's sixty-second ceiling never writes its finish, and without this the
-- lock would be held forever by a run that is not happening.
drop function if exists claim_issue_pull(integer, integer);
create function claim_issue_pull(p_stale integer, p_dead integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare got boolean;
begin
  if not is_active_staff() then
    raise exception 'only active staff can pull maintenance requests';
  end if;

  update rm_issue_pulls
     set started_at = now(), finished_at = null, error = null
   where id
     and (
       -- never run
       started_at is null
       -- last run finished, and long enough ago
       or (finished_at is not null
           and finished_at < now() - make_interval(mins => p_stale))
       -- or it started and never finished, so presume it died
       or (finished_at is null
           and started_at < now() - make_interval(mins => p_dead))
     )
  returning true into got;

  return coalesce(got, false);
end $$;

revoke all on function claim_issue_pull(integer, integer) from public, anon;
grant execute on function claim_issue_pull(integer, integer) to authenticated;

-- How it went, so "is this up to date" has an answer that is not somebody's
-- memory of having opened the inbox.
drop function if exists finish_issue_pull(boolean, integer, text);
create function finish_issue_pull(p_ok boolean, p_filed integer, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active_staff() then
    raise exception 'only active staff can pull maintenance requests';
  end if;
  update rm_issue_pulls
     set finished_at = now(), ok = p_ok, filed = coalesce(p_filed, 0), error = p_error
   where id;
end $$;

revoke all on function finish_issue_pull(boolean, integer, text) from public, anon;
grant execute on function finish_issue_pull(boolean, integer, text) to authenticated;

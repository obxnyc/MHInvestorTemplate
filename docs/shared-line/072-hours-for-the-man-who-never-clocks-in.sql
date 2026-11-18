-- 072: hours for the man who never clocks in.
--
-- "He is just very bad with phone." Three ways his hours get on the record
-- without him pressing anything, and one rule that keeps all of them honest.
--
--   crew_setup.auto_clock   the installed app clocks him in when his phone
--                           arrives at a job site on a work day, and out when
--                           it has been away from every site for 45 minutes.
--   shifts.start_how        'self' (he pressed it), 'auto' (his phone did),
--                           'lead' (his crew lead pressed it for him),
--                           'office' (entered on Timesheets afterwards).
--   shifts.started_by       who pressed it, when it was not him.
--   shifts.end_how / ended_by
--                           the same for the end, plus 'clock' for the 6pm
--                           close nobody made.
--
-- THE RULE: only the office sets a time that is not now. Until this file a
-- crew member's own update policy let him write any started_at or ended_at
-- on his own shift straight through the API -- which is a timesheet anybody
-- can write. The trigger below holds it: a crew member or lead opens and
-- closes shifts AT THE TIME IT HAPPENS, and the one exception is the phone's
-- own clock-in/out, at most 35/50 minutes back, and only for somebody the
-- office has ticked for it. Everything else goes through the office.
--
-- started_by / ended_by are plain uuids, not foreign keys, on purpose: a
-- third link from shifts to staff would make every embed of staff on shifts
-- ambiguous (see embed-check.mjs).
--
-- Safe to re-run.

alter table crew_setup add column if not exists auto_clock boolean not null default false;

alter table shifts add column if not exists start_how text not null default 'self';
alter table shifts add column if not exists started_by uuid;
alter table shifts add column if not exists end_how text;
alter table shifts add column if not exists ended_by uuid;

alter table shifts drop constraint if exists shifts_start_how_known;
alter table shifts add constraint shifts_start_how_known
  check (start_how in ('self', 'auto', 'lead', 'office'));
alter table shifts drop constraint if exists shifts_end_how_known;
alter table shifts add constraint shifts_end_how_known
  check (end_how is null or end_how in ('self', 'auto', 'lead', 'office', 'clock'));

-- Is the signed-in person the crew lead of `who`? crew_setup is office-only
-- by row policy, so a policy asking it directly would always say no for a
-- lead; this answers the one question and nothing else.
create or replace function leads_crew(who uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crew_setup c where c.staff_id = who and c.lead_id = auth.uid());
$$;
revoke all on function leads_crew(uuid) from public, anon;
grant execute on function leads_crew(uuid) to authenticated;

-- Is automatic clock-in on for me? (The phone asks; it cannot read crew_setup.)
create or replace function my_auto_clock() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select auto_clock from crew_setup where staff_id = auth.uid()), false);
$$;
revoke all on function my_auto_clock() from public, anon;
grant execute on function my_auto_clock() to authenticated;

-- The working week, for the phone to know when arriving is work. Days, the
-- sometimes-days, and the clock's close; nothing personal in it.
create or replace function clock_window() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'tz', coalesce(s.tz, 'America/New_York'),
    'days', coalesce(s.days, array[1,2,3,4,5,6]),
    'optional_days', coalesce(s.optional_days, array[]::int[]),
    'auto_out', s.auto_out)
  from (select 1) one left join clock_text_settings s on true limit 1;
$$;
revoke all on function clock_window() from public, anon;
grant execute on function clock_window() to authenticated;

-- Who I can clock in for: a lead's own crew; for the office, everybody on the
-- clock. With whether each is on the clock now.
create or replace function my_crew()
returns table (staff_id uuid, full_name text, open_shift uuid, open_since timestamptz)
language sql stable security definer set search_path = public as $$
  select st.id, st.full_name, sh.id, sh.started_at
  from staff st
  join crew_setup c on c.staff_id = st.id
  left join shifts sh on sh.staff_id = st.id and sh.ended_at is null
  where st.active
    and st.id <> auth.uid()
    and (c.lead_id = auth.uid()
         or (staff_has_role('admin','office') and c.on_clock))
  order by st.full_name;
$$;
revoke all on function my_crew() from public, anon;
grant execute on function my_crew() to authenticated;

-- A lead opens, reads and closes his crew's shifts.
drop policy if exists lead_opens_crew_shifts on shifts;
create policy lead_opens_crew_shifts on shifts
  for insert with check (is_active_staff() and leads_crew(staff_id));
drop policy if exists lead_reads_crew_shifts on shifts;
create policy lead_reads_crew_shifts on shifts
  for select using (leads_crew(staff_id));
drop policy if exists lead_closes_crew_shifts on shifts;
create policy lead_closes_crew_shifts on shifts
  for update using (leads_crew(staff_id)) with check (leads_crew(staff_id));

-- The office enters a day's break with the day.
drop policy if exists office_adds_breaks on shift_breaks;
create policy office_adds_breaks on shift_breaks
  for insert with check (staff_has_role('admin','office'));

-- THE RULE. The service role (no auth.uid()) and the office pass; everybody
-- else opens and closes at the time it happens.
create or replace function shifts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  desk boolean := auth.uid() is null or staff_has_role('admin','office');
begin
  if desk then
    if tg_op = 'INSERT' and new.start_how = 'office' and auth.uid() is not null then
      new.started_by := auth.uid();
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.ended_at is not null then
      raise exception 'A finished shift is entered by the office.';
    end if;
    if new.start_how = 'office' then
      raise exception 'Only the office enters hours.';
    elsif new.start_how = 'lead' then
      if new.staff_id = auth.uid() then
        raise exception 'Clock yourself in from your own screen.';
      end if;
      new.started_by := auth.uid();
      new.started_at := now();
    else
      if new.staff_id <> auth.uid() then
        raise exception 'That shift is not yours.';
      end if;
      new.started_by := null;
      if new.start_how = 'auto' then
        if not coalesce((select auto_clock from crew_setup where staff_id = auth.uid()), false) then
          raise exception 'Automatic clock-in is not on for you.';
        end if;
        if new.started_at < now() - interval '35 minutes'
           or new.started_at > now() + interval '1 minute' then
          raise exception 'An automatic clock-in is at most 35 minutes back.';
        end if;
      else
        new.started_at := now();
      end if;
    end if;
    new.auto_clocked_out := false;
    new.end_how := null;
    new.ended_by := null;
    new.settled_by := null;
    new.settled_at := null;
    return new;
  end if;

  -- UPDATE
  if new.staff_id is distinct from old.staff_id
     or new.started_at is distinct from old.started_at
     or new.start_how is distinct from old.start_how
     or new.started_by is distinct from old.started_by
     or new.auto_clocked_out is distinct from old.auto_clocked_out
     or new.settled_by is distinct from old.settled_by
     or new.settled_at is distinct from old.settled_at then
    raise exception 'When a shift began is changed by asking the office.';
  end if;
  if old.ended_at is not null then
    if new.ended_at is distinct from old.ended_at
       or new.end_how is distinct from old.end_how
       or new.ended_by is distinct from old.ended_by then
      raise exception 'A finished shift is changed by asking the office.';
    end if;
    return new;
  end if;
  if new.ended_at is null then
    new.end_how := null;
    new.ended_by := null;
    return new;
  end if;

  -- Closing an open shift.
  if new.end_how = 'auto' then
    if old.start_how <> 'auto' or old.staff_id <> auth.uid() then
      raise exception 'Only a shift the phone started is ended by the phone.';
    end if;
    if new.ended_at < now() - interval '50 minutes'
       or new.ended_at > now() + interval '1 minute'
       or new.ended_at < old.started_at then
      raise exception 'An automatic clock-out is at most 50 minutes back.';
    end if;
    new.ended_by := null;
  elsif old.staff_id = auth.uid() then
    new.end_how := 'self';
    new.ended_by := null;
    new.ended_at := now();
  else
    new.end_how := 'lead';
    new.ended_by := auth.uid();
    new.ended_at := now();
  end if;
  return new;
end $$;

drop trigger if exists shifts_guard on shifts;
create trigger shifts_guard before insert or update on shifts
  for each row execute function shifts_guard();

-- 039 — "I forgot to clock in", said on the record
--
-- A man gets to a site at seven, gets to work, and remembers the phone at
-- half nine. Without somewhere to say that, there are only two outcomes:
-- he loses two and a half hours, or somebody in the office edits his
-- timesheet by hand and there is no record of why it changed. Both are bad
-- and the second is worse, because a pay record that moves with no reason
-- attached is the one a solicitor asks about.
--
-- The rule that shapes this table: A REQUEST IS NOT A CHANGE. Nothing here
-- touches `shifts`. The hours on the record stay exactly as the clock
-- recorded them until somebody with the authority to agree says so, and when
-- they do, BOTH states remain readable -- what the clock saw, and what was
-- agreed instead, and who agreed it.
--
-- The alternative, letting somebody edit their own hours and calling it a
-- request, is not a request. It is a timesheet anybody can write.

create table if not exists shift_edits (
  id          uuid primary key default gen_random_uuid(),

  -- Null when the shift never existed -- "I was there all Tuesday and never
  -- clocked in at all". Approving one of those creates the shift rather than
  -- amending one.
  shift_id    uuid references shifts(id) on delete cascade,
  staff_id    uuid not null references staff(id) on delete cascade,

  kind text not null check (kind in (
    'never_clocked_in',   -- no shift exists for that stretch
    'missed_clock_in',    -- shift exists, started later than they did
    'missed_clock_out',   -- shift exists, ran on after they left
    'missed_break',       -- a break was taken and not recorded
    'wrong_times',        -- both ends are wrong
    'other'
  )),

  -- What they are asking for. Null means "leave this one alone", which is
  -- different from asking for a change to it -- a missed break asks only for
  -- the break and must not quietly move the start time as well.
  asked_start   timestamptz,
  asked_end     timestamptz,
  asked_break_minutes integer check (asked_break_minutes is null
                                     or (asked_break_minutes >= 0
                                         and asked_break_minutes <= 480)),

  -- Required, and not satisfiable with a space. "Why" is the entire value of
  -- this row six months from now; a blank reason makes the correction
  -- indistinguishable from somebody helping themselves to two hours.
  reason      text not null check (length(trim(reason)) >= 3),

  state       text not null default 'asked'
              check (state in ('asked', 'approved', 'declined')),
  decided_by  uuid references staff(id) on delete set null,
  decided_at  timestamptz,
  decided_note text,

  -- What the clock actually had, copied in at the moment of approval. The
  -- shift row moves; this does not. Without it the only record of the
  -- original is a row somebody has already overwritten.
  was_start   timestamptz,
  was_end     timestamptz,
  was_break_minutes integer,

  created_at  timestamptz not null default now(),

  constraint asked_end_after_asked_start
    check (asked_start is null or asked_end is null or asked_end > asked_start),
  -- A decision has a decider and a time, or it is not a decision.
  constraint a_decision_says_who
    check (state = 'asked' or (decided_by is not null and decided_at is not null)),
  -- And a request that asks for nothing at all is not a request.
  constraint asks_for_something
    check (kind = 'other'
           or asked_start is not null
           or asked_end is not null
           or asked_break_minutes is not null)
);

create index if not exists shift_edits_by_person
  on shift_edits (staff_id, created_at desc);
create index if not exists shift_edits_by_shift on shift_edits (shift_id);
-- The office's queue, which is the only reason anybody opens this table.
create index if not exists shift_edits_waiting on shift_edits (created_at)
  where state = 'asked';

-- One open request per shift. Two people arguing with the same stretch of
-- time produces two approvals and whichever lands second wins, silently.
create unique index if not exists shift_edits_one_open_per_shift
  on shift_edits (shift_id) where state = 'asked' and shift_id is not null;

-- ------------------------------------------------------------------ access

alter table shift_edits enable row level security;
revoke all on shift_edits from anon;
-- A request is a pay record too. Corrected, never deleted.
revoke delete on shift_edits from authenticated;
grant select, insert, update on shift_edits to authenticated;

drop policy if exists crew_reads_own_edits on shift_edits;
create policy crew_reads_own_edits on shift_edits
  for select using (
    staff_id = auth.uid() or staff_has_role('admin','office')
  );

-- Anybody may ask about their own hours, and only about their own.
drop policy if exists crew_asks_about_own_hours on shift_edits;
create policy crew_asks_about_own_hours on shift_edits
  for insert with check (
    is_active_staff() and staff_id = auth.uid() and state = 'asked'
  );

-- But only the office decides. Written as a policy rather than left to the
-- route, because a request somebody can approve for themselves is not a
-- request -- and the route is one place while the table is forever.
drop policy if exists office_decides_edits on shift_edits;
create policy office_decides_edits on shift_edits
  for update using (staff_has_role('admin','office'))
  with check (staff_has_role('admin','office'));

-- ------------------------------------------------------- agreeing to one
--
-- Approving a request moves hours on a pay record AND records that it was
-- moved, and those two writes must not be able to come apart. Done from the
-- application they are two round trips: the shift changes and then the
-- request is marked, and a failure between them leaves hours that moved with
-- nothing saying why, or a request marked agreed against hours that never
-- moved. Either one is the thing this whole table exists to prevent.
--
-- So it is one function and one transaction. It also copies what the clock
-- actually had into the request BEFORE touching the shift -- after is too
-- late, because the only record of the original is the row being overwritten.
create or replace function approve_shift_edit(p_edit uuid, p_by uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e        shift_edits%rowtype;
  new_shift uuid;
begin
  if not staff_has_role('admin','office') then
    raise exception 'only the office may approve a correction';
  end if;

  select * into e from shift_edits where id = p_edit and state = 'asked'
    for update;
  if not found then
    raise exception 'that request is not open';
  end if;

  if e.shift_id is null then
    -- Nobody clocked in at all that day, so there is no row to amend. A start
    -- is required for this; a null end leaves it running, which is honest --
    -- somebody still has to say when it finished.
    if e.asked_start is null then
      raise exception 'a shift that was never opened needs a start time';
    end if;
    insert into shifts (staff_id, started_at, ended_at, note, settled_by, settled_at)
      values (e.staff_id, e.asked_start, e.asked_end,
              'Added from a correction: ' || e.reason, p_by, now())
      returning id into new_shift;
    e.shift_id := new_shift;
  else
    -- What the clock had, read BEFORE it is replaced. After is too late: the
    -- only record of the original is the row about to be overwritten.
    select started_at, ended_at into e.was_start, e.was_end
      from shifts where id = e.shift_id;
    select coalesce(sum(extract(epoch from (ended_at - started_at)) / 60), 0)::int
      into e.was_break_minutes
      from shift_breaks where shift_id = e.shift_id and ended_at is not null;

    -- Null means "leave this one alone", which is not the same as asking for
    -- a change to it: a missed break asks for the break and must not quietly
    -- move the start time as well.
    update shifts set
      started_at = coalesce(e.asked_start, started_at),
      ended_at   = coalesce(e.asked_end, ended_at),
      settled_by = p_by,
      settled_at = now()
    where id = e.shift_id;
  end if;

  -- A break asked for is recorded AS a break rather than subtracted from the
  -- total, so the day still reads as a day with a lunch in the middle of it.
  if coalesce(e.asked_break_minutes, 0) > 0 then
    insert into shift_breaks (shift_id, started_at, ended_at)
      select s.id,
             s.started_at + (extract(epoch from (
               coalesce(s.ended_at, now()) - s.started_at)) / 2) * interval '1 second',
             s.started_at + (extract(epoch from (
               coalesce(s.ended_at, now()) - s.started_at)) / 2) * interval '1 second'
               + e.asked_break_minutes * interval '1 minute'
        from shifts s where s.id = e.shift_id;
  end if;

  update shift_edits set
    state = 'approved', decided_by = p_by, decided_at = now(),
    shift_id = e.shift_id,
    was_start = e.was_start, was_end = e.was_end,
    was_break_minutes = e.was_break_minutes
  where id = p_edit;

  return e.shift_id;
end $$;

revoke all on function approve_shift_edit(uuid, uuid) from public, anon;
grant execute on function approve_shift_edit(uuid, uuid) to authenticated;

do $$ begin
  raise notice 'the hours can be argued with, on the record';
end $$;

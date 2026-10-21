-- 038 — a day on the clock, and whether somebody was really there
--
-- Hourly crew go to a site and open the app. One button: on, then off. The
-- office needs three things out of that without having an argument about any
-- of them -- how long somebody worked, whether they took the break they are
-- owed, and which property the hours belong against.
--
-- Two decisions in here are worth more than the tables.
--
-- A FIX IS RECORDED, NEVER ENFORCED. Nothing in this schema refuses a
-- clock-in off site. A man who cannot clock in because the GPS is poor has no
-- record of his hours at all, which is worse for him, worse for the office,
-- and much worse in front of a wage claim. What is on site and what is not is
-- a thing the office reads afterwards, and `lib/fence.ts` answers it in three
-- states rather than two, because a phone indoors routinely cannot tell.
--
-- AND THE TRACKING BELONGS TO THE SHIFT, NOT TO THE LOGIN. A ping is only
-- ever written against an open shift. Clock out and it stops, and the screen
-- says so. "While they are logged in" would mean following somebody home.

-- ------------------------------------------------------- who is on the crew

-- Not 'labourer' or 'laborer': the spelling argument has no right answer and
-- the word on site is crew.
-- Bare, not wrapped in a do block with an exception handler.
--
-- `if not exists` already makes it safe to re-run, and a handler that
-- swallows every exception is the failure mode this codebase keeps shipping:
-- if this statement ever cannot run, the role silently does not exist and
-- every crew member is left without one, with nothing on screen to say so.
-- Louder is better. `clock-check.mjs` confirms the role is really there
-- afterwards rather than taking the absence of an error as an answer.
alter type staff_role add value if not exists 'crew';

-- ------------------------------------------------------- where each site is

-- A radius from the pin, not a drawn boundary. There are hundreds of single
-- family houses and nobody is going to trace hundreds of outlines, so the
-- thing that actually gets filled in is the one that is already filled in.
-- A park that HAS a boundary drawn on its plan still gets a radius here,
-- because the clock-in has to work before anybody has opened the map.
alter table properties
  add column if not exists fence_m integer
    check (fence_m is null or (fence_m >= 20 and fence_m <= 2000));

comment on column properties.fence_m is
  'Metres from the pin that count as being on this property. Null means use '
  'the default for its kind in lib/fence.ts. A fence under 20m is smaller '
  'than a decent GPS fix and a fence over 2km is not a property.';

-- ------------------------------------------------------------- the shifts

create table if not exists shifts (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references staff(id) on delete cascade,

  -- Which property the hours go against. Filled in from the fence when one
  -- fence and only one says the phone was inside it; left null otherwise and
  -- asked for later. Labour filed against the wrong house is worse than
  -- labour filed against none.
  property_id   uuid references properties(id) on delete set null,
  -- How it came to be set, because "the phone said so" and "the foreman said
  -- so" are not the same claim and only one of them is evidence.
  property_from text check (property_from is null
                            or property_from in ('fence','chosen','office')),

  started_at    timestamptz not null default now(),
  ended_at      timestamptz,

  -- The fix at each end, exactly as the browser gave it. Accuracy is stored
  -- because without it a coordinate is a claim with no error bar, and a
  -- fence test against one of those is reading noise.
  start_lat     double precision,
  start_lng     double precision,
  start_acc     double precision,
  end_lat       double precision,
  end_lng       double precision,
  end_acc       double precision,

  -- What the fence made of each end: 'inside', 'outside' or 'unsure'. Worked
  -- out and stored at the time, because the pin or the radius may be moved
  -- afterwards and the reading that was taken is the one that happened.
  start_fence   text check (start_fence is null
                            or start_fence in ('inside','outside','unsure')),
  end_fence     text check (end_fence is null
                            or end_fence in ('inside','outside','unsure')),

  note          text,

  -- The crew member agreeing the hours. Not the office agreeing them for him.
  signed_off_at timestamptz,

  -- An end time somebody typed because the phone died, and who typed it. A
  -- settled shift is not the same as a shift that ran to its own clock-out,
  -- and a payroll figure should be able to say which it is.
  settled_by    uuid references staff(id) on delete set null,
  settled_at    timestamptz,

  created_at    timestamptz not null default now(),

  constraint shift_ends_after_it_starts
    check (ended_at is null or ended_at > started_at)
);

-- One shift open per person at a time. Two open shifts is a double-count of
-- somebody's day, and the only way it happens is a second phone or a stuck
-- button -- neither of which should be settled by whichever row is read first.
create unique index if not exists shifts_one_open_per_person
  on shifts (staff_id) where ended_at is null;

create index if not exists shifts_by_person on shifts (staff_id, started_at desc);
create index if not exists shifts_by_property on shifts (property_id, started_at desc);
-- The payroll question: everything finished and not yet agreed.
create index if not exists shifts_unsigned on shifts (started_at)
  where ended_at is not null and signed_off_at is null;

-- ------------------------------------------------------------- the breaks

-- A break is its own row and not a pair of columns, because somebody takes
-- more than one and because a break with no end has to be distinguishable
-- from no break at all. A break nobody finished has no measured length, and
-- guessing one deducts pay for a guess.
create table if not exists shift_breaks (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references shifts(id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  created_at  timestamptz not null default now(),
  constraint break_ends_after_it_starts
    check (ended_at is null or ended_at > started_at)
);

create unique index if not exists breaks_one_open_per_shift
  on shift_breaks (shift_id) where ended_at is null;
create index if not exists breaks_by_shift on shift_breaks (shift_id, started_at);

-- -------------------------------------------------------------- the pings

-- Where somebody was while the app was open and they were on the clock.
--
-- Visibility of movements through the day was the ask, and this is the
-- narrowest thing that answers it: a position, how good it was, and which
-- shift it belonged to. No ping without an open shift, which the foreign key
-- and the insert path both enforce.
create table if not exists shift_pings (
  id        uuid primary key default gen_random_uuid(),
  shift_id  uuid not null references shifts(id) on delete cascade,
  at        timestamptz not null default now(),
  lat       double precision not null,
  lng       double precision not null,
  accuracy  double precision,
  -- The fence's answer at the time, same reasoning as on the shift.
  fence     text check (fence is null or fence in ('inside','outside','unsure')),
  -- Metres from the pin of the shift's property, so a trail can be read
  -- without re-running the arithmetic over every row.
  metres    double precision
);

create index if not exists pings_by_shift on shift_pings (shift_id, at);

-- ---------------------------------------------------------------- the rules

-- One row. The caps and the break rule live in the database rather than in
-- the code because they are a policy somebody changes on a Tuesday, and a
-- deploy should not be in the way of that.
create table if not exists clock_rules (
  id             boolean primary key default true check (id),
  daily_cap      numeric(4,2) not null default 10 check (daily_cap between 1 and 24),
  break_after    numeric(4,2) not null default 6 check (break_after between 1 and 24),
  break_minutes  integer not null default 30 check (break_minutes between 5 and 120),
  abandoned_after numeric(4,2) not null default 14
    check (abandoned_after between 1 and 48),
  -- How often the app sends a position while somebody is on the clock.
  -- Generous: a ping a minute is a battery complaint and a tracking device,
  -- and neither is what was asked for.
  ping_minutes   integer not null default 10 check (ping_minutes between 1 and 60),
  updated_at     timestamptz not null default now()
);

insert into clock_rules (id) values (true) on conflict (id) do nothing;

-- ------------------------------------------------------------------- access

alter table shifts enable row level security;
alter table shift_breaks enable row level security;
alter table shift_pings enable row level security;
alter table clock_rules enable row level security;

revoke all on shifts from anon;
revoke all on shift_breaks from anon;
revoke all on shift_pings from anon;
revoke all on clock_rules from anon;

-- A shift is a pay record. It is corrected, never deleted -- a deleted shift
-- is an hour somebody worked and cannot prove.
revoke delete on shifts from authenticated;
revoke delete on shift_breaks from authenticated;
revoke delete on shift_pings from authenticated;
grant select, insert, update on shifts to authenticated;
grant select, insert, update on shift_breaks to authenticated;
grant select, insert on shift_pings to authenticated;
grant select on clock_rules to authenticated;

-- Crew see their own and nobody else's. Where somebody was at four o'clock is
-- not something their workmates get to read.
drop policy if exists crew_reads_own_shifts on shifts;
create policy crew_reads_own_shifts on shifts
  for select using (
    staff_id = auth.uid() or staff_has_role('admin','office')
  );
drop policy if exists crew_opens_own_shifts on shifts;
create policy crew_opens_own_shifts on shifts
  for insert with check (
    is_active_staff() and (staff_id = auth.uid() or staff_has_role('admin','office'))
  );
drop policy if exists crew_closes_own_shifts on shifts;
create policy crew_closes_own_shifts on shifts
  for update using (
    staff_id = auth.uid() or staff_has_role('admin','office')
  ) with check (
    staff_id = auth.uid() or staff_has_role('admin','office')
  );

drop policy if exists crew_reads_own_breaks on shift_breaks;
create policy crew_reads_own_breaks on shift_breaks
  for select using (exists (
    select 1 from shifts s where s.id = shift_id
      and (s.staff_id = auth.uid() or staff_has_role('admin','office'))));
drop policy if exists crew_takes_own_breaks on shift_breaks;
create policy crew_takes_own_breaks on shift_breaks
  for insert with check (exists (
    select 1 from shifts s where s.id = shift_id and s.staff_id = auth.uid()));
drop policy if exists crew_ends_own_breaks on shift_breaks;
create policy crew_ends_own_breaks on shift_breaks
  for update using (exists (
    select 1 from shifts s where s.id = shift_id
      and (s.staff_id = auth.uid() or staff_has_role('admin','office'))))
  with check (true);

drop policy if exists crew_reads_own_pings on shift_pings;
create policy crew_reads_own_pings on shift_pings
  for select using (exists (
    select 1 from shifts s where s.id = shift_id
      and (s.staff_id = auth.uid() or staff_has_role('admin','office'))));
-- A ping may only be written against a shift that is this person's AND still
-- open. The tracking belongs to the shift, not to the login, and the database
-- is where that is true rather than only the route that happens to write it.
drop policy if exists crew_pings_own_open_shift on shift_pings;
create policy crew_pings_own_open_shift on shift_pings
  for insert with check (exists (
    select 1 from shifts s where s.id = shift_id
      and s.staff_id = auth.uid() and s.ended_at is null));

drop policy if exists staff_reads_clock_rules on clock_rules;
create policy staff_reads_clock_rules on clock_rules
  for select using (is_active_staff());

do $$ begin
  raise notice 'the clock is in, and the fence is a radius from the pin';
end $$;

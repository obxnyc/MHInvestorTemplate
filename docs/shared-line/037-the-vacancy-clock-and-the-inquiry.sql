-- 037 — how long it has been empty, why, and what the caller asked for
--
-- Two gaps, and they are the same gap at opposite ends of one pipeline.
--
-- The dashboard can say twelve lots are empty and seven thousand a month is
-- going uncollected. It cannot say that one of them has been empty since
-- July waiting on flooring and another went empty last week and wants a
-- showing. Those two cost the same on the screen and are not the same
-- problem, and which of the two is the common case decides whether the
-- constraint is leasing or the make-ready crew. `is_vacant` is a boolean
-- somebody flips, so there has never been a clock on it.
--
-- And `inquiries` has existed since the first schema with nothing writing to
-- it. Somebody rings about a three-bedroom under nine hundred and that fact
-- lives in the text of a thread, so it cannot be counted, matched to a lot,
-- or followed up.

-- ------------------------------------------------------------ the clock

alter table units
  add column if not exists vacant_since date,
  -- The one thing stopping this lot being let. Free text on purpose: the
  -- useful answer is "waiting on the flooring quote", and an enum would
  -- have made that "other".
  add column if not exists blocker text,
  add column if not exists blocker_at timestamptz;

-- A date carried over from before anything was measuring is not a
-- measurement, and ninety-four days that is really a guess is worse than no
-- number at all -- it gets planned around. The screen says "about" when
-- this is set, the same way the property line says whether it came from the
-- county or was drawn by hand.
alter table units
  add column if not exists vacant_since_estimated boolean not null default false;

-- Enforced here rather than in the route. Three places already flip
-- is_vacant -- the unit page, the property board, and the Rent Manager
-- import -- and a clock that any one of them can forget to start is a clock
-- that reads zero on the lots that have been empty longest.
create or replace function units_vacancy_clock() returns trigger
language plpgsql as $$
begin
  if new.is_vacant and not coalesce(old.is_vacant, false) then
    -- Became empty. Do not restart a clock that is already running.
    new.vacant_since := coalesce(new.vacant_since, current_date);
    new.vacant_since_estimated := false;
  elsif coalesce(old.is_vacant, false) and not new.is_vacant then
    -- Let. The clock and the blocker both belonged to the empty spell that
    -- just ended; carrying either forward would attach them to a tenancy.
    new.vacant_since := null;
    new.vacant_since_estimated := false;
    new.blocker := null;
    new.blocker_at := null;
  end if;

  -- Stamped here so "how long has this blocker been the answer" is readable
  -- without a second table, and so nobody has to remember to set it.
  if coalesce(new.blocker, '') <> coalesce(old.blocker, '') then
    new.blocker_at := case when coalesce(trim(new.blocker), '') = ''
                           then null else now() end;
    new.blocker := nullif(trim(new.blocker), '');
  end if;

  return new;
end $$;

drop trigger if exists units_vacancy_clock on units;
create trigger units_vacancy_clock before update on units
  for each row execute function units_vacancy_clock();

-- An insert that arrives already empty needs the clock started too, and the
-- update trigger never fires for it.
create or replace function units_vacancy_clock_insert() returns trigger
language plpgsql as $$
begin
  if new.is_vacant then
    new.vacant_since := coalesce(new.vacant_since, current_date);
  end if;
  if coalesce(trim(new.blocker), '') = '' then
    new.blocker := null;
    new.blocker_at := null;
  elsif new.blocker_at is null then
    new.blocker_at := now();
  end if;
  return new;
end $$;

drop trigger if exists units_vacancy_clock_insert on units;
create trigger units_vacancy_clock_insert before insert on units
  for each row execute function units_vacancy_clock_insert();

-- Every lot already empty gets a starting date, marked as the guess it is.
-- available_on is the nearest thing on file to "when did this come empty",
-- and on a lot that is empty now a future availability date is about the
-- make-ready finishing rather than about when the tenant left -- so the
-- clock cannot start later than today.
update units
   set vacant_since = least(coalesce(available_on, current_date), current_date),
       vacant_since_estimated = true
 where is_vacant and vacant_since is null;

create index if not exists units_vacant_since_idx
  on units (vacant_since) where is_vacant;

-- ------------------------------------------------------------ the inquiry

-- What each stated preference was read out of. The parser is a hypothesis --
-- "3/2" is three bedrooms and "3 kids" is not a preference at all -- so the
-- screen shows the words it read and a human corrects it in one press. A
-- guess that reports what it saw gets fixed in one round; a silent one never
-- gets fixed.
--
--   {"bedrooms_min": {"from": "3 bedroom", "at": 14},
--    "price_ceiling": {"from": "under $900", "at": 28}}
alter table inquiries
  add column if not exists read jsonb not null default '{}'::jsonb;

-- The lot they were asking about, when they named one. Nullable because most
-- callers ask about a park rather than a lot.
alter table inquiries
  add column if not exists unit_id uuid references units(id) on delete set null;

-- Who is looking after it. An inquiry nobody owns is an inquiry nobody rings
-- back.
alter table inquiries
  add column if not exists owner_id uuid references staff(id) on delete set null;

create index if not exists inquiries_open_idx
  on inquiries (inquired_at desc) where outcome = 'open';

-- One open inquiry per person. A second call three days later is the same
-- person still looking, and two open rows for them means two follow-up
-- schedules and two people ringing them back.
create unique index if not exists inquiries_one_open_per_contact
  on inquiries (contact_id) where outcome = 'open';

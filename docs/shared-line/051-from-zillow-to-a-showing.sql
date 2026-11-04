-- 051 — from a Zillow message to somebody standing in the home
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected". The lines it is reacting
-- to are `drop policy if exists` / `drop function if exists` (each removes
-- the previous copy of a policy or function this file then creates again)
-- and the `update` inside claim_followup_run, which stamps one row to say a
-- run has started. No table is dropped and no data is deleted.
--
-- Four things, and they are one pipeline:
--
--   1. Where each person looking has got to (inquiries.stage), and a private
--      link that takes them to the prescreening questions already knowing
--      who they are and which home they asked about.
--   2. Every follow-up the pipeline means to send, as a row, BEFORE it is
--      sent (lead_followups). A follow-up that lives only in a timer is one
--      nobody can see, cancel, or prove went out.
--   3. When we show homes (showing_hours), so a prequalified person can pick
--      a time without anybody ringing them, and showings that can be
--      confirmed, cancelled, marked shown or a no-show.
--   4. What a home looks like on Zillow (listings), and whether it is in the
--      feed Zillow reads.

-- ------------------------------------------------------------ 1. the stage

alter table inquiries
  add column if not exists stage text not null default 'new',
  -- The private link to the prescreening questions. Not the inquiry id: an
  -- id in a URL is an id somebody can change by one character.
  add column if not exists prescreen_token text,
  add column if not exists stage_at timestamptz not null default now();

alter table inquiries drop constraint if exists inquiries_stage_known;
alter table inquiries add constraint inquiries_stage_known check (stage in (
  'new',          -- arrived, nothing sent yet
  'invited',      -- prescreening questions sent
  'prequalified', -- answered, meets the published criteria, may book
  'review',       -- answered, a person has to look
  'declined',     -- answered, does not meet the criteria (told which)
  'booked',       -- a showing is on the calendar
  'shown',        -- came and saw it
  'no_show',      -- booked and did not come
  'applied'       -- sent in an application
));

create unique index if not exists inquiries_prescreen_token
  on inquiries (prescreen_token) where prescreen_token is not null;
create index if not exists inquiries_stage_idx
  on inquiries (stage, stage_at) where outcome = 'open';

-- ------------------------------------------------------------ 2. follow-ups

create table if not exists lead_followups (
  id           uuid primary key default gen_random_uuid(),
  inquiry_id   uuid not null references inquiries(id) on delete cascade,
  showing_id   uuid references showings(id) on delete cascade,
  kind         text not null,
  due_at       timestamptz not null,
  -- scheduled : waiting for its time
  -- handed    : given to Twilio to send at its time (a reminder that has to
  --             land at 2pm cannot wait for a once-a-day cron)
  -- sent      : went out; channel says how
  -- skipped   : its moment passed, and skipped_reason says why it did not go
  -- failed    : tried and could not; skipped_reason says what came back
  state        text not null default 'scheduled'
               check (state in ('scheduled','handed','sent','skipped','failed')),
  channel      text check (channel in ('sms','email')),
  skipped_reason text,
  provider_id  text,   -- Twilio message sid, so a handed reminder can be cancelled
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- One of each kind per inquiry per showing. Scheduling the same reminder
-- twice is the commonest way a pipeline texts somebody twice.
create unique index if not exists lead_followups_once
  on lead_followups (inquiry_id, kind, coalesce(showing_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists lead_followups_due
  on lead_followups (due_at) where state = 'scheduled';

-- One row, forever: who is running the follow-ups right now. The same shape
-- as rm_issue_pulls in 042, for the same reason -- the office opening the
-- leasing screen is a better schedule than a cron that fires once a day.
create table if not exists followup_runs (
  id          boolean primary key default true check (id),
  started_at  timestamptz,
  finished_at timestamptz,
  sent        integer not null default 0,
  error       text
);
insert into followup_runs (id) values (true) on conflict (id) do nothing;

drop function if exists claim_followup_run(integer, integer);
create function claim_followup_run(p_stale integer, p_dead integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare got boolean;
begin
  update followup_runs
     set started_at = now(), finished_at = null, error = null
   where id
     and (
       -- nobody running, and the last run is old enough
       (finished_at is not null and finished_at < now() - make_interval(mins => p_stale))
       -- never run
       or started_at is null
       -- a run that never finished is presumed dead after p_dead minutes
       or (finished_at is null and started_at < now() - make_interval(mins => p_dead))
     )
  returning true into got;
  return coalesce(got, false);
end $$;

-- Called by the server with its own key, never from a browser: a run sends
-- texts, and nobody signed in as a crew member should be able to start one.
revoke all on function claim_followup_run(integer, integer) from public, anon, authenticated;
grant execute on function claim_followup_run(integer, integer) to service_role;

-- ------------------------------------------------------------ 3. showings

create table if not exists showing_hours (
  id           uuid primary key default gen_random_uuid(),
  -- 0 = Sunday, the way JavaScript counts
  weekday      smallint not null check (weekday between 0 and 6),
  starts       time not null,
  ends         time not null check (ends > starts),
  created_at   timestamptz not null default now()
);

-- One settings row: how long a showing is, how much notice we need, how far
-- ahead anybody may book, and how many showings can run at once.
create table if not exists showing_rules (
  id             boolean primary key default true check (id),
  slot_minutes   smallint not null default 30 check (slot_minutes between 10 and 240),
  notice_minutes smallint not null default 120 check (notice_minutes >= 0),
  horizon_days   smallint not null default 14 check (horizon_days between 1 and 60),
  at_once        smallint not null default 1 check (at_once between 1 and 10)
);
insert into showing_rules (id) values (true) on conflict (id) do nothing;

-- A sensible start: weekdays 10 to 6, Saturday 10 to 2. Only if nobody has
-- set any hours yet, so running this twice never doubles them.
insert into showing_hours (weekday, starts, ends)
select d, '10:00', case when d = 6 then '14:00'::time else '18:00'::time end
  from generate_series(1, 6) d
 where not exists (select 1 from showing_hours);

alter table showings
  add column if not exists inquiry_id uuid references inquiries(id) on delete set null,
  add column if not exists status text not null default 'booked',
  add column if not exists ends_at timestamptz,
  -- The prospect's own link to see, move or cancel their showing.
  add column if not exists manage_token text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists notes text;

alter table showings drop constraint if exists showings_status_known;
alter table showings add constraint showings_status_known check (status in (
  'booked', 'confirmed', 'cancelled', 'shown', 'no_show'
));

create unique index if not exists showings_manage_token
  on showings (manage_token) where manage_token is not null;
create index if not exists showings_upcoming
  on showings (scheduled_for) where status in ('booked', 'confirmed');

-- ------------------------------------------------------------ 4. listings

create table if not exists listings (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null unique references units(id) on delete cascade,
  -- THE BUTTON. True means the home is in the feed Zillow reads.
  on_zillow     boolean not null default false,
  listed_at     timestamptz,
  unlisted_at   timestamptz,
  headline      text,
  description   text,
  -- The address Zillow shows. properties.address is one line of free text,
  -- and the feed wants it in parts.
  street        text,
  city          text,
  state         text default 'NC',
  zip           text,
  deposit       numeric(10,2),
  pets          text not null default 'ask' check (pets in ('cats','dogs','both','none','ask')),
  lease_months  smallint default 12,
  -- Public URLs, in order; the first is the one Zillow shows on the card.
  photos        text[] not null default '{}',
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- Photos Zillow fetches have to be readable without signing in, so they live
-- in a bucket of their own and never beside the photographs tenants send of
-- the inside of their homes.
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do update set public = true;

-- ------------------------------------------------------------ who may read it

alter table lead_followups enable row level security;
alter table followup_runs  enable row level security;
alter table showing_hours  enable row level security;
alter table showing_rules  enable row level security;
alter table listings       enable row level security;

revoke all on lead_followups, followup_runs, showing_hours, showing_rules, listings from anon;
-- Every write goes through the server, which checks the role.
revoke insert, update, delete on lead_followups, followup_runs, showing_hours,
  showing_rules, listings from authenticated;

drop policy if exists staff_read_followups on lead_followups;
create policy staff_read_followups on lead_followups for select using (is_active_staff());
drop policy if exists staff_read_followup_runs on followup_runs;
create policy staff_read_followup_runs on followup_runs for select using (is_active_staff());
drop policy if exists staff_read_showing_hours on showing_hours;
create policy staff_read_showing_hours on showing_hours for select using (is_active_staff());
drop policy if exists staff_read_showing_rules on showing_rules;
create policy staff_read_showing_rules on showing_rules for select using (is_active_staff());
drop policy if exists staff_read_listings on listings;
create policy staff_read_listings on listings for select using (is_active_staff());

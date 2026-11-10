-- 051: texting the crew about the clock, and paying them on Friday.
--
-- Four things:
--
--   crew_setup         per person: whose crew, in the clock programme or not,
--                      gets every crew's reports or not, rate, how paid.
--   clock_text_settings  the times of day, the days, the time zone.
--   clock_texts_sent   the ledger. One row per (kind, person, day), written
--                      BEFORE the text goes, so two wakes of the scheduler
--                      cannot both send it.
--   pay_runs           one row per person per week once they have been paid,
--                      with the amount as it was when it was paid.
--
-- And the scheduler itself: pg_cron wakes the app every five minutes and the
-- app decides what is due in Eastern time. Vercel's Hobby crons fire once a
-- day "within the hour", which cannot do 8:45.
--
-- WHY NOT COLUMNS ON staff: every signed-in person can read the staff roster
-- (staff_reads_roster), crew included. A rate on that table is every man's
-- wage readable by every other man. crew_setup is office and admin only.
--
-- Safe to re-run.

-- ------------------------------------------------------------- crew_setup
create table if not exists crew_setup (
  staff_id     uuid primary key references staff(id) on delete cascade,
  lead_id      uuid references staff(id) on delete set null,
  on_clock     boolean not null default false,
  all_reports  boolean not null default false,
  rate_cents   integer check (rate_cents is null or rate_cents between 0 and 100000),
  pay_method   text check (pay_method in ('zelle','cashapp','venmo','cash','check','other')),
  pay_handle   text,
  -- The number the clock texts go to. NOT staff.forward_to: that column is
  -- the ring group, and a number put there rings for every tenant call. When
  -- this is empty the texts fall back to reading forward_to, never writing it.
  phone        text,
  -- The language their texts are written in. Half the crew read Spanish first.
  lang         text not null default 'en' check (lang in ('en','es')),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references staff(id),
  -- A man is not his own crew lead.
  check (lead_id is null or lead_id <> staff_id)
);
alter table crew_setup add column if not exists phone text;
alter table crew_setup add column if not exists lang text not null default 'en';
alter table crew_setup enable row level security;
revoke all on crew_setup from anon;
grant select on crew_setup to authenticated;
drop policy if exists office_reads_crew_setup on crew_setup;
create policy office_reads_crew_setup on crew_setup
  for select using (staff_has_role('admin','office'));

-- ---------------------------------------------------- clock_text_settings
create table if not exists clock_text_settings (
  id         boolean primary key default true check (id),
  enabled    boolean not null default true,
  tz         text not null default 'America/New_York',
  at         jsonb not null default '{
    "crew_morning": "07:50", "lead_morning": "08:45",
    "crew_lunch":   "13:00", "lead_lunch":   "13:15",
    "crew_evening": "17:30", "lead_recap":   "21:00"
  }'::jsonb,
  days       integer[] not null default '{1,2,3,4,5}',
  overtime   boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into clock_text_settings (id) values (true) on conflict do nothing;
alter table clock_text_settings enable row level security;
revoke all on clock_text_settings from anon;
grant select on clock_text_settings to authenticated;
drop policy if exists office_reads_text_settings on clock_text_settings;
create policy office_reads_text_settings on clock_text_settings
  for select using (staff_has_role('admin','office'));

-- ------------------------------------------------------ clock_texts_sent
create table if not exists clock_texts_sent (
  key        text primary key,          -- kind:staff_id:yyyy-mm-dd
  kind       text not null,
  staff_id   uuid references staff(id) on delete set null,
  to_phone   text not null,
  body       text not null,
  sid        text,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists clock_texts_sent_recent on clock_texts_sent (created_at desc);
alter table clock_texts_sent enable row level security;
revoke all on clock_texts_sent from anon;
grant select on clock_texts_sent to authenticated;
drop policy if exists office_reads_texts_sent on clock_texts_sent;
create policy office_reads_texts_sent on clock_texts_sent
  for select using (staff_has_role('admin','office'));

-- -------------------------------------------------------------- pay_runs
create table if not exists pay_runs (
  id           uuid primary key default gen_random_uuid(),
  week_start   date not null,
  staff_id     uuid not null references staff(id),
  hours        numeric(7,2) not null,
  overtime     numeric(7,2) not null default 0,
  rate_cents   integer,
  amount_cents integer not null check (amount_cents >= 0),
  method       text,
  handle       text,
  paid_at      timestamptz not null default now(),
  paid_by      uuid references staff(id),
  -- Paid once a week. Paying twice is the mistake this table exists to stop.
  unique (week_start, staff_id)
);
alter table pay_runs enable row level security;
revoke all on pay_runs from anon;
grant select on pay_runs to authenticated;
-- A payment record is not undone by deleting it.
revoke delete on pay_runs from authenticated;
drop policy if exists office_reads_pay_runs on pay_runs;
create policy office_reads_pay_runs on pay_runs
  for select using (staff_has_role('admin','office'));

-- -------------------------------------------------------- the scheduler
--
-- The token the scheduler sends, generated here and never leaving the
-- database: pg_cron reads it to send, and the app asks `clock_cron_ok` to
-- check it. Nobody has to copy a secret anywhere.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.cron_tokens (
  name  text primary key,
  token text not null
);
insert into private.cron_tokens (name, token)
  values ('clock-texts', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (name) do nothing;

create or replace function clock_cron_ok(p_token text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.cron_tokens
                 where name = 'clock-texts' and token = p_token);
$$;
revoke all on function clock_cron_ok(text) from public, anon, authenticated;
grant execute on function clock_cron_ok(text) to service_role;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Every five minutes. The app works out what is due; most wakes send nothing.
-- cron.schedule with a name replaces a job of the same name, so re-running
-- this moves the job rather than adding a second one.
select cron.schedule(
  'clock-texts',
  '*/5 * * * *',
  $job$
    select net.http_get(
      url := 'https://mh-investor-template.vercel.app/api/cron/clock-texts',
      headers := jsonb_build_object('authorization',
        'Bearer ' || (select token from private.cron_tokens where name = 'clock-texts')),
      timeout_milliseconds := 55000
    );
  $job$
);

-- 051: the morning delinquency report.
--
-- Emailed every day at 10am Eastern to the people listed in
-- report_recipients. Three pieces:
--
--   report_recipients  who gets it, each with the day they start (and stop).
--                      Somebody joining on the 15th is added now and
--                      receives nothing until the 15th. A row, not a
--                      deployment: adding a person is an insert.
--
--   report_runs        one row per scheduled send per day, claimed BEFORE
--                      sending. The schedule fires twice (see below), and
--                      a retry or a double fire must not email four people
--                      the same list twice. It also says whether the send
--                      worked, which is otherwise invisible from here.
--
--   the schedule       pg_cron, not Vercel. Vercel's Hobby plan fires a
--                      daily cron "within the hour", and a UTC expression
--                      cannot follow daylight saving. So the database asks
--                      at 14:00 AND 15:00 UTC, and the route sends only on
--                      the one that is 10 o'clock in New York -- 15:00 in
--                      winter, 14:00 in summer.
--
-- The schedule authenticates with a key generated here and kept in Vault.
-- Nobody has to copy it anywhere: the route asks the database whether a
-- key is the right one (report_key_ok), and only the server can ask.
--
-- Safe to run twice.

create table if not exists public.report_recipients (
  id         uuid primary key default gen_random_uuid(),
  report     text not null default 'delinquency',
  email      text not null check (position('@' in email) > 1),
  name       text,
  starts_on  date,
  ends_on    date,
  created_at timestamptz not null default now(),
  unique (report, email)
);
alter table public.report_recipients enable row level security;

create table if not exists public.report_runs (
  id          uuid primary key default gen_random_uuid(),
  report      text not null,
  day         date not null,
  scheduled   boolean not null default true,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  sent_to     text[],
  detail      text
);
-- One scheduled send per report per day. A send somebody asked for by hand
-- (scheduled = false) is not limited.
create unique index if not exists report_runs_once_a_day
  on public.report_runs (report, day) where scheduled;
alter table public.report_runs enable row level security;

-- No policies on either: the server reads and writes them with the service
-- role, and nothing in a browser has any business with them.
revoke all on public.report_recipients from anon, authenticated;
revoke all on public.report_runs from anon, authenticated;

-- The key the schedule presents.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'reports_cron_key') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'reports_cron_key',
      'Presented by the pg_cron report jobs to /api/cron/delinquency');
  end if;
end $$;

create or replace function public.report_key_ok(k text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'reports_cron_key' and decrypted_secret = k and length(k) >= 32
  );
$$;
revoke all on function public.report_key_ok(text) from public, anon, authenticated;
grant execute on function public.report_key_ok(text) to service_role;

-- Who gets it.
insert into public.report_recipients (report, email, name, starts_on) values
  ('delinquency', 'cade@larabeehomesllc.com', 'Cade Larabee', null),
  ('delinquency', 'sam@larabeehomesllc.com', 'Samantha Graber', null)
on conflict (report, email) do nothing;

-- The schedule: twice, an hour apart; the route keeps the one that is 10am
-- in New York.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'delinquency-report-14utc', '0 14 * * *',
  $job$
  select net.http_post(
    url := 'https://mh-investor-template.vercel.app/api/cron/delinquency',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'reports_cron_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
  $job$);

select cron.schedule(
  'delinquency-report-15utc', '0 15 * * *',
  $job$
  select net.http_post(
    url := 'https://mh-investor-template.vercel.app/api/cron/delinquency',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'reports_cron_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
  $job$);

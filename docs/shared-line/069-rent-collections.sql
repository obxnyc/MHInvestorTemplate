-- 069 Rent collections: who owes, what step they are at, what they promised.
--
-- The rules are in apps/inbox/lib/collections.ts. This is where they keep
-- their record:
--
--   collection_accounts  one row per Rent Manager tenant: the balance as last
--                        read, the step of the eviction process, the court date
--   collection_readings  every CHANGE of a balance, so a payment can be read as
--                        a fall between two readings (this app keeps no ledger)
--   collection_promises  "I'll pay $400 on Friday", who took it, and whether it
--                        came
--   collection_events    the notes and the history: every note, every step
--                        taken and by whom, every promise made or broken
--   collection_texts     the reminder ledger: one row per text, claimed BEFORE
--                        it is sent, so a second wake cannot send it twice
--   collection_settings  the policy's days, which reminders are on, and whether
--                        they go by themselves (off until somebody turns it on)
--   collection_pulls     each read of Rent Manager: when, how many, and whether
--                        it was whole -- "balances as of" is a claim with a time
--
-- Read by the desk and the read-only guest; written only by the app's own
-- routes, which check who is asking.
--
-- The "Potential issue detected" warning is the `revoke`s and the
-- `drop policy if exists` before each create policy. Nothing is removed.
-- Safe to re-run.

create table if not exists collection_accounts (
  rm_tenant_id   integer primary key,
  name           text not null,
  rm_status      text,
  contact_id     uuid references contacts(id) on delete set null,
  unit_id        uuid references units(id) on delete set null,
  place          text,
  balance_cents  integer not null default 0,
  oldest_charge  date,
  read_at        timestamptz,
  stage          text not null default 'current'
                 check (stage in ('current','late','filed','judgment','writ','out')),
  stage_on       date,
  stage_by       uuid references staff(id),
  court_on       date,
  case_number    text,
  -- Set when the balance was paid off at a stage past the demand: a filed
  -- case somebody now has to dismiss. Cleared when they say they have.
  paid_during    text,
  assigned_to    uuid references staff(id),
  updated_at     timestamptz not null default now()
);
create index if not exists collection_accounts_owing on collection_accounts (balance_cents) where balance_cents > 0;
create index if not exists collection_accounts_contact on collection_accounts (contact_id);

create table if not exists collection_readings (
  id            bigserial primary key,
  rm_tenant_id  integer not null references collection_accounts(rm_tenant_id) on delete cascade,
  at            timestamptz not null default now(),
  cents         integer not null
);
create index if not exists collection_readings_by on collection_readings (rm_tenant_id, at);

create table if not exists collection_promises (
  id                uuid primary key default gen_random_uuid(),
  rm_tenant_id      integer not null references collection_accounts(rm_tenant_id) on delete cascade,
  amount_cents      integer not null check (amount_cents > 0),
  due_on            date not null,
  made_at           timestamptz not null default now(),
  made_by           uuid references staff(id),
  balance_at_cents  integer not null,
  paid_now_cents    integer not null default 0 check (paid_now_cents >= 0),
  note              text,
  -- The message it was read out of, when it was.
  message_id        uuid references messages(id) on delete set null,
  -- 'open' | 'cancelled' is what a person sets; kept/broken are read off the
  -- money every time the balance is read, and stored here so a list can sort
  -- on them.
  status            text not null default 'open' check (status in ('open','kept','broken','cancelled')),
  paid_cents        integer not null default 0,
  judged_at         timestamptz,
  cancelled_by      uuid references staff(id),
  cancelled_at      timestamptz
);
create index if not exists collection_promises_by on collection_promises (rm_tenant_id, made_at desc);
create index if not exists collection_promises_due on collection_promises (due_on) where status = 'open';

create table if not exists collection_events (
  id            uuid primary key default gen_random_uuid(),
  rm_tenant_id  integer not null references collection_accounts(rm_tenant_id) on delete cascade,
  at            timestamptz not null default now(),
  by            uuid references staff(id),
  kind          text not null check (kind in ('note','stage','promise','payment','text','system')),
  body          text not null check (length(trim(body)) > 0),
  stage_from    text,
  stage_to      text,
  promise_id    uuid references collection_promises(id) on delete set null
);
create index if not exists collection_events_by on collection_events (rm_tenant_id, at desc);

create table if not exists collection_texts (
  key           text primary key,
  rm_tenant_id  integer not null references collection_accounts(rm_tenant_id) on delete cascade,
  kind          text not null,
  claimed_at    timestamptz not null default now(),
  sent_by       uuid references staff(id),   -- null: sent by the schedule
  status        text not null default 'claimed' check (status in ('claimed','sent','failed','skipped')),
  detail        text,
  message_id    uuid references messages(id) on delete set null
);
create index if not exists collection_texts_by on collection_texts (rm_tenant_id, claimed_at desc);

create table if not exists collection_settings (
  id          boolean primary key default true check (id),
  policy      jsonb not null default '{}'::jsonb,
  enabled     text[] not null default array['before_due','due_today','last_day','late','promise_eve','promise_missed'],
  -- Off until somebody turns it on. Until then the screen drafts the day's
  -- texts and a person presses Send.
  auto_send   boolean not null default false,
  send_hour   smallint not null default 9 check (send_hour between 8 and 19),
  updated_by  uuid references staff(id),
  updated_at  timestamptz not null default now()
);
insert into collection_settings (id) values (true) on conflict (id) do nothing;

create table if not exists collection_pulls (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  ok        boolean not null,
  tenants   integer not null default 0,
  owing     integer not null default 0,
  partial   boolean not null default false,
  detail    text
);

do $$
declare t text;
begin
  foreach t in array array['collection_accounts','collection_readings','collection_promises',
                           'collection_events','collection_texts','collection_settings','collection_pulls']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select on %I to authenticated', t);
    execute format('revoke insert, update, delete on %I from authenticated', t);
    execute format('drop policy if exists desk_reads_%s on %I', t, t);
    execute format($p$create policy desk_reads_%s on %I for select
                     using (staff_has_role('admin','office','viewer'))$p$, t, t);
  end loop;
end $$;

-- Every hour, on the seventh minute, read the balances and send whatever is
-- due. Hourly so a payment shows within the hour, and so a payment and the
-- 1st's new charge rarely land between the same two readings. The route
-- itself decides what time it is in New York and texts nobody outside the
-- send hour.
select cron.schedule(
  'collections-hourly', '7 * * * *',
  $job$
  select net.http_post(
    url := 'https://app.larabeehomesllc.com/api/cron/collections',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'reports_cron_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
  $job$);

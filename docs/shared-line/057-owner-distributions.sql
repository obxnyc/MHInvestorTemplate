-- 057 Owner distributions: the monthly statement and the payments under it.
--
-- Every month each investor gets a statement (what came in, what came out,
-- what they are owed) and the net is paid through Wells Fargo Business Bill
-- Pay, which allows $25,000 a day. Until now that lived in an Excel file, a
-- screenshot pasted into an email, and memory.
--
--   owners.statement_email   where the statement goes (comma-separated ok)
--   owners.settle_days       business days Bill Pay takes to reach them
--   distribution_runs        one per month
--   distribution_statements  one per owner per month: the lines and the email
--   distribution_payments    each Bill Pay payment, planned then marked paid
--
-- The "Potential issue detected" warning in the SQL editor is the `alter
-- table ... add column` lines and the `drop policy if exists` before each
-- create policy. Nothing is removed or rewritten. Safe to re-run.

alter table owners add column if not exists statement_email text;
alter table owners add column if not exists settle_days integer not null default 2
  check (settle_days between 0 and 30);
alter table owners add column if not exists pay_note text;

create table if not exists distribution_runs (
  id          uuid primary key default gen_random_uuid(),
  month       date not null unique check (extract(day from month) = 1),
  daily_cap_cents integer not null default 2500000 check (daily_cap_cents > 0),
  start_on    date,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references staff(id)
);

create table if not exists distribution_statements (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references distribution_runs(id) on delete cascade,
  owner_id    uuid not null references owners(id),
  -- [{ "label": "Rent collected", "cents": 412500 }, { "label": "Lot rent", "cents": -375000 }]
  -- Positive is money in to the owner, negative is a deduction.
  lines       jsonb not null default '[]'::jsonb,
  note        text,
  hold        boolean not null default false,
  emailed_at  timestamptz,
  emailed_to  text,
  email_detail text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff(id),
  unique (run_id, owner_id)
);

create table if not exists distribution_payments (
  id           uuid primary key default gen_random_uuid(),
  statement_id uuid not null references distribution_statements(id) on delete cascade,
  send_on      date not null,
  amount_cents integer not null check (amount_cents > 0),
  paid_at      timestamptz,
  paid_by      uuid references staff(id),
  confirmation text,
  created_at   timestamptz not null default now()
);
create index if not exists distribution_payments_statement on distribution_payments(statement_id);

-- Office and admin read; the app writes through the service role.
alter table distribution_runs enable row level security;
alter table distribution_statements enable row level security;
alter table distribution_payments enable row level security;
revoke all on distribution_runs, distribution_statements, distribution_payments from anon;
grant select on distribution_runs, distribution_statements, distribution_payments to authenticated;
revoke insert, update, delete on distribution_runs, distribution_statements, distribution_payments from authenticated;

drop policy if exists office_reads_distribution_runs on distribution_runs;
create policy office_reads_distribution_runs on distribution_runs
  for select using (staff_has_role('admin','office'));
drop policy if exists office_reads_distribution_statements on distribution_statements;
create policy office_reads_distribution_statements on distribution_statements
  for select using (staff_has_role('admin','office'));
drop policy if exists office_reads_distribution_payments on distribution_payments;
create policy office_reads_distribution_payments on distribution_payments
  for select using (staff_has_role('admin','office'));

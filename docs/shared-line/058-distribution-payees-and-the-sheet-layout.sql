-- 058 Distribution payees, and statements laid out the way the accountant's
-- sheets are.
--
-- 057 keyed a statement on an `owners` row. The monthly breakdown does not:
-- it is twenty-odd Google Sheets, one per payee, and half the payees on it
-- (Meg Larabee 1142, Jack Curran, Kristen Skill, the Dutch-doors houses...)
-- are not rows in `owners` at all, which is synced from Rent Manager and is
-- not ours to add to. So a payee is its own thing: a name, where the
-- statement is emailed, how many bank days a payment takes, and optionally
-- the owner it corresponds to. It carries from month to month, so an email
-- address is typed once.
--
-- And a statement carries what the sheet carries beyond its lines: the title
-- (whose homes, which lots), last month's owed and what was actually paid
-- against it, the deposits on file, and the figures the sheet states, so the
-- screen can say when its own arithmetic disagrees with the sheet's.
--
-- Owed this month = this month's net + (last month's owed - what was paid).
--
-- The "Potential issue detected" warning is the `alter table` lines and the
-- `drop constraint/policy if exists`. Nothing is deleted. Safe to re-run.

create table if not exists distribution_payees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  emails      text,
  settle_days integer not null default 2 check (settle_days between 0 and 30),
  owner_id    uuid references owners(id),
  pay_note    text,
  sheet_id    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table distribution_statements alter column owner_id drop not null;
alter table distribution_statements add column if not exists payee_id uuid references distribution_payees(id);
alter table distribution_statements add column if not exists title text;
alter table distribution_statements add column if not exists previous_owed_cents integer;
alter table distribution_statements add column if not exists prior_paid_cents integer;
alter table distribution_statements add column if not exists prior_paid_on text;
alter table distribution_statements add column if not exists deposits_cents integer;
alter table distribution_statements add column if not exists stated_net_cents integer;
alter table distribution_statements add column if not exists stated_owed_cents integer;
alter table distribution_statements add column if not exists owed_note text;
alter table distribution_statements add column if not exists source jsonb;

alter table distribution_statements drop constraint if exists distribution_statements_run_id_owner_id_key;
create unique index if not exists distribution_statements_run_payee
  on distribution_statements(run_id, payee_id);

alter table distribution_payees enable row level security;
revoke all on distribution_payees from anon;
grant select on distribution_payees to authenticated;
revoke insert, update, delete on distribution_payees from authenticated;
drop policy if exists office_reads_distribution_payees on distribution_payees;
create policy office_reads_distribution_payees on distribution_payees
  for select using (staff_has_role('admin','office'));

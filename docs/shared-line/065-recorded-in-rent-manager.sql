-- 065 What has been entered in Rent Manager.
--
-- Every change made to a statement on the distributions screen -- a charge
-- added, a line deleted, an amount changed, a markup, a rent-agreement top-up
-- -- and every payment sent through Bill Pay is a difference from Rent
-- Manager until somebody enters it there. The screen lists them; this table
-- is the tick beside each one, with who ticked it and when.
--
-- The key describes the change itself (statement, kind, wording, amount), so
-- a change that is changed again after it was ticked comes back unticked.
--
-- The "Potential issue detected" warning is the `revoke` and the
-- `drop policy if exists` before the create policy. Nothing is removed.
-- Safe to re-run.

create table if not exists distribution_recorded (
  run_id      uuid not null references distribution_runs(id) on delete cascade,
  key         text not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references staff(id),
  primary key (run_id, key)
);

alter table distribution_recorded enable row level security;
revoke all on distribution_recorded from anon;
grant select on distribution_recorded to authenticated;
revoke insert, update, delete on distribution_recorded from authenticated;

drop policy if exists office_reads_distribution_recorded on distribution_recorded;
create policy office_reads_distribution_recorded on distribution_recorded
  for select using (staff_has_role('admin','office'));

-- Who else gets a copy. An owner's accountant goes on the owner
-- (`cc_emails`); the bookkeeper, who gets every statement, goes in the one
-- settings row. Both are copied (Cc), not hidden, so the owner can see who
-- else has it.
alter table distribution_payees add column if not exists cc_emails text;

create table if not exists distribution_settings (
  id     boolean primary key default true check (id),
  cc_all text
);
insert into distribution_settings (id, cc_all) values (true, 'alex@larabeehomesllc.com')
  on conflict (id) do nothing;
alter table distribution_settings enable row level security;
revoke all on distribution_settings from anon;
grant select on distribution_settings to authenticated;
revoke insert, update, delete on distribution_settings from authenticated;
drop policy if exists office_reads_distribution_settings on distribution_settings;
create policy office_reads_distribution_settings on distribution_settings
  for select using (staff_has_role('admin','office'));

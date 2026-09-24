-- Repair: turn on row-level security everywhere
--
-- ONLY needed if you ran the earlier version of schema.sql — the one that
-- protected 8 tables and left 15 open. Check first:
--
--   select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
--
-- 0 means you already have the fixed version and this file is unnecessary.
-- 15 means run this. It is safe to run either way, and safe to run twice.
--
-- Why it matters: Supabase publishes every table in `public` through its REST
-- API, and the anon key that reaches it is embedded in the browser. A table
-- with RLS off is readable by anyone who views the page source — which, before
-- this, included every tenant's phone number, every applicant's credit score,
-- and the staff PIN hashes.

-- ---------------------------------------------------------------- enable

alter table staff            enable row level security;
alter table teams            enable row level security;
alter table team_members     enable row level security;
alter table properties       enable row level security;
alter table units            enable row level security;
alter table contacts         enable row level security;
alter table consent          enable row level security;
alter table conversations    enable row level security;
alter table messages         enable row level security;
alter table calls            enable row level security;
alter table notes            enable row level security;
alter table templates        enable row level security;
alter table work_orders      enable row level security;
alter table prequal_rule_sets     enable row level security;
alter table prequal_submissions   enable row level security;
alter table showings         enable row level security;
alter table inquiries        enable row level security;
alter table nurture_touches  enable row level security;
alter table reassigned_number_checks enable row level security;
alter table court_filings    enable row level security;
alter table push_subscriptions    enable row level security;
alter table broadcasts       enable row level security;
alter table audit_log        enable row level security;

-- ---------------------------------------------------------------- who is asking

-- SECURITY DEFINER is load-bearing: a policy ON staff that queries staff would
-- recurse forever. These run as the owner, so the lookup inside them is not
-- itself policed.
create or replace function is_active_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff s where s.id = auth.uid() and s.active);
$$;

create or replace function staff_has_role(variadic p_roles staff_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff s
                 where s.id = auth.uid() and s.active and s.role = any(p_roles));
$$;

-- ---------------------------------------------------------------- grants

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke insert, update, delete on all tables in schema public from authenticated;

-- RLS is row-level and cannot hide a column, so the PIN needs a column grant.
revoke select on staff from authenticated;
grant select (id, full_name, role, forward_to, client_identity, active, created_at)
  on staff to authenticated;

-- ---------------------------------------------------------------- policies

-- Dropped first so this file can be run twice without erroring, and so the
-- three earlier policies that said `using (true)` or inlined a staff lookup are
-- replaced rather than left sitting alongside the new ones. A leftover
-- permissive policy is an OR: the weakest one wins.
drop policy if exists office_reads_all           on conversations;
drop policy if exists staff_read_teams           on teams;
drop policy if exists staff_read_members         on team_members;
drop policy if exists admin_reads_filings        on court_filings;
drop policy if exists admin_reads_audit          on audit_log;
drop policy if exists staff_reads_roster         on staff;
drop policy if exists staff_reads_props          on properties;
drop policy if exists staff_reads_units          on units;
drop policy if exists staff_reads_contacts       on contacts;
drop policy if exists staff_reads_consent        on consent;
drop policy if exists staff_reads_calls          on calls;
drop policy if exists staff_reads_templates      on templates;
drop policy if exists staff_reads_rules          on prequal_rule_sets;
drop policy if exists leasing_reads_submissions  on prequal_submissions;
drop policy if exists leasing_reads_showings     on showings;
drop policy if exists leasing_reads_inquiries    on inquiries;
drop policy if exists leasing_reads_nurture      on nurture_touches;
drop policy if exists office_reads_broadcasts    on broadcasts;
drop policy if exists admin_reads_rnd            on reassigned_number_checks;
drop policy if exists own_push_subscriptions     on push_subscriptions;
drop policy if exists office_reads_work_orders   on work_orders;
drop policy if exists tech_reads_own_work_orders on work_orders;
drop policy if exists staff_writes_own_notes     on notes;

create policy office_reads_all on conversations for select
  using (staff_has_role('admin','office'));
create policy staff_read_teams   on teams        for select using (is_active_staff());
create policy staff_read_members on team_members for select using (is_active_staff());
create policy admin_reads_filings on court_filings for select using (staff_has_role('admin'));
create policy admin_reads_audit   on audit_log     for select using (staff_has_role('admin'));

create policy staff_reads_roster    on staff        for select using (is_active_staff());
create policy staff_reads_props     on properties   for select using (is_active_staff());
create policy staff_reads_units     on units        for select using (is_active_staff());
create policy staff_reads_contacts  on contacts     for select using (is_active_staff());
create policy staff_reads_consent   on consent      for select using (is_active_staff());
create policy staff_reads_calls     on calls        for select using (is_active_staff());
create policy staff_reads_templates on templates    for select using (is_active_staff());
create policy staff_reads_rules on prequal_rule_sets for select using (is_active_staff());

create policy leasing_reads_submissions on prequal_submissions for select
  using (staff_has_role('admin','office'));
create policy leasing_reads_showings  on showings for select
  using (staff_has_role('admin','office','shower'));
create policy leasing_reads_inquiries on inquiries for select
  using (staff_has_role('admin','office'));
create policy leasing_reads_nurture   on nurture_touches for select
  using (staff_has_role('admin','office'));
create policy office_reads_broadcasts on broadcasts for select
  using (staff_has_role('admin','office'));
create policy admin_reads_rnd on reassigned_number_checks for select
  using (staff_has_role('admin'));
create policy own_push_subscriptions on push_subscriptions for select
  using (staff_id = auth.uid());

create policy office_reads_work_orders on work_orders for select
  using (staff_has_role('admin','office'));
create policy tech_reads_own_work_orders on work_orders for select
  using (assigned_tech = auth.uid());

create policy staff_writes_own_notes on notes for insert
  with check (author_id = auth.uid() and is_active_staff());

-- Confirm it took.
do $$
declare open_tables text[];
begin
  select array_agg(c.relname order by c.relname) into open_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if open_tables is not null then
    raise exception 'still unprotected: %', open_tables;
  end if;
  raise notice 'every table in public now has row-level security';
end $$;

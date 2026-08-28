-- Run after schema.sql. Creates the groups and points inbound classification
-- at them. Add your people once they have signed in once (Supabase Auth
-- creates auth.users on first magic-link login; staff rows reference it).

insert into teams (key, name, category) values
  ('maintenance', 'Maintenance',   'maintenance'),
  ('leasing',     'Leasing',       'prospect'),
  ('tenants',     'Current tenants','current_tenant'),
  ('vendors',     'Vendors',       'vendor')
on conflict (key) do nothing;

-- 1. Have each person sign in once at /login.
-- 2. Find their id:  select id, email from auth.users;
-- 3. Then, per person:
--
--    insert into staff (id, full_name, role, forward_to) values
--      ('<auth.users.id>', 'Amy Rivera', 'office', '+15555550101');
--
--    insert into team_members (team_id, staff_id)
--    select id, '<auth.users.id>' from teams where key = 'maintenance';
--
-- Roles: admin sees the audit page and every thread; office sees every thread;
-- tech sees only their teams' threads and their own work orders.

-- ---------------------------------------------------------------- prequalification

-- Version 1 of the screening criteria. Publish these at /criteria before
-- applying them: a dated, public ruleset plus the audit log is the cheapest
-- fair-housing defence available, and consistency you can demonstrate is the
-- whole ballgame.
--
-- Never edit this row. Insert a new version and set effective_to on the old
-- one, so any past decision can be replayed against the rules that produced it.
insert into prequal_rule_sets (version, criteria, effective_from, published_url)
values (1, '{
  "version": 1,
  "criteria": [
    { "key": "income_ratio",
      "label": "Household income vs. the rent you would pay",
      "pass": ">= 3.0", "marginal": ">= 2.5",
      "explain": "we look for monthly household income of at least 3x the rent you would pay" },
    { "key": "credit_score",
      "label": "Credit score",
      "pass": ">= 620", "marginal": ">= 560",
      "explain": "we look for a credit score of 620 or above" },
    { "key": "rental_history_months",
      "label": "Verifiable rental history",
      "pass": ">= 24", "marginal": ">= 12",
      "explain": "we look for at least 24 months of verifiable rental history" },
    { "key": "years_since_eviction",
      "label": "Time since any eviction judgment",
      "pass": ">= 5", "marginal": ">= 3",
      "explain": "we look for at least 5 years since any eviction judgment" }
  ]
}'::jsonb, current_date, 'https://larabeehomesllc.com/rental-criteria')
on conflict (version) do nothing;

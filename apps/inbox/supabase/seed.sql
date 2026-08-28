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

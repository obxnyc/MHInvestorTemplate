-- 056: whose phone a clock-in came from, and who is told when one looks wrong.
--
--   staff_devices          every phone (a long-lived id the app keeps on it)
--                          and every man who has clocked in on it. A phone
--                          with two men on it is the buddy case: one man
--                          clocking another in.
--   shifts.start_device    which phone this clock-in came from.
--   crew_setup.integrity_alerts
--                          who gets "Check: ..." texts as they happen. The
--                          OWNER, not the crew lead: "Jose would benefit from
--                          his guys getting more hours", so a check he
--                          controls is not a check.
--
-- Office and admin read it; nothing in the browser writes it.
-- Safe to re-run.

create table if not exists staff_devices (
  device_id  text not null check (length(device_id) between 16 and 64),
  staff_id   uuid not null references staff(id) on delete cascade,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  user_agent text,
  primary key (device_id, staff_id)
);
create index if not exists staff_devices_by_staff on staff_devices (staff_id);
alter table staff_devices enable row level security;
revoke all on staff_devices from anon;
grant select on staff_devices to authenticated;
drop policy if exists office_reads_devices on staff_devices;
create policy office_reads_devices on staff_devices
  for select using (staff_has_role('admin','office'));

alter table shifts add column if not exists start_device text;
alter table crew_setup add column if not exists integrity_alerts boolean not null default false;

alter table work_orders
  add column if not exists cost_cents  integer,
  add column if not exists invoice_ref text,
  add column if not exists trade_id    text references trades(id),
  add column if not exists costed_on   date,
  add column if not exists costed_by   uuid references staff(id) on delete set null;

create index if not exists work_orders_cost
  on work_orders (trade_id, completed_at) where cost_cents is not null;

update work_orders set costed_on = coalesce(costed_on, completed_at::date)
  where cost_cents is not null and costed_on is null;

do $$ begin
  raise notice 'jobs can carry what they cost';
end $$;

create table if not exists vendor_applications (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  company     text,
  phone       text not null,
  email       text,
  trades      text[] not null default '{}',
  markets     uuid[] not null default '{}',
  notes       text,
  claims_insured   boolean not null default false,
  claims_licensed  boolean not null default false,
  license_ref      text,

  status      text not null default 'pending'
              check (status in ('pending','approved','declined')),
  decided_by  uuid references staff(id) on delete set null,
  decided_at  timestamptz,
  decline_reason text,
  contact_id  uuid references contacts(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists vendor_applications_status
  on vendor_applications (status, created_at desc);

create unique index if not exists vendor_applications_open
  on vendor_applications (phone) where status = 'pending';

alter table vendor_applications enable row level security;
revoke all on vendor_applications from anon;
revoke insert, update, delete on vendor_applications from authenticated;

drop policy if exists staff_reads_vendor_applications on vendor_applications;
create policy staff_reads_vendor_applications on vendor_applications
  for select using (is_active_staff());

do $$ begin
  raise notice 'trades can apply, and the office can approve them';
end $$;

create table if not exists access_requests (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  email         text not null,
  phone         text,
  requested_role staff_role not null default 'office',
  granted_role   staff_role,
  reason        text,

  status      text not null default 'pending'
              check (status in ('pending','approved','declined')),
  decided_by  uuid references staff(id) on delete set null,
  decided_at  timestamptz,
  decline_reason text,
  staff_id    uuid references staff(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists access_requests_status
  on access_requests (status, created_at desc);

create unique index if not exists access_requests_open
  on access_requests (lower(email)) where status = 'pending';

alter table access_requests enable row level security;
revoke all on access_requests from anon;
revoke insert, update, delete on access_requests from authenticated;

drop policy if exists admin_reads_access_requests on access_requests;
create policy admin_reads_access_requests on access_requests
  for select using (staff_has_role('admin'));

do $$ begin
  raise notice 'people can ask for access, and an admin decides';
end $$;

create table if not exists staff_invites (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  full_name   text,
  phone       text not null,
  role        staff_role not null default 'office',
  invited_by  uuid references staff(id) on delete set null,
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz,
  staff_id    uuid references staff(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists staff_invites_open
  on staff_invites (expires_at) where used_at is null;

alter table staff_invites enable row level security;
revoke all on staff_invites from anon;
revoke insert, update, delete on staff_invites from authenticated;

drop policy if exists admin_reads_invites on staff_invites;
create policy admin_reads_invites on staff_invites
  for select using (staff_has_role('admin'));

do $$ begin
  raise notice 'people can be invited by text';
end $$;

-- 075: driving for dollars. A scout sees a tired park, a boarded-up
-- fourplex, a lot gone to weeds; taps once; the phone records where and
-- the camera records what; the county says who owns it.
--
-- One row per sighting. Photos sit in the private `attachments` bucket at
-- scout/<staff id>/<server ms>-<n>.<ext>, the time being the SERVER's when
-- the photo arrived -- the same rule as the clock-in photos (055), so a
-- sighting carries pictures taken by the person who logged it, recently.
--
-- The owner lookup is kept as it came back (`parcel`), with the owner and
-- mailing address lifted out for the list, and `lookup` says what happened:
-- found, none (no parcel under that point), outside (not NC -- the
-- statewide layer stops at the border), or failed (the county did not
-- answer) -- because "no owner" and "could not ask" are different answers.
--
-- Nothing here deletes. A sighting the office passes on is marked pass.

create table if not exists scout_spots (
  id           uuid primary key default gen_random_uuid(),
  by           uuid not null references staff(id),
  lat          double precision not null,
  lon          double precision not null,
  accuracy_m   double precision,
  kind         text not null default 'other'
               check (kind in ('mhp','multifamily','single_family','land','commercial','other')),
  tags         text[] not null default '{}',
  note         text,
  photos       text[] not null default '{}',
  lookup       text not null default 'pending' check (lookup in ('pending','found','none','outside','failed')),
  parcel       jsonb,
  owner_name   text,
  mail_address text,
  site_address text,
  county       text,
  parcel_no    text,
  acres        numeric,
  assessed     numeric,
  stage        text not null default 'new' check (stage in ('new','researching','contacted','talking','offer','contract','closed','pass')),
  office_note  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references staff(id)
);
create index if not exists scout_spots_by on scout_spots (by, created_at desc);
create index if not exists scout_spots_when on scout_spots (created_at desc);

alter table scout_spots enable row level security;
revoke all on scout_spots from anon;
grant select, insert, update on scout_spots to authenticated;
revoke delete on scout_spots from authenticated;

-- Anybody signed in may log a sighting as themselves, and see their own.
-- The office sees and works all of them.
drop policy if exists scout_logs_own on scout_spots;
create policy scout_logs_own on scout_spots for insert
  with check (by = auth.uid());
drop policy if exists scout_sees_own on scout_spots;
create policy scout_sees_own on scout_spots for select
  using (by = auth.uid() or staff_has_role('admin','office'));
drop policy if exists office_works_scout_spots on scout_spots;
create policy office_works_scout_spots on scout_spots for update
  using (staff_has_role('admin','office')) with check (staff_has_role('admin','office'));

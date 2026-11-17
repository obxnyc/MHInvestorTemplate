-- 071: the brokers and realtors who list parks, and getting on every one
-- of their buyer lists.
--
-- A broker is a person, not a firm: the relationship is with whoever picks
-- up the phone. `stage` is where that relationship stands. Listings they
-- have had are kept against them, because "you listed Pine Acres in
-- Goldsboro last spring" is the first line of a good email.
--
-- The pitch -- who the buyer is and what they have done -- is one row of
-- settings, edited on the screen, so it is never hard-coded into an email.
--
-- Nothing here deletes.

create table if not exists brokers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) > 0),
  firm          text,
  -- commercial: lists parks for a living. residential: a realtor who has
  -- listed a park, or might come across one -- a cheap pair of eyes.
  kind          text not null default 'commercial' check (kind in ('commercial','residential')),
  parks_listed  int,                  -- how many parks we know they have listed
  phone         text,
  email         text,
  city          text,
  state         text,
  covers        text,                 -- states / regions they work
  evidence      text,                 -- what shows they do parks
  source_url    text,
  stage         text not null default 'new'
                check (stage in ('new','emailed','replied','on_list','sending_deals','cold')),
  starred       boolean not null default false,
  next_touch    date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references staff(id)
);
-- One broker once: the same email twice is the same person.
create unique index if not exists brokers_email_once on brokers (lower(email)) where email is not null and email <> '';
create unique index if not exists brokers_name_firm_once on brokers (lower(name), lower(coalesce(firm,'')));

create table if not exists broker_listings (
  id         bigserial primary key,
  broker_id  uuid not null references brokers(id),
  title      text not null,
  location   text,
  price      numeric,
  lots       int,
  url        text,
  source     text,                      -- crexi, loopnet, mhpstore, email alert, typed
  seen_at    timestamptz not null default now()
);
create index if not exists broker_listings_broker on broker_listings (broker_id, seen_at desc);

create table if not exists broker_touches (
  id         bigserial primary key,
  broker_id  uuid not null references brokers(id),
  kind       text not null check (kind in ('email','call','text','meeting','note','deal')),
  body       text,
  at         timestamptz not null default now(),
  by         uuid references staff(id)
);
create index if not exists broker_touches_broker on broker_touches (broker_id, at desc);

create table if not exists acquisition_settings (
  id          boolean primary key default true check (id),
  pitch       text,                     -- to commercial brokers
  pitch_residential text,               -- to realtors who might come across one
  signature   text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff(id)
);
insert into acquisition_settings (id) values (true) on conflict do nothing;

alter table brokers              enable row level security;
alter table broker_listings      enable row level security;
alter table broker_touches       enable row level security;
alter table acquisition_settings enable row level security;
revoke all on brokers, broker_listings, broker_touches, acquisition_settings from anon;
grant select, insert, update on brokers, broker_listings, acquisition_settings to authenticated;
grant select, insert on broker_touches to authenticated;
revoke delete on brokers, broker_listings, broker_touches, acquisition_settings from authenticated;
grant usage on sequence broker_listings_id_seq, broker_touches_id_seq to authenticated;

drop policy if exists office_works_brokers on brokers;
create policy office_works_brokers on brokers for all
  using (staff_has_role('admin','office')) with check (staff_has_role('admin','office'));
drop policy if exists office_works_broker_listings on broker_listings;
create policy office_works_broker_listings on broker_listings for all
  using (staff_has_role('admin','office')) with check (staff_has_role('admin','office'));
drop policy if exists office_reads_broker_touches on broker_touches;
create policy office_reads_broker_touches on broker_touches for select
  using (staff_has_role('admin','office'));
drop policy if exists office_logs_broker_touches on broker_touches;
create policy office_logs_broker_touches on broker_touches for insert
  with check (staff_has_role('admin','office') and by = auth.uid());
drop policy if exists office_works_acquisition_settings on acquisition_settings;
create policy office_works_acquisition_settings on acquisition_settings for all
  using (staff_has_role('admin','office')) with check (staff_has_role('admin','office'));

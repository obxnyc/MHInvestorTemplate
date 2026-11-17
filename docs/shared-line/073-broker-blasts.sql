-- 073: one message to many brokers -- "anything on your radar?" -- and the
-- record of who got which.
--
-- A blast is written once, sent to everybody the filter picks who has an
-- email and has not opted out, and remembered recipient by recipient, so
-- "did Glenn get the October one" has an answer and the next blast can
-- leave out somebody who asked not to be written to.
--
-- Opting out is a date, not a flag: when somebody asked is the part that
-- matters if anybody ever asks. Nothing here deletes.

alter table brokers add column if not exists opted_out_at timestamptz;
alter table acquisition_settings add column if not exists mailing_address text;

create table if not exists broker_blasts (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null check (length(trim(subject)) > 0),
  body        text not null check (length(trim(body)) > 0),
  audience    jsonb not null default '{}'::jsonb,   -- the filter, as chosen
  via         text not null check (via in ('app','gmail')),
  recipients  int not null default 0,
  sent        int not null default 0,
  failed      int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references staff(id)
);

create table if not exists broker_blast_recipients (
  blast_id   uuid not null references broker_blasts(id),
  broker_id  uuid not null references brokers(id),
  email      text not null,
  status     text not null check (status in ('queued','sent','failed')),
  batch      int,                -- which Gmail BCC batch, so "batch 2 went"
                                 -- means the same fifty people on both sides
  detail     text,
  at         timestamptz not null default now(),
  primary key (blast_id, broker_id)
);
create index if not exists broker_blast_recipients_broker on broker_blast_recipients (broker_id, at desc);

alter table broker_blasts           enable row level security;
alter table broker_blast_recipients enable row level security;
revoke all on broker_blasts, broker_blast_recipients from anon;
grant select, insert, update on broker_blasts, broker_blast_recipients to authenticated;
revoke delete on broker_blasts, broker_blast_recipients from authenticated;

drop policy if exists office_works_broker_blasts on broker_blasts;
create policy office_works_broker_blasts on broker_blasts for all
  using (staff_has_role('admin','office')) with check (staff_has_role('admin','office'));
drop policy if exists office_works_broker_blast_recipients on broker_blast_recipients;
create policy office_works_broker_blast_recipients on broker_blast_recipients for all
  using (staff_has_role('admin','office')) with check (staff_has_role('admin','office'));

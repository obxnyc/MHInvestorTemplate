-- Larabee Homes shared line — Postgres / Supabase schema
-- Reference schema for the "build it yourself" path in PLAN.md.
-- Assumes Supabase Auth owns auth.users; staff extends it.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums

create type staff_role     as enum ('admin','office','tech','shower');
create type party_type     as enum ('current_tenant','prospect','vendor','tech','owner','other');
create type conv_category  as enum ('maintenance','prospect','current_tenant','vendor','collections','other');
create type conv_status    as enum ('open','waiting','snoozed','closed');
create type msg_direction  as enum ('inbound','outbound');
create type msg_status     as enum ('queued','sent','delivered','undelivered','failed','received');
create type wo_status      as enum ('new','assigned','accepted','scheduled','in_progress','needs_parts','done','cancelled');

-- ---------------------------------------------------------------- people & places

create table staff (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  role          staff_role not null default 'office',
  -- cell used as a <Number> leg in the voice ring group, E.164
  forward_to    text,
  -- Twilio Client identity, if using softphone instead of cell forwarding
  client_identity text unique,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table properties (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  created_at  timestamptz not null default now()
);

create table units (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  label        text not null,              -- lot number / unit number
  is_vacant    boolean not null default false,
  unique (property_id, label)
);

create table contacts (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null unique,       -- E.164, the join key for every webhook
  full_name    text,
  party        party_type not null default 'other',
  unit_id      uuid references units(id) on delete set null,
  tags         text[] not null default '{}',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on contacts (party);
create index on contacts using gin (tags);

-- Texting consent and opt-out. Twilio's Messaging Service keeps its own STOP
-- list; this table is your record of why you were allowed to text in the
-- first place, which is the part that matters in a dispute.
create table consent (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts(id) on delete cascade,
  granted       boolean not null,
  source        text not null,             -- 'lease', 'web form', 'inbound text', 'STOP'
  occurred_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- conversations

create table conversations (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null references contacts(id) on delete cascade,
  category       conv_category not null default 'other',
  -- set when the category came from the classifier rather than a human;
  -- below your threshold, leave unassigned instead of guessing
  category_confidence numeric(3,2),
  status         conv_status not null default 'open',
  assigned_to    uuid references staff(id) on delete set null,
  unit_id        uuid references units(id) on delete set null,
  subject        text,
  last_message_at timestamptz not null default now(),
  snooze_until   timestamptz,
  created_at     timestamptz not null default now()
);

-- The inbox query: open threads by category, most recent first.
create index on conversations (status, category, last_message_at desc);
create index on conversations (assigned_to, status);
-- At most one open conversation per contact, so inbound messages have an
-- unambiguous home.
create unique index one_open_conversation_per_contact
  on conversations (contact_id) where status <> 'closed';

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  direction        msg_direction not null,
  body             text,
  media_urls       text[] not null default '{}',
  -- unique so a Twilio webhook retry can never double-insert
  twilio_sid       text unique,
  status           msg_status not null default 'received',
  error_code       text,
  -- null for inbound; this column is the "who replied" answer
  sent_by          uuid references staff(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index on messages (conversation_id, created_at);

create table calls (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references conversations(id) on delete set null,
  contact_id       uuid references contacts(id) on delete set null,
  direction        msg_direction not null,
  twilio_call_sid  text unique,
  -- the winning <Number> leg from the Dial action callback; the "who
  -- answered" answer
  answered_by      uuid references staff(id) on delete set null,
  duration_seconds integer,
  recording_url    text,
  voicemail_text   text,
  created_at       timestamptz not null default now()
);

-- Internal only. Never rendered into an outbound message.
create table notes (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  author_id        uuid not null references staff(id) on delete cascade,
  body             text not null,
  created_at       timestamptz not null default now()
);

create table templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    conv_category,
  body        text not null,              -- supports {{first_name}}, {{lot}}
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- work & showings

create table work_orders (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references conversations(id) on delete set null,
  unit_id          uuid references units(id) on delete set null,
  summary          text not null,
  detail           text,
  urgency          smallint not null default 3,   -- 1 emergency .. 5 whenever
  status           wo_status not null default 'new',
  assigned_tech    uuid references staff(id) on delete set null,
  scheduled_for    timestamptz,
  photo_urls       text[] not null default '{}',
  completed_at     timestamptz,
  created_at       timestamptz not null default now()
);

create index on work_orders (status, urgency);
create index on work_orders (assigned_tech, status);

create table showings (
  id                uuid primary key default gen_random_uuid(),
  contact_id        uuid not null references contacts(id) on delete cascade,
  unit_id           uuid references units(id) on delete set null,
  shower_id         uuid references staff(id) on delete set null,
  scheduled_for     timestamptz not null,
  -- opaque id from Tenant Turner / ShowMojo / Rently
  external_event_id text unique,
  prequalified      boolean,
  prequal_detail    jsonb,
  confirmed_prospect_at timestamptz,
  confirmed_shower_at   timestamptz,
  attended          boolean,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------- audit

-- Append-only. Written by trigger rather than application code so a missed
-- call site in the app can't leave a gap in the record.
create table audit_log (
  id          bigserial primary key,
  actor_id    uuid references staff(id) on delete set null,
  entity      text not null,
  entity_id   uuid,
  action      text not null,              -- insert | update | delete
  changed     jsonb,                      -- {column: [before, after]}
  occurred_at timestamptz not null default now()
);

create index on audit_log (entity, entity_id, occurred_at desc);
create index on audit_log (actor_id, occurred_at desc);

revoke insert, update, delete on audit_log from public;

create or replace function log_change() returns trigger
language plpgsql security definer as $$
declare
  diff jsonb := '{}'::jsonb;
  k    text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if to_jsonb(new) -> k is distinct from to_jsonb(old) -> k then
        diff := diff || jsonb_build_object(
          k, jsonb_build_array(to_jsonb(old) -> k, to_jsonb(new) -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      return new;   -- nothing actually changed; don't log noise
    end if;
  elsif tg_op = 'INSERT' then
    diff := to_jsonb(new);
  else
    diff := to_jsonb(old);
  end if;

  insert into audit_log (actor_id, entity, entity_id, action, changed)
  values (
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    tg_table_name,
    coalesce((to_jsonb(new) ->> 'id')::uuid, (to_jsonb(old) ->> 'id')::uuid),
    lower(tg_op),
    diff
  );

  return coalesce(new, old);
end $$;

create trigger audit_conversations after insert or update or delete on conversations
  for each row execute function log_change();
create trigger audit_messages      after insert or update or delete on messages
  for each row execute function log_change();
create trigger audit_calls         after insert or update or delete on calls
  for each row execute function log_change();
create trigger audit_contacts      after insert or update or delete on contacts
  for each row execute function log_change();
create trigger audit_work_orders   after insert or update or delete on work_orders
  for each row execute function log_change();
create trigger audit_showings      after insert or update or delete on showings
  for each row execute function log_change();

-- ---------------------------------------------------------------- row level security

alter table conversations enable row level security;
alter table messages      enable row level security;
alter table notes         enable row level security;
alter table work_orders   enable row level security;
alter table audit_log     enable row level security;

-- Office staff see the whole inbox. That's the entire point of a shared line:
-- anyone can pick up where anyone else left off.
create policy office_reads_all on conversations for select
  using (exists (select 1 from staff s
                 where s.id = auth.uid() and s.role in ('admin','office') and s.active));

-- Techs see only conversations attached to a work order assigned to them.
create policy tech_reads_assigned on conversations for select
  using (exists (select 1 from work_orders w
                 where w.conversation_id = conversations.id
                   and w.assigned_tech = auth.uid()));

-- Only admins read the audit log, and nobody writes it from the client.
create policy admin_reads_audit on audit_log for select
  using (exists (select 1 from staff s
                 where s.id = auth.uid() and s.role = 'admin' and s.active));

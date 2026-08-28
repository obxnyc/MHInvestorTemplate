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
create type prequal_outcome as enum ('auto_approve','manual_review','declined','withdrawn');
create type consent_channel as enum ('sms','email','voice');
create type consent_purpose as enum ('transactional','marketing');
create type inquiry_outcome as enum (
  'open',              -- still in play, no outcome yet
  'leased_with_us',    -- retention track, not re-acquisition
  'leased_elsewhere',  -- the core nurture case
  'wrong_location',
  'price_mismatch',
  'bought_home',       -- suppress permanently
  'relocated_away',    -- suppress permanently
  'did_not_qualify',
  'unknown'            -- treat as leased_elsewhere; the safe assumption
);
create type touch_channel  as enum ('email','sms');
create type touch_state    as enum ('scheduled','suppressed','sent','replied','bounced','failed');

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

-- A team is the group that owns a kind of work -- maintenance, leasing,
-- collections. Conversations route to a team, and everyone on that team sees
-- the thread whether or not they are the one who claimed it. That shared
-- visibility is the point: anyone can pick up where anyone else left off.
create table teams (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,       -- 'maintenance', 'leasing', 'vendors'
  name        text not null,
  -- inbound conversations classified into this category land with this team
  category    conv_category,
  created_at  timestamptz not null default now()
);

create table team_members (
  team_id   uuid not null references teams(id) on delete cascade,
  staff_id  uuid not null references staff(id) on delete cascade,
  primary key (team_id, staff_id)
);

create index on team_members (staff_id);

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
  bedrooms     smallint,
  -- full contract rent; the prequalification income test derives the
  -- applicant's own share from this and any rental assistance
  monthly_rent numeric(10,2),
  is_vacant    boolean not null default false,
  available_on date,
  unique (property_id, label)
);

create index on units (is_vacant) where is_vacant;

create table contacts (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null unique,       -- E.164, the join key for every webhook
  -- Zego, Zillow and Squarespace often give an email before a phone number,
  -- so a contact can arrive email-first and get merged on phone later.
  email        text,
  full_name    text,
  party        party_type not null default 'other',
  unit_id      uuid references units(id) on delete set null,
  tags         text[] not null default '{}',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on contacts (party);
create index on contacts (email) where email is not null;
create index on contacts using gin (tags);

-- Consent and opt-out. Twilio's Messaging Service keeps its own STOP list;
-- this table is your record of why you were allowed to contact someone in the
-- first place, which is the part that matters in a dispute.
--
-- Transactional and marketing consent are tracked separately and must be
-- collected separately -- two unticked boxes on the form, never one. Bundling
-- them is the most common defect in a consent record.
create table consent (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts(id) on delete cascade,
  channel       consent_channel not null,
  purpose       consent_purpose not null,
  granted       boolean not null,
  source        text not null,             -- 'web form', 'lease', 'inbound text', 'STOP', 'phone'

  -- The exact sentence shown to them, verbatim, plus where they were. Not a
  -- boolean: when this is challenged in three years the form will have been
  -- redesigned twice, and the only thing that matters is what THIS person saw
  -- on THAT day.
  disclosure_text text,
  form_version    text,
  ip_address      inet,
  user_agent      text,

  occurred_at   timestamptz not null default now()
);

create index on consent (contact_id, channel, purpose, occurred_at desc);

-- Current state per contact/channel/purpose: the latest record wins.
-- Revocation rules effective 2025-04-11 require honoring an opt-out made by any
-- reasonable method, within 10 business days, ACROSS channels -- so a "stop
-- texting me" spoken on a call must write rows here for every marketing
-- purpose, not just the one it arrived on.
create view consent_current as
select distinct on (contact_id, channel, purpose)
       contact_id, channel, purpose, granted, occurred_at,
       -- carried through deliberately: proving consent means producing the
       -- exact wording shown, not a boolean saying a box was ticked
       source, disclosure_text, form_version
from consent
order by contact_id, channel, purpose, occurred_at desc;

-- ---------------------------------------------------------------- conversations

create table conversations (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null references contacts(id) on delete cascade,
  category       conv_category not null default 'other',
  -- set when the category came from the classifier rather than a human;
  -- below your threshold, leave unassigned instead of guessing
  category_confidence numeric(3,2),
  status         conv_status not null default 'open',
  team_id        uuid references teams(id) on delete set null,
  -- null means unclaimed: visible to the whole team, nobody has it yet
  assigned_to    uuid references staff(id) on delete set null,
  claimed_at     timestamptz,
  unit_id        uuid references units(id) on delete set null,
  subject        text,
  -- where this thread came in from: 'sms', 'zego', 'zillow', 'website', 'call'
  source         text not null default 'sms',
  -- Denormalised so the conversation list renders in one query. A texting UI
  -- shows the last thing said, and "latest child row per parent" is an
  -- expensive join to run on every list render.
  last_message_preview text,
  last_message_at timestamptz not null default now(),
  snooze_until   timestamptz,
  created_at     timestamptz not null default now()
);

-- The inbox query: open threads by category, most recent first.
create index on conversations (status, category, last_message_at desc);
create index on conversations (assigned_to, status);
create index on conversations (team_id, status, last_message_at desc);
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
  -- 'sms' | 'zego' | 'zillow' | 'website' -- an inbound message did not
  -- necessarily arrive over the phone line
  channel          text not null default 'sms',
  -- provider-side id (email Message-ID, form submission id) so a redelivered
  -- webhook cannot duplicate the message
  external_id      text unique,
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

  -- the winning <Number> leg from the Dial action callback: the "who answered"
  -- answer. Null on a missed call.
  answered_by      uuid references staff(id) on delete set null,
  -- who placed an outbound call, including a callback on a missed one
  initiated_by     uuid references staff(id) on delete set null,

  -- nobody picked up. Set on the Dial action callback when DialCallStatus is
  -- anything but 'completed'.
  missed           boolean not null default false,
  -- links a return call to the missed call it answers, which is what makes
  -- "did anyone call them back?" a query rather than a guess
  returns_call_id  uuid references calls(id) on delete set null,

  duration_seconds integer,
  recording_sid    text,
  recording_url    text,
  -- Twilio's built-in transcription only covers US English recordings between
  -- 2 and 120 seconds, so voicemail is capped at 120s to stay inside it.
  voicemail_text   text,
  created_at       timestamptz not null default now()
);

create index on calls (missed, created_at desc) where missed;
create index on calls (contact_id, created_at desc);

-- Internal only. Never rendered into an outbound message.
create table notes (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  author_id        uuid not null references staff(id) on delete cascade,
  body             text not null,
  -- @mentioned teammates, who get a push notification. This is what turns
  -- notes into coordination rather than a filing cabinet.
  mentions         uuid[] not null default '{}',
  created_at       timestamptz not null default now()
);

create index on notes (conversation_id, created_at);

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

-- Screening criteria live here as versioned data rather than in application
-- code, so a decision can always be replayed against the exact ruleset that
-- produced it. Never edit a row in place -- insert a new version.
create table prequal_rule_sets (
  id            uuid primary key default gen_random_uuid(),
  version       integer not null unique,
  criteria      jsonb not null,
  effective_from date not null,
  effective_to   date,               -- null while current
  published_url text,               -- the public criteria page shown to applicants
  created_by    uuid references staff(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table prequal_submissions (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid references contacts(id) on delete set null,
  unit_id       uuid references units(id) on delete set null,

  -- exactly what the applicant typed, never normalized in place; every
  -- derived number below must be reproducible from this
  answers       jsonb not null,

  -- Income test inputs, broken out because this is the field most likely to
  -- be challenged. tenant_share_rent is the applicant's own portion when
  -- rental assistance covers part of the rent -- applying the multiplier to
  -- full rent instead is a disparate-impact problem, and in California it is
  -- outright non-compliant.
  gross_monthly_income   numeric(10,2),
  assistance_monthly     numeric(10,2) not null default 0,
  tenant_share_rent      numeric(10,2),
  income_ratio           numeric(6,2) generated always as (
                           case when coalesce(tenant_share_rent,0) > 0
                                then gross_monthly_income / tenant_share_rent
                           end) stored,

  rule_set_id   uuid not null references prequal_rule_sets(id),
  outcome       prequal_outcome not null,

  -- one entry per criterion: {"key":"credit_score","verdict":"marginal",
  --                           "value":580,"threshold":">= 620"}
  -- This is what you show a reviewer, an applicant, or a regulator.
  criterion_results jsonb not null default '[]'::jsonb,
  reason_codes  text[] not null default '{}',

  -- set only for the manual-review tier; the tier where bias re-enters if it
  -- is not documented as carefully as the automated path
  reviewed_by   uuid references staff(id) on delete set null,
  review_reason text,
  reviewed_at   timestamptz,

  -- Gate for the booking page. The link does not exist until the ruleset says
  -- it should, so a prospect cannot reach the calendar by guessing a URL.
  booking_token text unique,
  booking_used_at timestamptz,
  booking_link  text,
  decided_at    timestamptz not null default now()
);

create index on prequal_submissions (outcome, decided_at desc);
create index on prequal_submissions (unit_id, decided_at desc);
-- The fair-housing query: everyone scored by one ruleset, and how they fared.
create index on prequal_submissions (rule_set_id, outcome);

create table showings (
  id                uuid primary key default gen_random_uuid(),
  contact_id        uuid not null references contacts(id) on delete cascade,
  unit_id           uuid references units(id) on delete set null,
  shower_id         uuid references staff(id) on delete set null,
  scheduled_for     timestamptz not null,
  -- Cal.com booking uid, from the BOOKING_CREATED webhook
  external_event_id text unique,
  submission_id     uuid references prequal_submissions(id) on delete set null,
  confirmed_prospect_at timestamptz,
  confirmed_shower_at   timestamptz,
  attended          boolean,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------- court filings

-- eFiling notifications from the NC courts (Tyler Technologies / Odyssey).
--
-- Deliberately NOT a conversation. An eviction filing is not a message to the
-- tenant, and putting it on the shared timeline would mean whoever picks up a
-- maintenance request also sees that the household is being evicted -- which
-- invites exactly the inconsistent treatment the rest of this system exists to
-- prevent. Admins only, on its own page.
create table court_filings (
  id             uuid primary key default gen_random_uuid(),
  -- the LLC that filed; Larabee files under more than one entity
  plaintiff      text,
  defendant      text,
  case_number    text,
  case_style     text,
  court          text,
  filing_type    text,               -- 'Complaint in Summary Ejectment', 'Voluntary Dismissal', ...
  status         text,               -- 'Accepted', 'Rejected', 'Submitted'
  envelope_number text unique,       -- Tyler's id; dedupes redelivered mail
  filed_by       text,
  submitted_at   timestamptz,
  accepted_at    timestamptz,

  lead_file      text,
  -- Tyler's stamped-copy links expire; record when so the file can be pulled
  -- down before it goes
  document_url   text,
  document_expires_on date,
  document_saved boolean not null default false,

  -- best-effort links; the notification only gives a name, so matching is
  -- advisory rather than authoritative
  contact_id     uuid references contacts(id) on delete set null,
  unit_id        uuid references units(id) on delete set null,

  raw            text,
  created_at     timestamptz not null default now()
);

create index on court_filings (case_number);
create index on court_filings (defendant);
create index on court_filings (created_at desc);

-- ---------------------------------------------------------------- push

-- One row per installed device, not per person: everyone has a phone and a
-- desktop browser, and both should buzz. Endpoints expire, so a 404 or 410
-- from the push service means delete the row rather than retry it.
create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references staff(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

create index on push_subscriptions (staff_id);

-- ---------------------------------------------------------------- inquiries & nurture

-- Every person who ever asked about housing, with what they wanted and how it
-- ended. The outcome column is what keeps follow-ups away from people who
-- bought a house.
create table inquiries (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,

  -- the anchor date the whole follow-up schedule is computed from
  inquired_at   timestamptz not null default now(),
  source        text,                      -- 'web form', 'sign call', 'zillow', 'referral'

  -- Stated preferences only. Segment on these and nothing else -- never on
  -- anything inferred, and never on anything proxying for family status,
  -- national origin, or disability. "Wanted 3+ bedrooms" is a segment;
  -- "families with kids" is a fair-housing claim.
  bedrooms_min  smallint,
  price_ceiling numeric(10,2),
  area          text,
  has_pets      boolean,
  move_in_from  date,

  outcome       inquiry_outcome not null default 'open',
  outcome_note  text,
  outcome_at    timestamptz,

  created_at    timestamptz not null default now()
);

create index on inquiries (outcome, inquired_at);
create index on inquiries (contact_id, inquired_at desc);

-- One row per planned touch. Written when the inquiry closes, then evaluated
-- against suppressions at send time rather than at schedule time -- an
-- opt-out that arrives in month 9 has to stop a touch queued in month 2.
create table nurture_touches (
  id            uuid primary key default gen_random_uuid(),
  inquiry_id    uuid not null references inquiries(id) on delete cascade,
  channel       touch_channel not null,
  months_after  smallint not null,         -- 8 and 11 for a 12-month lease cycle
  scheduled_for date not null,
  state         touch_state not null default 'scheduled',

  -- why it did not go out; the interesting logic is all in here
  suppressed_reason text,

  sent_at       timestamptz,
  message_id    uuid references messages(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index on nurture_touches (state, scheduled_for);
create unique index on nurture_touches (inquiry_id, channel, months_after);

-- FCC Reassigned Numbers Database queries. Phone numbers get recycled, so the
-- number that consented in March may belong to a stranger by February -- and
-- your consent record then protects nothing. Querying the RND before sending
-- carries a safe harbor, but ONLY for the first contact after the check, and
-- only if you can prove the check happened. Hence this table.
create table reassigned_number_checks (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null,
  -- the date of consent submitted to the RND; it answers "has this number been
  -- permanently disconnected since then?"
  consent_date  date not null,
  is_reassigned boolean,                   -- null = "no data", which is NOT a safe harbor
  raw_response  jsonb,
  checked_at    timestamptz not null default now()
);

create index on reassigned_number_checks (phone, checked_at desc);

-- What is actually safe to send today. Every suppression rule lives here in
-- one place rather than scattered across application code, so "why didn't this
-- person get contacted" has exactly one answer to read.
--
-- Deliberately does NOT filter on prequalification outcome. Excluding people
-- your screening declined would build a marketing program that systematically
-- withholds housing availability from whichever groups those criteria correlate
-- with -- a discriminatory advertising claim separate from the screening
-- itself. Market broadly; let the documented ruleset screen on the way in.
create view nurture_due as
select t.id            as touch_id,
       t.channel,
       t.scheduled_for,
       i.id            as inquiry_id,
       c.id            as contact_id,
       c.phone,
       c.full_name,
       i.bedrooms_min,
       i.price_ceiling,
       i.area
from nurture_touches t
join inquiries i on i.id = t.inquiry_id
join contacts   c on c.id = i.contact_id
where t.state = 'scheduled'
  and t.scheduled_for <= current_date
  -- people who are out of the market for good
  and i.outcome not in ('bought_home','relocated_away','leased_with_us')
  -- marketing consent, on this channel, currently granted
  and exists (
        select 1 from consent_current cc
        where cc.contact_id = c.id
          and cc.purpose    = 'marketing'
          and cc.channel    = t.channel::text::consent_channel
          and cc.granted
      )
  -- SMS to a contact whose consent is stale needs a logged RND check that came
  -- back clean, and the safe harbor covers only the first send after it
  and (
        t.channel <> 'sms'
        or i.inquired_at > now() - interval '90 days'
        or exists (
             select 1 from reassigned_number_checks r
             where r.phone = c.phone
               and r.is_reassigned is false
               and r.checked_at > coalesce(t.sent_at, now() - interval '30 days')
           )
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
-- Screening decisions are the highest-stakes records in the system; audit both
-- the decisions and any change to the criteria that produced them.
create trigger audit_prequal        after insert or update or delete on prequal_submissions
  for each row execute function log_change();
create trigger audit_rule_sets      after insert or update or delete on prequal_rule_sets
  for each row execute function log_change();
create trigger audit_consent        after insert or update or delete on consent
  for each row execute function log_change();
create trigger audit_inquiries      after insert or update or delete on inquiries
  for each row execute function log_change();
create trigger audit_filings        after insert or update or delete on court_filings
  for each row execute function log_change();
create trigger audit_notes          after insert or update or delete on notes
  for each row execute function log_change();

-- Every missed call that has not been returned. The office view for
-- "who still needs calling back".
create view missed_calls_open as
select c.id as call_id, c.created_at, c.voicemail_text, c.recording_url,
       ct.phone, ct.full_name, c.conversation_id
from calls c
join contacts ct on ct.id = c.contact_id
where c.missed
  and not exists (select 1 from calls r where r.returns_call_id = c.id)
order by c.created_at desc;

-- ---------------------------------------------------------------- claiming

-- Two people tap "I've got this" at the same moment. The conditional UPDATE is
-- what makes that safe: only one transaction can match `assigned_to is null`,
-- and the loser is told who actually holds it rather than silently stealing it.
-- Doing this as a read-then-write in application code is the classic way to
-- end up with two employees replying to the same tenant.
create or replace function claim_conversation(p_conversation uuid)
returns table (ok boolean, holder_id uuid, holder_name text)
language plpgsql security definer as $$
declare
  winner uuid;
begin
  update conversations
     set assigned_to = auth.uid(), claimed_at = now()
   where id = p_conversation
     and assigned_to is null
  returning assigned_to into winner;

  if winner is not null then
    return query select true, winner, s.full_name from staff s where s.id = winner;
  else
    -- somebody already has it; say who
    return query
      select false, c.assigned_to, s.full_name
        from conversations c
        left join staff s on s.id = c.assigned_to
       where c.id = p_conversation;
  end if;
end $$;

-- Handing a thread back to the team pool, or to a specific person.
create or replace function release_conversation(p_conversation uuid)
returns void language sql security definer as $$
  update conversations set assigned_to = null, claimed_at = null
   where id = p_conversation;
$$;

create or replace function reassign_conversation(p_conversation uuid, p_to uuid)
returns void language sql security definer as $$
  update conversations set assigned_to = p_to, claimed_at = now()
   where id = p_conversation;
$$;

-- ---------------------------------------------------------------- row level security

alter table conversations enable row level security;
alter table messages      enable row level security;
alter table notes         enable row level security;
alter table work_orders   enable row level security;
alter table audit_log     enable row level security;

alter table teams        enable row level security;
alter table team_members enable row level security;

-- Admins and office staff see the whole inbox. That is the entire point of a
-- shared line: anyone can pick up where anyone else left off, claimed or not.
create policy office_reads_all on conversations for select
  using (exists (select 1 from staff s
                 where s.id = auth.uid() and s.role in ('admin','office') and s.active));

-- Everyone else sees their teams' conversations -- the whole team's threads,
-- not just the ones assigned to them. A tech on the maintenance team reads the
-- entire maintenance queue.
create policy team_reads_own on conversations for select
  using (exists (select 1 from team_members m
                 join staff s on s.id = m.staff_id and s.active
                 where m.staff_id = auth.uid()
                   and m.team_id = conversations.team_id));

-- ...plus anything attached to a work order they personally hold.
create policy tech_reads_assigned on conversations for select
  using (exists (select 1 from work_orders w
                 where w.conversation_id = conversations.id
                   and w.assigned_tech = auth.uid()));

create policy staff_read_teams on teams for select using (true);
create policy staff_read_members on team_members for select using (true);

-- Messages and notes inherit conversation visibility.
create policy read_messages_in_visible_conversations on messages for select
  using (exists (select 1 from conversations c where c.id = messages.conversation_id));
create policy read_notes_in_visible_conversations on notes for select
  using (exists (select 1 from conversations c where c.id = notes.conversation_id));

-- Only admins read the audit log, and nobody writes it from the client.
alter table court_filings enable row level security;

-- Admins only. No team-membership escape hatch: office staff handling a
-- maintenance request must not be able to see a household's eviction history.
create policy admin_reads_filings on court_filings for select
  using (exists (select 1 from staff s
                 where s.id = auth.uid() and s.role = 'admin' and s.active));

create policy admin_reads_audit on audit_log for select
  using (exists (select 1 from staff s
                 where s.id = auth.uid() and s.role = 'admin' and s.active));

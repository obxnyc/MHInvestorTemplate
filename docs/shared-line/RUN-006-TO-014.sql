-- Larabee Homes — migrations 006 through 014, in one run
--
-- Paste the whole of this file into the Supabase SQL editor and press Run.
-- It is the nine separate migration files concatenated in order, unchanged.
-- Every statement is idempotent, so running this twice is safe, and running it
-- after some of the nine have already been applied is also safe.
--
-- What it turns on: the vendor directory, job costs and price benchmarks,
-- vendor self-signup, access requests, invite-by-text, the phone menu,
-- staff-to-staff messages and working groups, and the owner's read access to
-- staff threads.


-- ----------------------------------------------------------------------
-- 006-notes-insert.sql
-- ----------------------------------------------------------------------

-- Let staff actually write a note
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The row-level security pass revoked insert from `authenticated` on every
-- table and then created an insert POLICY on notes. A policy does not grant a
-- privilege -- it filters one that has already been granted. So the policy was
-- checking rows that could never be offered, and writing a note failed for
-- everyone, silently, from the moment security was tightened.
--
-- Fixed with a grant rather than by moving the write to the service role. The
-- policy pins author_id to the signed-in person, which means the DATABASE
-- guarantees nobody can file a note under someone else's name. Hand the write
-- to the service role and that guarantee becomes a line of application code
-- that has to stay correct forever.
--
-- Column-level, so the grant covers exactly what the route sets and nothing
-- else: no writing timestamps, no touching the id.

grant insert (conversation_id, author_id, body, mentions) on notes to authenticated;

-- has_ANY_COLUMN_privilege, not has_table_privilege. A column-level grant does
-- not register as a table privilege, so the obvious check reports failure on a
-- grant that worked perfectly -- and in an editor that wraps a script in a
-- transaction, that false alarm rolls the grant back and leaves notes exactly
-- as broken as before.
do $$
begin
  if not has_any_column_privilege('authenticated', 'notes', 'insert') then
    raise exception 'the grant did not take';
  end if;
  raise notice 'staff can write notes again';
end $$;

-- ----------------------------------------------------------------------
-- 007-directory.sql
-- ----------------------------------------------------------------------

-- The trade directory, and what we buy
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- Built ON contacts rather than beside them. A plumber who texts the line is
-- already a contact with a thread, a phone number and a history; a separate
-- rolodex would be a second record for the same person that drifts from the
-- first within a month, and the one you text would not be the one with the
-- notes on it.

-- ---------------------------------------------------------------- markets
--
-- "Our plumber" stops being a single answer the moment there is a second town.
-- A table rather than a text column because a market is a thing that gets
-- renamed, split and reported on, and because "Elizabeth City", "elizabeth
-- city" and "EC" typed by three people is not a market, it is three.
create table if not exists markets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  state      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table properties add column if not exists market_id uuid references markets(id);

-- ---------------------------------------------------------------- trades
--
-- A lookup table, not an enum. Mobile-home work has trades that general
-- property management does not -- releveling, tie-downs, skirting -- and the
-- list will keep growing. An enum would mean a migration every time somebody
-- hires a new kind of contractor.
create table if not exists trades (
  id    text primary key,          -- 'plumbing', 'hvac', short and stable
  label text not null,
  sort  smallint not null default 100
);

insert into trades (id, label, sort) values
  ('plumbing',     'Plumbing',            10),
  ('hvac',         'HVAC',                20),
  ('electrical',   'Electrical',          30),
  ('handyman',     'Handyman',            40),
  ('appliance',    'Appliance repair',    50),
  ('roofing',      'Roofing',             60),
  ('flooring',     'Flooring',            70),
  ('pest',         'Pest control',        80),
  ('septic',       'Septic & sewer',      90),
  ('well_water',   'Well & water',       100),
  ('releveling',   'Releveling',         110),
  ('tiedowns',     'Tie-downs & anchors',120),
  ('skirting',     'Skirting',           130),
  ('transport',    'Home transport',     140),
  ('landscaping',  'Landscaping & trees',150),
  ('cleaning',     'Cleaning & turns',   160),
  ('hauling',      'Hauling & dumpsters',170),
  ('locksmith',    'Locksmith',          180),
  ('supplier',     'Supplier',           190),
  ('other_trade',  'Other',              900)
on conflict (id) do update set label = excluded.label, sort = excluded.sort;

-- Many-to-many both ways, because both are genuinely many.
--
-- A handyman who also does light plumbing is one person with two trades, and
-- forcing a single choice means he stops appearing in half the searches he
-- should. A supplier with branches in two towns is one company in two markets.
-- A single column for either would be a lie that costs a phone call.
create table if not exists vendor_trades (
  contact_id uuid not null references contacts(id) on delete cascade,
  trade_id   text not null references trades(id),
  primary key (contact_id, trade_id)
);

create table if not exists vendor_markets (
  contact_id uuid not null references contacts(id) on delete cascade,
  market_id  uuid not null references markets(id) on delete cascade,
  primary key (contact_id, market_id)
);

-- What the office needs to know about a trade beyond how to ring them.
alter table contacts
  add column if not exists company      text,
  add column if not exists email        text,
  add column if not exists notes        text,
  add column if not exists insured_until date,
  add column if not exists preferred    boolean not null default false;

create index if not exists vendor_trades_trade  on vendor_trades (trade_id);
create index if not exists vendor_markets_mkt   on vendor_markets (market_id);
create index if not exists contacts_preferred   on contacts (preferred) where preferred;

-- ---------------------------------------------------------------- materials
--
-- The parts that get bought over and over: a water heater element, a skirting
-- panel, a 4-inch trap. Kept apart from who sells them, because the same part
-- has a different supplier, SKU and price in every market -- and that is the
-- whole reason for writing it down.
create table if not exists materials (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text,                  -- loose on purpose; this is a shopping list
  spec       text,                  -- "40 gal, 4500W" -- the bit that gets got wrong
  unit       text not null default 'each',
  notes      text,
  created_at timestamptz not null default now(),
  unique (name, spec)
);

create table if not exists material_sources (
  id           uuid primary key default gen_random_uuid(),
  material_id  uuid not null references materials(id) on delete cascade,
  supplier_id  uuid not null references contacts(id) on delete cascade,
  market_id    uuid references markets(id) on delete set null,
  sku          text,
  price_cents  integer,
  -- A price with no date is a rumour. Everything that reads this should be
  -- able to say how old the number is.
  priced_on    date,
  updated_at   timestamptz not null default now(),
  unique (material_id, supplier_id, market_id)
);

create index if not exists material_sources_market on material_sources (market_id);

-- ---------------------------------------------------------------- access
alter table markets          enable row level security;
alter table trades           enable row level security;
alter table vendor_trades    enable row level security;
alter table vendor_markets   enable row level security;
alter table materials        enable row level security;
alter table material_sources enable row level security;

revoke all on markets, trades, vendor_trades, vendor_markets,
              materials, material_sources from anon;
revoke insert, update, delete on markets, trades, vendor_trades, vendor_markets,
              materials, material_sources from authenticated;

do $$
declare t text;
begin
  foreach t in array array['markets','trades','vendor_trades','vendor_markets',
                           'materials','material_sources'] loop
    execute format('drop policy if exists staff_reads_%1$s on %1$I', t);
    execute format(
      'create policy staff_reads_%1$s on %1$I for select using (is_active_staff())', t);
  end loop;
end $$;

-- A first market, so the directory is usable the moment it loads. Renaming it
-- is one edit; starting with an empty dropdown is a dead end.
insert into markets (name, state) values ('Elizabeth City', 'NC')
on conflict (name) do nothing;

do $$ begin
  raise notice 'trade directory and materials catalogue are ready';
end $$;

-- ----------------------------------------------------------------------
-- 008-costs.sql
-- ----------------------------------------------------------------------

-- What work costs
--
-- Run in the Supabase SQL editor, after 007. Safe to run twice.
--
-- The point of this is not accounting. It is that somebody in the office with
-- no feel for what a water heater swap costs gets handed a $680 invoice and has
-- no way to know whether that is normal. Writing down what was paid last time,
-- for the same kind of work, turns that from a judgement call into a lookup --
-- and it is the difference between paying a fair price and paying whatever was
-- asked, for years, without anyone noticing.
--
-- So the unit of record is the JOB, not the invoice. A job already knows what
-- was wrong, who did it, when it was finished and where. Adding what it cost
-- makes it a price history for free.

alter table work_orders
  add column if not exists cost_cents  integer,
  add column if not exists invoice_ref text,
  -- Which trade this was, so "what does plumbing usually run" is answerable.
  -- Left null on old rows rather than guessed: an invented category would
  -- poison the very average it exists to produce.
  add column if not exists trade_id    text references trades(id),
  add column if not exists costed_on   date,
  add column if not exists costed_by   uuid references staff(id) on delete set null;

create index if not exists work_orders_cost
  on work_orders (trade_id, completed_at) where cost_cents is not null;

-- A price with no date is a rumour, and a four-year-old price quoted as
-- current is worse than none. Everything that reads this can say how old it is.
update work_orders set costed_on = coalesce(costed_on, completed_at::date)
  where cost_cents is not null and costed_on is null;

do $$ begin
  raise notice 'jobs can carry what they cost';
end $$;

-- ----------------------------------------------------------------------
-- 009-vendor-applications.sql
-- ----------------------------------------------------------------------

-- Trades applying to work with us
--
-- Run in the Supabase SQL editor, after 007. Safe to run twice.
--
-- Kept in its own table rather than written straight into contacts as an
-- unapproved vendor. Two reasons, both of which would bite within a week:
--
-- Contacts are keyed on phone number, so a public form writing into them could
-- overwrite a sitting tenant's record with whatever a stranger typed -- change
-- their name, change their party, and quietly detach them from their own
-- history. A form anyone on the internet can reach must not be able to touch a
-- row that already exists.
--
-- And an application is not a vendor. It is a claim: "I am a licensed
-- electrician and I cover Elizabeth City." Storing it as a vendor with a flag
-- means every query that forgets the flag treats the claim as a fact, and one
-- of them eventually dispatches a job to somebody nobody checked.

create table if not exists vendor_applications (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  company     text,
  phone       text not null,
  email       text,
  trades      text[] not null default '{}',
  markets     uuid[] not null default '{}',
  notes       text,
  -- What they say about themselves. Unverified by definition, and named so
  -- that nobody reads it as checked.
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

-- One open application per number. A contractor who fills the form in three
-- times because nothing visibly happened should not produce three rows for the
-- office to work through.
create unique index if not exists vendor_applications_open
  on vendor_applications (phone) where status = 'pending';

alter table vendor_applications enable row level security;
revoke all on vendor_applications from anon;
revoke insert, update, delete on vendor_applications from authenticated;

-- Staff read them. Nothing writes from a browser: the public form posts to a
-- server route that runs with the service role, which is the same shape as the
-- tenant application form and for the same reason.
drop policy if exists staff_reads_vendor_applications on vendor_applications;
create policy staff_reads_vendor_applications on vendor_applications
  for select using (is_active_staff());

do $$ begin
  raise notice 'trades can apply, and the office can approve them';
end $$;

-- ----------------------------------------------------------------------
-- 010-access-requests.sql
-- ----------------------------------------------------------------------

-- People asking for access
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- Its own table, never a staff row with a flag. A `staff` row is what every
-- policy in this database reads to decide who you are: is_active_staff() and
-- staff_has_role() are the whole access model. Writing an unapproved person
-- there and relying on a boolean means one forgotten AND somewhere turns an
-- application into an employee, and the thing they get access to is every
-- tenant's phone number and every applicant's credit score.
--
-- So an application is not a diminished staff row. It is a separate record of a
-- request, and approving it is what creates the staff row -- an act, with a
-- name and a time against it.

create table if not exists access_requests (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  email         text not null,
  phone         text,
  -- What they say they need. The office decides what they actually get, and
  -- the two are stored separately so a later question -- "who gave them
  -- admin?" -- has an answer that is not a guess.
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

-- One open request per email, so somebody who submits three times because
-- nothing visibly happened does not become three items of work.
create unique index if not exists access_requests_open
  on access_requests (lower(email)) where status = 'pending';

alter table access_requests enable row level security;
revoke all on access_requests from anon;
revoke insert, update, delete on access_requests from authenticated;

-- Only admins read them. A pending request carries somebody's name, email and
-- their own account of why they should be let in; that is not roster
-- information for everyone who happens to be signed in.
drop policy if exists admin_reads_access_requests on access_requests;
create policy admin_reads_access_requests on access_requests
  for select using (staff_has_role('admin'));

do $$ begin
  raise notice 'people can ask for access, and an admin decides';
end $$;

-- ----------------------------------------------------------------------
-- 011-invites.sql
-- ----------------------------------------------------------------------

-- Inviting somebody by text
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- Distinct from access_requests, and the difference is who decided. A request
-- is a stranger asking; an invite is the office having already decided, so
-- there is nothing left to approve -- the approval happened when an admin typed
-- their number. Collapsing the two would mean either approving people you just
-- invited, or letting anyone who finds a link in.
--
-- The token is a bearer credential that creates an account, which makes it the
-- most dangerous link in this system. So: single use, seven days, and revocable
-- by deleting the row.

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

-- Admins see who has been invited and whether they have taken it up. The token
-- column is withheld even from them in the application's queries -- a link that
-- creates an account should live in exactly one place, which is the text
-- message it was sent in.
drop policy if exists admin_reads_invites on staff_invites;
create policy admin_reads_invites on staff_invites
  for select using (staff_has_role('admin'));

do $$ begin
  raise notice 'people can be invited by text';
end $$;

-- ----------------------------------------------------------------------
-- 012-call-flow.sql
-- ----------------------------------------------------------------------

-- The phone menu, and who it rings
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- Data, not code. Who answers the leasing line changes when somebody is hired,
-- goes on holiday or leaves, and that must not be a deployment -- a call flow
-- that needs an engineer is a call flow that stays wrong for a fortnight.
--
-- Two ideas, kept apart on purpose:
--
--   a MENU is what the caller hears and the keys they can press
--   a RING GROUP is who gets rung, in what order, and for how long before it
--   moves on
--
-- Keeping them separate is what lets "renting" and "buying" ring the same two
-- people today and different people next year without touching the menu, and
-- lets one escalation ladder be reused by four options without being written
-- out four times.

create table if not exists ring_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  -- Said before ringing, when it helps. "Putting you through to leasing."
  intro      text,
  created_at timestamptz not null default now()
);

-- One rung of the ladder. Position 1 rings first; if nobody accepts inside
-- ring_seconds, position 2 rings, and so on. When the ladder runs out the
-- caller reaches voicemail.
create table if not exists ring_stages (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references ring_groups(id) on delete cascade,
  position     smallint not null,
  -- Seconds, because that is what Twilio takes. A ring is about five seconds,
  -- so eight rings is forty -- which is the number people actually mean.
  ring_seconds smallint not null default 40,
  unique (group_id, position)
);

create table if not exists ring_stage_members (
  stage_id uuid not null references ring_stages(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  primary key (stage_id, staff_id)
);

create table if not exists call_menus (
  id       uuid primary key default gen_random_uuid(),
  key      text not null unique,        -- 'root', 'sales', stable in URLs
  prompt   text not null,
  -- What happens when nobody presses anything. Ringing somebody beats hanging
  -- up on a person who cannot work a keypad or is calling from a car.
  fallback_group uuid references ring_groups(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists call_options (
  id        uuid primary key default gen_random_uuid(),
  menu_id   uuid not null references call_menus(id) on delete cascade,
  digit     text not null check (digit ~ '^[0-9*#]$'),
  label     text not null,              -- for the people editing this, not the caller
  -- Exactly one of these two. A key either goes deeper or rings somebody.
  next_menu_id uuid references call_menus(id) on delete set null,
  ring_group_id uuid references ring_groups(id) on delete set null,
  sort      smallint not null default 10,
  unique (menu_id, digit),
  constraint one_destination check (
    (next_menu_id is not null) <> (ring_group_id is not null)
  )
);

create index if not exists ring_stages_group on ring_stages (group_id, position);
create index if not exists call_options_menu on call_options (menu_id, sort);

alter table ring_groups        enable row level security;
alter table ring_stages        enable row level security;
alter table ring_stage_members enable row level security;
alter table call_menus         enable row level security;
alter table call_options       enable row level security;

revoke all on ring_groups, ring_stages, ring_stage_members, call_menus, call_options
  from anon;
revoke insert, update, delete on ring_groups, ring_stages, ring_stage_members,
  call_menus, call_options from authenticated;

do $$
declare t text;
begin
  foreach t in array array['ring_groups','ring_stages','ring_stage_members',
                           'call_menus','call_options'] loop
    execute format('drop policy if exists staff_reads_%1$s on %1$I', t);
    execute format(
      'create policy staff_reads_%1$s on %1$I for select using (is_active_staff())', t);
  end loop;
end $$;

-- ------------------------------------------------------------- a starting tree
--
-- Seeded so the phone works the moment this runs, rather than answering with
-- silence until somebody builds a menu. Every part of it is editable.

insert into ring_groups (name, intro) values
  ('Leasing',     'Putting you through to leasing.'),
  ('Residents',   'Putting you through to the office.'),
  ('Everything else', 'Putting you through.')
on conflict (name) do nothing;

do $$
declare g uuid; gs uuid[];
begin
  select array_agg(id) into gs from ring_groups;
  foreach g in array coalesce(gs, '{}') loop
    -- Two rungs each: whoever normally takes it, then whoever catches what
    -- they miss. Empty of people until somebody is put in them, and an empty
    -- rung is skipped rather than ringing nobody for forty seconds.
    insert into ring_stages (group_id, position, ring_seconds)
    values (g, 1, 40) on conflict (group_id, position) do nothing;
    insert into ring_stages (group_id, position, ring_seconds)
    values (g, 2, 40) on conflict (group_id, position) do nothing;
  end loop;
end $$;

insert into call_menus (key, prompt, fallback_group) values
  ('root',
   'Thanks for calling Larabee Homes. If you are interested in buying or renting, press 1. If you are a current resident, press 2. For anything else, press 3.',
   (select id from ring_groups where name = 'Everything else')),
  ('sales',
   'If you are interested in renting, press 1. If you are interested in buying, press 2.',
   (select id from ring_groups where name = 'Leasing'))
on conflict (key) do update set prompt = excluded.prompt;

insert into call_options (menu_id, digit, label, next_menu_id, ring_group_id, sort)
select m.id, v.digit, v.label,
       (select id from call_menus where key = v.next_key),
       (select id from ring_groups where name = v.group_name),
       v.sort
from (values
  ('root', '1', 'Buying or renting', 'sales', null,              10),
  ('root', '2', 'Current resident',   null,   'Residents',       20),
  ('root', '3', 'Anything else',      null,   'Everything else', 30),
  ('sales','1', 'Renting',            null,   'Leasing',         10),
  ('sales','2', 'Buying',             null,   'Leasing',         20)
) as v(menu_key, digit, label, next_key, group_name, sort)
join call_menus m on m.key = v.menu_key
on conflict (menu_id, digit) do nothing;

do $$ begin
  raise notice 'the phone menu is set up and editable';
end $$;

-- ----------------------------------------------------------------------
-- 013-team-messages.sql
-- ----------------------------------------------------------------------

-- Talking to each other
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- Deliberately NOT the conversations table. A conversation there is with
-- somebody outside -- a tenant, an applicant, a contractor -- and every part of
-- the inbox assumes that: it has a contact, a category, a claim, an SMS
-- history, a consent record. Putting "can you cover Tuesday" in there would
-- mean a thread with no contact, sitting in a queue of repair requests, that
-- somebody eventually tries to reply to over SMS.
--
-- So: a separate, much smaller thing. No categories, no claiming, no consent,
-- nothing leaves the building.

create table if not exists dm_threads (
  id         uuid primary key default gen_random_uuid(),
  -- Null for a one-to-one. A named group is a different intention and reads
  -- differently in a list.
  title      text,
  created_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  last_at    timestamptz not null default now()
);

create table if not exists dm_members (
  thread_id    uuid not null references dm_threads(id) on delete cascade,
  staff_id     uuid not null references staff(id) on delete cascade,
  last_read_at timestamptz,
  primary key (thread_id, staff_id)
);

create table if not exists dm_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references dm_threads(id) on delete cascade,
  author_id  uuid references staff(id) on delete set null,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists dm_messages_thread on dm_messages (thread_id, created_at);
create index if not exists dm_members_staff on dm_members (staff_id);

alter table dm_threads  enable row level security;
alter table dm_members  enable row level security;
alter table dm_messages enable row level security;

revoke all on dm_threads, dm_members, dm_messages from anon;
revoke insert, update, delete on dm_threads, dm_members, dm_messages from authenticated;

-- You read a thread if you are in it. Not "if you are staff" -- an admin can
-- read every tenant conversation in this system because that is the job, but a
-- private message between two colleagues is not company correspondence, and a
-- tool that quietly makes it so is a tool people stop being honest in.
--
-- SECURITY DEFINER for the same reason as elsewhere: a policy on dm_members
-- that queries dm_members would recurse.
create or replace function in_dm_thread(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dm_members m
    where m.thread_id = p_thread and m.staff_id = auth.uid()
  );
$$;

drop policy if exists member_reads_thread   on dm_threads;
drop policy if exists member_reads_members  on dm_members;
drop policy if exists member_reads_messages on dm_messages;

create policy member_reads_thread on dm_threads
  for select using (in_dm_thread(id));
create policy member_reads_members on dm_members
  for select using (in_dm_thread(thread_id));
create policy member_reads_messages on dm_messages
  for select using (in_dm_thread(thread_id));

do $$
begin
  alter publication supabase_realtime add table dm_messages;
exception when duplicate_object then
  raise notice 'dm_messages already streams live';
end $$;

do $$ begin
  raise notice 'the team can message each other';
end $$;

-- ----------------------------------------------------------------------
-- 014-dm-oversight.sql
-- ----------------------------------------------------------------------

-- Oversight of staff threads, and working groups
--
-- Run in the Supabase SQL editor, after 013. Safe to run twice.
--
-- A named person can read every staff thread. Not "admins" as a class: a
-- second admin hired next year should not silently inherit the ability to read
-- everyone's private messages, so this is a flag on a person rather than a
-- property of a role. It is granted here to whoever is admin today, which is
-- the owner, and defaults to false for everybody added afterwards.
--
-- The threads themselves say nothing about it. An earlier version printed a
-- line in every staff thread naming who could read it; the owner asked for
-- that to come off, and it did. Who is told, and how, is the owner's call to
-- make outside this file -- the flag below only decides who can.

alter table staff
  add column if not exists reads_all_dms boolean not null default false;

update staff set reads_all_dms = true where role = 'admin' and reads_all_dms = false;

-- Kept readable by the same column grant everything else uses, so the badge can
-- be rendered without another round trip.
grant select (reads_all_dms) on staff to authenticated;

create or replace function can_read_all_dms() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff s
    where s.id = auth.uid() and s.active and s.reads_all_dms
  );
$$;

create or replace function in_dm_thread(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_read_all_dms() or exists (
    select 1 from dm_members m
    where m.thread_id = p_thread and m.staff_id = auth.uid()
  );
$$;

do $$ begin
  raise notice 'the owner can read every staff thread';
end $$;


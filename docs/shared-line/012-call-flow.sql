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

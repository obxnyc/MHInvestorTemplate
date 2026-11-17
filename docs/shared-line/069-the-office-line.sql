-- 069: the office line.
--
-- The phone tree the owner laid out on 12-17 November 2026. What changes:
--
--   * Who rings is a list of PHONES, not of app users. Hannah, Natashia and
--     William answer the line and have no sign-in; `staff.id` is tied to
--     auth.users, so a ring list built only from staff could never hold them.
--     `phone_people.staff_id` links a phone to an app user where there is one,
--     which is what makes push notifications and "answered by" work for them.
--
--   * A menu choice ends at a ROUTE: what the call is filed as, what the
--     person answering hears, and what happens in office hours and after.
--     The same press of 2-1-2 rings the office at noon and texts the resident
--     portal at midnight, and that is one row, not two trees.
--
--   * Office hours, greetings and the texts the line sends are one settings
--     row, so a change of wording is an update and not a deployment.
--
--   * A call keeps every recording it made (a transfer makes a second) and the
--     transcript and summary of each.
--
-- Safe to re-run. The menus are rebuilt each run from the values below; the
-- people and who rings in which order are DATA, entered once through the
-- connector, and nothing here touches them.

-- ------------------------------------------------------------ who rings

create table if not exists phone_people (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  phone      text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  staff_id   uuid references staff(id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists ring_stage_people (
  stage_id  uuid not null references ring_stages(id) on delete cascade,
  person_id uuid not null references phone_people(id) on delete cascade,
  primary key (stage_id, person_id)
);

-- ------------------------------------------------------------ where a choice ends

create table if not exists call_routes (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,
  category     text not null,
  whisper      text not null,
  day_action   text not null check (day_action in ('ring','portal','voicemail','leasing_voicemail')),
  day_group    uuid references ring_groups(id) on delete set null,
  night_action text not null check (night_action in ('ring','portal','voicemail','leasing_voicemail')),
  night_group  uuid references ring_groups(id) on delete set null,
  sort         smallint not null default 10
);

alter table call_options add column if not exists route_id uuid
  references call_routes(id) on delete set null;
alter table call_options drop constraint if exists one_destination;
alter table call_options add constraint one_destination
  check (num_nonnulls(next_menu_id, ring_group_id, route_id) = 1);

alter table call_menus add column if not exists fallback_route uuid
  references call_routes(id) on delete set null;

-- ------------------------------------------------------------ hours and wording

create table if not exists call_settings (
  id              boolean primary key default true check (id),
  tz              text not null default 'America/New_York',
  open_at         time not null default '08:00',
  close_at        time not null default '18:00',
  -- ISO weekdays, Monday = 1. Saturday and Sunday are after hours all day.
  open_days       smallint[] not null default '{1,2,3,4,5}',
  -- The owner's own words, both halves of the day. No recording notice:
  -- North Carolina needs only one party's consent, and we are a party.
  day_greeting    text not null default
    'Thank you for calling Larabee Homes. Our office is open from 8 a.m. to 6 p.m. Emergency maintenance is available at any hour.',
  night_greeting  text not null default
    'Thank you for calling Larabee Homes. Our office is open from 8 a.m. to 6 p.m. Emergency maintenance is available at any hour.',
  voicemail_prompt text not null default
    'We''re sorry we missed your call. Please leave your name, number, and the reason for your call. A member of our team will return your call as soon as possible.',
  voicemail_prompt_es text not null default
    'Lamentamos no haber podido atender su llamada. Por favor deje su nombre, su número y el motivo de su llamada. Un miembro de nuestro equipo le devolverá la llamada lo antes posible.',
  leasing_prompt  text not null default
    'Thank you for your interest. Please leave your name, number, and the home you are calling about, and a member of our team will call you back as soon as possible.',
  leasing_prompt_es text not null default
    'Gracias por su interés. Por favor deje su nombre, su número y la casa por la que llama, y un miembro de nuestro equipo le devolverá la llamada lo antes posible.',
  portal_prompt   text not null default
    'Non-emergency repairs are handled through our online resident portal, where you can submit a request and follow its progress. We are sending you a text message with the link now. Thank you.',
  portal_prompt_es text not null default
    'Las reparaciones que no son de emergencia se manejan a través de nuestro portal en línea para residentes, donde puede enviar una solicitud y seguir su progreso. Le estamos enviando un mensaje de texto con el enlace ahora. Gracias.',
  portal_url      text,
  portal_text     text not null default
    'Larabee Homes: submit your maintenance request here and follow its progress: {link}',
  portal_text_es  text not null default
    'Larabee Homes: envíe su solicitud de mantenimiento aquí y siga su progreso: {link}',
  homes_url       text,
  homes_text      text not null default
    'Larabee Homes: thanks for calling. Here are the homes we have available right now: {link} We''ll call you first thing in the morning.',
  missed_text_on  boolean not null default true,
  missed_text     text not null default
    'This is Larabee Homes. Sorry we missed your call. Reply to this message or call us back at this number and we''ll help you as soon as possible.',
  missed_text_es  text not null default
    'Le habla Larabee Homes. Lamentamos no haber podido atender su llamada. Responda a este mensaje o llámenos a este número y le ayudaremos lo antes posible.',
  -- Who is told about every call outside office hours.
  after_hours_notify uuid references staff(id) on delete set null,
  -- Twilio Voice Intelligence service, found or made on first use.
  intel_service_sid text,
  intel_service_sid_es text,
  updated_at      timestamptz not null default now()
);
insert into call_settings (id) values (true) on conflict (id) do nothing;

-- ------------------------------------------------------------ the call record

alter table calls add column if not exists category        text;
alter table calls add column if not exists route_key       text;
alter table calls add column if not exists after_hours     boolean;
alter table calls add column if not exists answered_person uuid
  references phone_people(id) on delete set null;
alter table calls add column if not exists answered_at     timestamptz;
alter table calls add column if not exists ended_at        timestamptz;
alter table calls add column if not exists notes           text;
alter table calls add column if not exists summary         text;
alter table calls add column if not exists follow_up       text;
alter table calls add column if not exists suggested_category text;
alter table calls add column if not exists texted          text;   -- 'portal' | 'homes' | 'missed'
alter table calls add column if not exists missed_texted_at timestamptz;
alter table calls add column if not exists language        text;   -- 'es' once 8 is pressed

-- Spanish. A menu says its prompt in its own language's voice, and an option
-- can announce itself in another: "Para español, oprima 8" is said in Spanish
-- at the end of the English menu.
alter table call_menus   add column if not exists lang text not null default 'en';
alter table call_options add column if not exists announce text;
alter table call_options add column if not exists announce_lang text;

-- Whoever rang first KEEPS ringing when the next person is added. Hannah's
-- phone does not stop at twelve seconds; Samantha's starts beside it.
alter table ring_groups add column if not exists keep_ringing boolean not null default true;

create index if not exists calls_live on calls (answered_at) where ended_at is null;
create index if not exists calls_contact_day on calls (contact_id, created_at);

create table if not exists call_recordings (
  id                uuid primary key default gen_random_uuid(),
  call_id           uuid not null references calls(id) on delete cascade,
  recording_sid     text not null unique,
  kind              text not null check (kind in ('call','voicemail')),
  duration_seconds  integer,
  transcript_sid    text unique,
  transcript_status text,
  transcript        jsonb,     -- [{who: 'caller'|'us', at: seconds, text}]
  created_at        timestamptz not null default now()
);
create index if not exists call_recordings_call on call_recordings (call_id, created_at);

-- ------------------------------------------------------------ who may read it

alter table phone_people      enable row level security;
alter table ring_stage_people enable row level security;
alter table call_routes       enable row level security;
alter table call_settings     enable row level security;
alter table call_recordings   enable row level security;

revoke all on phone_people, ring_stage_people, call_routes, call_settings,
  call_recordings from anon;
revoke insert, update, delete on phone_people, ring_stage_people, call_routes,
  call_settings, call_recordings from authenticated;

do $$
declare t text;
begin
  foreach t in array array['phone_people','ring_stage_people','call_routes',
                           'call_settings','call_recordings'] loop
    execute format('drop policy if exists staff_reads_%1$s on %1$I', t);
    execute format(
      'create policy staff_reads_%1$s on %1$I for select using (is_active_staff())', t);
  end loop;
end $$;

-- ------------------------------------------------------------ the groups

insert into ring_groups (name, intro) values
  ('Office',            null),
  ('Sellers',           null),
  ('Emergency on call', null)
on conflict (name) do nothing;

-- Twelve seconds a rung, about two rings. The emergency line rings longer:
-- it is the middle of the night and the phone is on a bedside table.
do $$
declare g record;
begin
  for g in select id, name from ring_groups
           where name in ('Office','Sellers','Emergency on call') loop
    insert into ring_stages (group_id, position, ring_seconds)
    select g.id, p, case when g.name = 'Emergency on call' then 20 else 12 end
    from generate_series(1, case g.name when 'Office' then 3 else 2 end) p
    on conflict (group_id, position) do update set ring_seconds = excluded.ring_seconds;
  end loop;
end $$;

-- ------------------------------------------------------------ the routes

insert into call_routes (key, category, whisper, day_action, day_group, night_action, night_group, sort)
select v.key, v.category, v.whisper,
       v.day_action,   (select id from ring_groups where name = v.day_group),
       v.night_action, (select id from ring_groups where name = v.night_group),
       v.sort
from (values
  ('rent',        'Leasing · Rent',    'Rental call',            'ring',   'Office',  'leasing_voicemail', null,                10),
  ('buy',         'Sales',             'Buyer call',             'ring',   'Office',  'leasing_voicemail', null,                20),
  ('emergency',   'Emergency',         'Emergency maintenance',  'ring',   'Office',  'ring',              'Emergency on call', 30),
  ('maintenance', 'Maintenance',       'Maintenance call',       'portal', null,      'portal',            null,                40),
  ('payments',    'Payments',          'Rent call',              'ring',   'Office',  'voicemail',         null,                50),
  ('resident',    'Resident · Other',  'Resident call',          'ring',   'Office',  'voicemail',         null,                60),
  ('vendor',      'Vendor',            'Vendor call',            'ring',   'Office',  'voicemail',         null,                70),
  ('seller',      'Seller',            'Seller call',            'ring',   'Sellers', 'voicemail',         null,                80),
  ('general',     'General',           'Office call',            'ring',   'Office',  'voicemail',         null,                90)
) as v(key, category, whisper, day_action, day_group, night_action, night_group, sort)
on conflict (key) do update set
  category = excluded.category, whisper = excluded.whisper,
  day_action = excluded.day_action, day_group = excluded.day_group,
  night_action = excluded.night_action, night_group = excluded.night_group,
  sort = excluded.sort;

-- ------------------------------------------------------------ the menus

insert into call_menus (key, lang, prompt) values
  ('root', 'en',
   'If you are interested in renting or purchasing a home, press 1. If you are a current resident, press 2. If you would like an offer on your home or property, press 3. If you are a vendor or contractor, press 4. For all other calls, press 0.'),
  ('sales', 'en',
   'To rent a home, press 1. To purchase a home, press 2.'),
  ('residents', 'en',
   'For maintenance, press 1. For rent and payments, press 2. For all other questions, press 3.'),
  ('maintenance', 'en',
   'If this is a maintenance emergency, press 1. For all other maintenance requests, press 2.'),
  ('es-root', 'es',
   'Si le interesa rentar o comprar una casa, oprima 1. Si es residente actual, oprima 2. Si desea una oferta por su casa o propiedad, oprima 3. Si es proveedor o contratista, oprima 4. Para todas las demás llamadas, oprima 0.'),
  ('es-sales', 'es',
   'Para rentar una casa, oprima 1. Para comprar una casa, oprima 2.'),
  ('es-residents', 'es',
   'Para mantenimiento, oprima 1. Para la renta y los pagos, oprima 2. Para todas las demás preguntas, oprima 3.'),
  ('es-maintenance', 'es',
   'Si es una emergencia de mantenimiento, oprima 1. Para todas las demás solicitudes de mantenimiento, oprima 2.')
on conflict (key) do update set prompt = excluded.prompt, lang = excluded.lang;

-- Nothing pressed twice: the call goes to a person, never to a dial tone.
update call_menus set
  fallback_route = (select id from call_routes where key = 'general'),
  fallback_group = null
where key in ('root','sales','residents','es-root','es-sales','es-residents');
update call_menus set
  fallback_route = (select id from call_routes where key = 'emergency'),
  fallback_group = null
where key in ('maintenance','es-maintenance');

-- The options are rebuilt from scratch: they are the shape of the tree, and
-- a stale digit left over from the old one would send somebody somewhere
-- nobody chose.
delete from call_options
where menu_id in (select id from call_menus where key in
  ('root','sales','residents','maintenance','es-root','es-sales','es-residents','es-maintenance'));

insert into call_options (menu_id, digit, label, next_menu_id, route_id, announce, announce_lang, sort)
select m.id, v.digit, v.label,
       (select id from call_menus where key = v.next_menu),
       (select id from call_routes where key = v.route),
       v.announce, v.announce_lang, v.sort
from (values
  ('root',           '1', 'Renting or buying',    'sales',          null,          null, null, 10),
  ('root',           '2', 'Current resident',     'residents',      null,          null, null, 20),
  ('root',           '3', 'Offer on a property',  null,             'seller',      null, null, 30),
  ('root',           '4', 'Vendor or contractor', null,             'vendor',      null, null, 40),
  ('root',           '0', 'All other calls',      null,             'general',     null, null, 50),
  ('root',           '8', 'Spanish',              'es-root',        null,
     'Para español, oprima 8.', 'es', 60),
  ('sales',          '1', 'Renting',              null,             'rent',        null, null, 10),
  ('sales',          '2', 'Buying',               null,             'buy',         null, null, 20),
  ('residents',      '1', 'Maintenance',          'maintenance',    null,          null, null, 10),
  ('residents',      '2', 'Rent and payments',    null,             'payments',    null, null, 20),
  ('residents',      '3', 'Other questions',      null,             'resident',    null, null, 30),
  ('maintenance',    '1', 'Emergency',            null,             'emergency',   null, null, 10),
  ('maintenance',    '2', 'Not urgent',           null,             'maintenance', null, null, 20),
  ('es-root',        '1', 'Renting or buying',    'es-sales',       null,          null, null, 10),
  ('es-root',        '2', 'Current resident',     'es-residents',   null,          null, null, 20),
  ('es-root',        '3', 'Offer on a property',  null,             'seller',      null, null, 30),
  ('es-root',        '4', 'Vendor or contractor', null,             'vendor',      null, null, 40),
  ('es-root',        '0', 'All other calls',      null,             'general',     null, null, 50),
  ('es-sales',       '1', 'Renting',              null,             'rent',        null, null, 10),
  ('es-sales',       '2', 'Buying',               null,             'buy',         null, null, 20),
  ('es-residents',   '1', 'Maintenance',          'es-maintenance', null,          null, null, 10),
  ('es-residents',   '2', 'Rent and payments',    null,             'payments',    null, null, 20),
  ('es-residents',   '3', 'Other questions',      null,             'resident',    null, null, 30),
  ('es-maintenance', '1', 'Emergency',            null,             'emergency',   null, null, 10),
  ('es-maintenance', '2', 'Not urgent',           null,             'maintenance', null, null, 20)
) as v(menu_key, digit, label, next_menu, route, announce, announce_lang, sort)
join call_menus m on m.key = v.menu_key;

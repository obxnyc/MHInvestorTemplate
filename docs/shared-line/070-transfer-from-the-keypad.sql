-- 070: transfer from the keypad.
--
-- Press * on a call and the caller goes on hold; then 1 for Hannah, 2 for
-- Natashia, 3 for Samantha, 4 for Cade, 5 for the office line, 0 to go back.
--
-- That needed calls to be connected differently. A phone bridged straight to
-- the caller cannot be heard by the app once the call is up -- Twilio listens
-- to neither side -- so a keypress goes nowhere. Now the office's phones are
-- rung as calls of their own and, once somebody presses 1, caller and answerer
-- meet in a conference named for the call. The answerer's side is a <Dial>
-- with hangupOnStar, which is the one key Twilio lets the answering phone use
-- to step out of a call and be asked something.
--
-- Safe to re-run.

-- Each phone rung for a call: so the ones still ringing can be stopped the
-- moment somebody takes it, and so a transfer's ringing is told apart from
-- the first.
create table if not exists call_legs (
  id         uuid primary key default gen_random_uuid(),
  call_id    uuid not null references calls(id) on delete cascade,
  round      integer not null,
  person_id  uuid references phone_people(id) on delete set null,
  leg_sid    text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists call_legs_call on call_legs (call_id, round);

-- `round` goes up each time the call starts ringing somebody new (the first
-- ring is 1, each transfer adds one). `claimed_round` is the round somebody
-- pressed 1 in. Only one press of 1 can win a round: the claim is a single
-- conditional update, so two phones answering at once cannot both connect.
alter table calls add column if not exists round          integer not null default 0;
alter table calls add column if not exists claimed_round  integer;
alter table calls add column if not exists agent_leg_sid  text;
alter table calls add column if not exists line           text;   -- the office number that was called
alter table calls add column if not exists recording_on   boolean not null default false;

-- What each key does after *. Data, so a new hire is a row, not a release.
create table if not exists transfer_keys (
  digit      text primary key check (digit ~ '^[1-9]$'),
  person_id  uuid references phone_people(id) on delete cascade,
  route_key  text references call_routes(key) on delete cascade,
  label      text not null,
  constraint one_target check (num_nonnulls(person_id, route_key) = 1)
);
alter table transfer_keys enable row level security;
revoke all on call_legs, transfer_keys from anon;
revoke insert, update, delete on call_legs, transfer_keys from authenticated;
alter table call_legs enable row level security;
drop policy if exists staff_reads_call_legs on call_legs;
create policy staff_reads_call_legs on call_legs for select using (is_active_staff());
drop policy if exists staff_reads_transfer_keys on transfer_keys;
create policy staff_reads_transfer_keys on transfer_keys for select using (is_active_staff());

-- 5 is the office line: the same ringing as a caller who pressed 0.
insert into transfer_keys (digit, route_key, label) values ('5', 'general', 'the office line')
on conflict (digit) do update set route_key = excluded.route_key, person_id = null, label = excluded.label;
-- 1 to 4 are people, and people are data: entered with the phone list, not here.

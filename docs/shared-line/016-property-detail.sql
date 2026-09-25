-- What a property actually is, and what sits on each lot
--
-- Run in the Supabase SQL editor, after 015. Safe to run twice.
--
-- The model that was here -- a property with units under it -- is right, and
-- this fills it in rather than replacing it. A single house is a property with
-- one unit. A park is a property with a hundred, and we own the dirt under all
-- of them.
--
-- The distinction that actually matters in a park is on the UNIT, not the
-- property: we own every lot, but the HOME standing on a lot may be ours or
-- the resident's. That one field decides who fixes the roof, what is being
-- charged for -- lot rent or lot plus home -- and what happens when they
-- leave. Getting it wrong is an argument with a resident about whose water
-- heater it is, so it is recorded per lot and never inferred.

do $$ begin
  create type property_kind as enum
    ('sfh','mh','duplex','triplex','multi','mhp','lot');
exception when duplicate_object then null; end $$;

-- Who owns the home standing on a lot. 'none' is a bare lot with nothing on
-- it, which is a real thing to own and different from a vacant home.
do $$ begin
  create type home_owner as enum ('ours','theirs','none');
exception when duplicate_object then null; end $$;

alter table properties
  add column if not exists kind      property_kind not null default 'sfh',
  -- Where it is, confirmed against an aerial by whoever added it. Stored as
  -- numbers rather than a string, because the point of confirming it is that
  -- a tech can be sent to it.
  add column if not exists lat       numeric(9,6),
  add column if not exists lng       numeric(9,6),
  -- The provider's own id for the place, so re-checking it later asks about
  -- the same place rather than re-searching a string somebody has since edited.
  add column if not exists place_id  text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references staff(id) on delete set null;

alter table units
  add column if not exists bathrooms    numeric(3,1),
  add column if not exists square_feet  integer,
  -- A lot in a park has its own position. This is what lets a map show which
  -- lot is which rather than one pin on the whole park.
  add column if not exists lat          numeric(9,6),
  add column if not exists lng          numeric(9,6),
  add column if not exists home_owner   home_owner not null default 'ours',
  -- Identifying the actual home. The serial is the one that matters: it is
  -- what a title, an insurance policy and a transport permit are all keyed on,
  -- and it is the thing nobody can find when it is needed.
  add column if not exists home_year    smallint,
  add column if not exists home_make    text,
  add column if not exists home_serial  text;

create index if not exists units_home_owner on units (home_owner);
create index if not exists properties_kind on properties (kind);

-- Everything that was here before this ran is a single home unless somebody
-- says otherwise, which is what the default already says. Parks get set by
-- hand: there is no way to tell from a name, and guessing would put lot rent
-- against houses.
do $$ begin
  raise notice 'properties have a type and a place; lots know whose home is on them';
end $$;

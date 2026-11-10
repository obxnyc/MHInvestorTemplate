-- 052: which homes are for rent, and which are coming.
--
-- `is_vacant` is Rent Manager's word, and Rent Manager calls a lot vacant
-- when there is no lease on it -- including every pad in a park bought last
-- month with no home on it yet. That is the right answer to "is anybody
-- paying lot rent here" and the wrong answer to "what can we show somebody
-- this week". So the morning report's vacancy list cannot be built on it.
--
-- `listing` is the office's word, set by a person on the Properties page:
--
--   for_rent  a home that is ready, advertised, and can be shown today.
--   upcoming  a home being made ready. `ready_on` is the best guess at when,
--             and `blocker` (from 037) says what it is waiting on.
--   null      neither -- let, a bare lot, or simply not ours to rent.
--
-- The Rent Manager import never writes these, so nothing it does can put a
-- bare pad on the list or take a real home off it.
--
-- `listed_at` is when it last became for_rent, kept by a trigger so "listed
-- 40 days" is measured rather than remembered. Null means nobody measured --
-- a home that was on the market before this column existed -- and the report
-- says nothing rather than inventing a day count.

alter table units
  add column if not exists listing text
    check (listing in ('for_rent', 'upcoming')),
  add column if not exists ready_on date,
  add column if not exists listed_at timestamptz;

comment on column units.listing is
  'for_rent | upcoming | null. Set by the office; never by an import.';
comment on column units.ready_on is
  'For an upcoming home: the best guess at when it will be ready to show.';

create or replace function units_listing_clock() returns trigger
language plpgsql as $$
begin
  if new.listing = 'for_rent' and old.listing is distinct from 'for_rent' then
    new.listed_at := now();
  elsif new.listing is distinct from 'for_rent' then
    new.listed_at := null;
  end if;
  -- A date on a home that is not coming is yesterday's estimate.
  if new.listing is distinct from 'upcoming' then
    new.ready_on := null;
  end if;
  return new;
end $$;

drop trigger if exists units_listing_clock on units;
create trigger units_listing_clock before update of listing, ready_on on units
  for each row execute function units_listing_clock();

create index if not exists units_listing_idx on units (listing) where listing is not null;

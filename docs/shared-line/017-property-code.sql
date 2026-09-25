-- A code for every property, and who owns it
--
-- Run in the Supabase SQL editor, after 016. Safe to run twice.
--
-- SFH-001, MHP-002. Short enough to say on the phone, stable enough to write
-- on an invoice, and unique -- which is the point. Two properties called
-- "118 Rosebud" is a thing that happens; two coded SFH-004 is a thing that
-- must not, because the code is what a work order, a lease and a bank line
-- will all be filed under.
--
-- The uniqueness lives here rather than in the application. Two people adding
-- a property in the same second would both count the existing ones, both get
-- 004, and both be perfectly satisfied. Only the database can settle that.

alter table properties
  add column if not exists code text;

-- Backfilled for anything already entered, in creation order, so existing
-- properties get the numbers they would have had.
do $$
declare
  r record;
  prefix text;
  n integer;
begin
  for r in
    select id, kind, created_at from properties where code is null order by created_at
  loop
    prefix := case r.kind
      when 'sfh' then 'SFH' when 'mh' then 'MH'  when 'duplex' then 'DUP'
      when 'triplex' then 'TRI' when 'multi' then 'MF'
      when 'mhp' then 'MHP' when 'lot' then 'LOT' else 'SFH' end;

    select coalesce(max(substring(code from '[0-9]+$')::int), 0) + 1
      into n from properties where code like prefix || '-%';

    update properties set code = prefix || '-' || lpad(n::text, 3, '0')
     where id = r.id;
  end loop;
end $$;

create unique index if not exists properties_code_key on properties (code);

-- ---------------------------------------------------------------- owners
--
-- Homes are held in different LLCs, and which one owns a place decides who
-- gets the rent, who signs the lease, whose insurance covers the roof and
-- which set of books it lands in. A text field on the property would spell it
-- four ways within a month and make "everything in Larabee Holdings II" a
-- question nobody can answer, so it is a table.
--
-- Separate from `markets`: an LLC is who owns it, a market is where it is, and
-- the same LLC routinely holds property in two towns.
create table if not exists owners (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  -- What goes on a lease or a cheque, when that differs from what everybody
  -- calls it in the office.
  legal_name text,
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table properties
  add column if not exists owner_id uuid references owners(id) on delete set null;

create index if not exists properties_owner on properties (owner_id);

alter table owners enable row level security;
revoke all on owners from anon;
revoke insert, update, delete on owners from authenticated;

drop policy if exists staff_reads_owners on owners;
create policy staff_reads_owners on owners for select using (is_active_staff());

do $$ begin
  raise notice 'every property has a code, and an owner it can be filed under';
end $$;

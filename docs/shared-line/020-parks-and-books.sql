-- Parks, the homes standing on them, and whose book a property is in
--
-- Run in the Supabase SQL editor, after 019. Safe to run twice.
--
-- Three facts about this business that the schema could not previously hold.
--
-- 1. A park is a Rent Manager GROUP, not a property. Each lot is its own
--    property over there, because the home standing on it has an owner and
--    distributions are run per owner. So the group is the park and its
--    members are the lots, and which groups are parks is something only a
--    person knows -- "Pines Mobile Home Park" is one, "Non-Musgrove" is a
--    reporting filter, and no amount of cleverness tells them apart.
--
-- 2. We own the dirt; an investor owns the home standing on the lot. That is
--    a different relationship from a resident who owns their own home, and
--    it decides who is billed, who is chased, and who is called when the
--    furnace dies. The existing home_owner column says ours/theirs/none;
--    this adds WHO, which is the part that matters when there are fifty-one
--    of them.
--
-- 3. Some properties are managed rather than owned -- somebody else's home
--    on somebody else's land. Counting those in occupancy or rent roll
--    overstates the portfolio, so they are marked and can be excluded.

-- ------------------------------------------------ what each RM group means
create table if not exists rm_groups (
  id          uuid primary key default gen_random_uuid(),
  -- Their name for it, which is the only stable handle we get.
  name        text not null unique,
  -- park:    its members are lots in this park
  -- llc:     its members are owned by this company of ours
  -- managed: its members are managed for other people
  -- ignore:  a reporting filter, not a real thing
  -- unset:   nobody has said yet, and nothing will act on it
  role        text not null default 'unset'
              check (role in ('park','llc','managed','ignore','unset')),
  -- Filled once a park group has been turned into a property here.
  property_id uuid references properties(id) on delete set null,
  seen_at     timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references staff(id) on delete set null
);

alter table rm_groups enable row level security;
revoke all on rm_groups from anon;
revoke insert, update, delete on rm_groups from authenticated;
drop policy if exists staff_reads_rm_groups on rm_groups;
create policy staff_reads_rm_groups on rm_groups for select using (is_active_staff());
grant select on rm_groups to authenticated;

-- ------------------------------------------- whose home is on which lot
-- Not a new enum value. home_owner already says ours/theirs/none and adding
-- to an enum is the kind of change that takes an INSERT down with it when
-- something writes a word the type has never heard of. This says WHO, and an
-- investor-owned home is simply one where this is set.
alter table units
  add column if not exists home_owner_id uuid references owners(id) on delete set null;

create index if not exists units_home_owner_id on units (home_owner_id);

-- ------------------------------------------------- ours, or somebody's
alter table properties
  add column if not exists managed_only boolean not null default false;

comment on column properties.managed_only is
  'Someone else''s building on someone else''s land, managed by us. Excluded '
  'from occupancy and rent roll, because counting it overstates the portfolio.';

create index if not exists properties_managed on properties (managed_only)
  where managed_only;

do $$ begin
  raise notice 'parks can be groups, homes can belong to investors, and a managed property says so';
end $$;

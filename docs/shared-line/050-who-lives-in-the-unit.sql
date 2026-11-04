-- Who lives in the unit.
--
-- One unit out of 417 knows who its tenant is. The portfolio import
-- brought properties, units and owners across and stopped there --
-- /Tenants and /Leases both answer on this account and nothing has ever
-- fetched either, the same way /ServiceManagerIssues sat unread for
-- weeks while tenants wondered where their maintenance requests went.
--
-- Everything downstream wants this. A maintenance request arrives naming
-- nobody; the office picks the property and still has to type the
-- tenant's name and number from memory. With the lease roster in, the
-- person comes with the address.
--
-- WHAT THIS ADDS is one column: Rent Manager's own id for the tenant, so
-- a second import updates the person it already has rather than making
-- another. `contacts.phone` is the join key everywhere else in this
-- application and cannot be it here -- a tenant who has never given us a
-- number gets a placeholder, and two tenants without numbers must not
-- collide on it.
--
-- Nothing here drops or rewrites anything. The destructive-looking words
-- below are `alter table ... add column` and an index: the editor will
-- still say "Potential issue detected", because it flags any query
-- containing `alter`.

alter table public.contacts
  add column if not exists rm_tenant_id integer;

-- Unique, so the import cannot create a second record for one tenant --
-- but only over the rows that HAVE one, because every contact that came
-- from a text message or a web form has none and they must not all
-- collide on null.
create unique index if not exists contacts_rm_tenant_id_key
  on public.contacts (rm_tenant_id)
  where rm_tenant_id is not null;

-- Finding a unit's people is the whole point, and it is asked on every
-- maintenance thread that gets filed against a property.
create index if not exists contacts_unit_id_idx
  on public.contacts (unit_id)
  where unit_id is not null;

comment on column public.contacts.rm_tenant_id is
  'Rent Manager TenantID. Set by the tenant import so a re-run updates '
  'rather than duplicates. Null for anybody who reached us another way.';

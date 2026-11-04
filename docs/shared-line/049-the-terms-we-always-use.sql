-- The terms we always use
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query with
-- alter, drop or update in it. Here that is `drop policy if exists`, which
-- takes the previous copy of a policy off before creating it again, and
-- `alter table ... enable row level security`. Nothing is deleted and no
-- existing row changes.
--
-- Six investors, one set of terms. The late fee, the grace period, the
-- notice period, the lot rent, the consulting fee, the reserve, the payment
-- method, the park owner, which lease -- none of that changes from one
-- investor to the next, and all of it was being re-chosen on every screen
-- from a set of defaults written into the code. Retyping a term is how two
-- investors end up with different ones.
--
-- ONE ROW. Not one per park and not one per member of staff: there is a way
-- this company does a deal, and this is where it is written down. The check
-- constraint is what keeps it to one -- an upsert on `only_row` can only ever
-- land on the row that is already there. `only` itself is a reserved word in
-- Postgres and does not parse as a column name, which is why it is not one.

create table if not exists house_terms (
  only_row   boolean primary key default true check (only_row),
  -- The deal-level terms and nothing else. What belongs to one investor --
  -- their name, the date it was agreed, the date the lease runs from, the
  -- park, the homes -- is stripped before it is stored, in the route and
  -- again when it is applied. A standard carrying somebody's name would put
  -- that name on the next investor's papers.
  terms      jsonb not null,
  updated_at timestamptz not null default now(),
  by_staff   uuid references staff(id) on delete set null
);

alter table house_terms enable row level security;
revoke all on house_terms from anon;

drop policy if exists staff_reads_house_terms on house_terms;
create policy staff_reads_house_terms on house_terms
  for select using (is_active_staff());

grant select on house_terms to authenticated;
-- Written by the route with the service role, which checks the role of
-- whoever is asking. A read-only guest must not be able to change the terms
-- every future deal starts from by calling the database directly.
revoke insert, update, delete on house_terms from authenticated;

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

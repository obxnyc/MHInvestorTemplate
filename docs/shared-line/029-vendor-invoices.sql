-- 029 — vendor invoices: written once, never rewritten
--
-- A plumber sends a bill for $380, you approve it, and three weeks later the
-- row says $830. There is no way to tell whether that was always $830 and you
-- misread it, whether he corrected a typo, or whether somebody changed it.
-- That ambiguity is the whole problem, and it is not solved by being careful:
-- it is solved by making the first number impossible to overwrite.
--
-- So this table is append-only. A correction is a NEW row that points at the
-- one it replaces. Nothing is ever updated and nothing is ever deleted, and
-- that is enforced by the grants below rather than by everybody remembering.
-- The original stays readable forever, next to what replaced it and why.

create table if not exists vendor_invoices (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  -- The vendor as a contact, so an invoice is tied to the same record that
  -- holds their phone number and their jobs link.
  vendor_id     uuid not null references contacts(id) on delete restrict,

  -- Money in cents. Never a float: 0.1 + 0.2 is not 0.3, and an invoice total
  -- that is a cent out is an argument with somebody who is right.
  amount_cents  integer not null check (amount_cents >= 0),
  invoice_no    text,
  -- What they say it was for, in their words.
  description   text,
  -- The file itself, in the attachments bucket under invoices/<work order>/.
  file_path     text,

  -- The revision chain. Null means this is what the vendor first sent.
  -- Non-null means it replaces that row, and the reason is required -- a
  -- correction with no explanation is the thing this table exists to prevent.
  replaces      uuid references vendor_invoices(id) on delete restrict,
  reason        text,
  constraint correction_needs_a_reason check (
    replaces is null or length(trim(coalesce(reason, ''))) >= 10
  ),

  -- Who submitted it. A vendor submits through their jobs link and has no
  -- staff row; a member of staff entering a paper invoice has no contact row.
  -- Exactly one of these is set, always.
  by_vendor     boolean not null default true,
  by_staff      uuid references staff(id) on delete set null,
  constraint submitted_by_somebody check (
    (by_vendor and by_staff is null) or (not by_vendor and by_staff is not null)
  ),

  -- Where it has got to. Deliberately not a status anybody can set back:
  -- "sent to the bookkeeper" is a thing that happened, and un-happening it is
  -- not a state, it is a lie.
  emailed_at    timestamptz,
  rm_pushed_at  timestamptz,
  rm_ref        text,

  created_at    timestamptz not null default now()
);

create index if not exists vendor_invoices_job on vendor_invoices (work_order_id, created_at);
create index if not exists vendor_invoices_chain on vendor_invoices (replaces);
-- One correction per row, so two people cannot fork the history into two
-- competing "current" amounts.
create unique index if not exists vendor_invoices_one_correction
  on vendor_invoices (replaces) where replaces is not null;

alter table vendor_invoices enable row level security;

revoke all on vendor_invoices from anon;
-- The point of the table, in one line. Staff may read and add; nobody may
-- change or remove. A policy cannot express this -- a policy filters a
-- privilege and does not grant one -- so it is the grant that does the work.
revoke update, delete on vendor_invoices from authenticated;
grant select on vendor_invoices to authenticated;
grant insert (work_order_id, vendor_id, amount_cents, invoice_no, description,
              file_path, replaces, reason, by_vendor, by_staff)
  on vendor_invoices to authenticated;

drop policy if exists staff_reads_invoices on vendor_invoices;
create policy staff_reads_invoices on vendor_invoices
  for select using (is_active_staff());

drop policy if exists staff_adds_invoices on vendor_invoices;
create policy staff_adds_invoices on vendor_invoices
  for insert with check (is_active_staff());

-- Belt and braces. The grants above stop a signed-in browser, and this stops
-- everything else -- a migration run by hand, a script with the service role,
-- a console session at two in the morning. The service role bypasses RLS and
-- grants; it does not bypass a trigger.
create or replace function vendor_invoices_are_final() returns trigger
language plpgsql as $$
begin
  raise exception 'vendor invoices cannot be deleted -- submit a correction that replaces this row';
end $$;

-- One exception, and it is narrow: the two columns that record what HAS
-- happened to an invoice rather than what it says. Marking one as emailed is
-- not editing it, and blocking that would mean recording delivery in a second
-- table saying the same thing. Everything else raises.
create or replace function vendor_invoices_delivery_only() returns trigger
language plpgsql as $$
begin
  if  new.work_order_id is distinct from old.work_order_id
   or new.vendor_id     is distinct from old.vendor_id
   or new.amount_cents  is distinct from old.amount_cents
   or new.invoice_no    is distinct from old.invoice_no
   or new.description   is distinct from old.description
   or new.file_path     is distinct from old.file_path
   or new.replaces      is distinct from old.replaces
   or new.reason        is distinct from old.reason
   or new.by_vendor     is distinct from old.by_vendor
   or new.by_staff      is distinct from old.by_staff
   or new.created_at    is distinct from old.created_at
  then
    raise exception 'an invoice cannot be edited -- submit a correction that replaces this row';
  end if;
  return new;
end $$;

-- Dropped by every name this file has ever used, so re-running it is safe
-- whatever state the database was left in.
drop trigger if exists vendor_invoices_no_update on vendor_invoices;
drop trigger if exists vendor_invoices_delivery  on vendor_invoices;
drop trigger if exists vendor_invoices_no_delete on vendor_invoices;

create trigger vendor_invoices_delivery before update on vendor_invoices
  for each row execute function vendor_invoices_delivery_only();

create trigger vendor_invoices_no_delete before delete on vendor_invoices
  for each row execute function vendor_invoices_are_final();

-- Invoice files live beside everything else in the private bucket, under
-- their own prefix, readable by staff. Not by the conversation rule: an
-- invoice belongs to a job, and a job is not always on a conversation.
drop policy if exists staff_reads_invoice_files on storage.objects;
create policy staff_reads_invoice_files on storage.objects
for select to authenticated
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = 'invoices'
  and is_active_staff()
);

-- Dispatch: forwarding a message on, the job it opens, and the vendor's view
--
-- Run in the Supabase SQL editor, after schema.sql. Safe to run twice.

-- ------------------------------------------------------------ who holds a job
--
-- Why a new column rather than reusing assigned_tech: that one references
-- `staff`, meaning someone who signs in. An outside contractor is a `contacts`
-- row with party 'vendor' -- a phone number and no login, and never will have
-- one. Filing them in a column that points at the staff table would mean either
-- inventing staff rows for people who are not staff, or losing who the job
-- actually went to. There are genuinely two kinds of person who can hold a job.
alter table work_orders
  add column if not exists assigned_vendor uuid references contacts(id) on delete set null,
  add column if not exists created_by      uuid references staff(id)    on delete set null,
  -- The message the job came from, so a work order can always be read back to
  -- the sentence a tenant actually sent.
  add column if not exists source_message  uuid references messages(id)  on delete set null,
  -- When we said it would be done. Distinct from scheduled_for, which is when
  -- someone is going out: a visit on Tuesday for a job promised Monday is
  -- exactly the situation worth seeing in red.
  add column if not exists due_at          timestamptz;

-- Exactly one holder, or none yet. Both at once is not a state anyone means.
alter table work_orders drop constraint if exists one_holder;
alter table work_orders add constraint one_holder
  check (assigned_tech is null or assigned_vendor is null);

create index if not exists work_orders_vendor on work_orders (assigned_vendor, status);
create index if not exists work_orders_due    on work_orders (due_at) where status <> 'done';

-- ------------------------------------------------------- the vendor's own view
--
-- A contractor needs to see their open jobs and send a photo when one is done.
-- They will not create an account to do it -- ask a plumber to set a password
-- and the photo never arrives, and then the evidence rule that the database
-- enforces becomes a rule that everybody routes around.
--
-- So: a long random token, texted to them once, that opens a page listing only
-- their jobs. Same shape as the showing-booking links. It is a bearer
-- credential and is treated as one: long enough not to be guessed, never
-- reused between people, and revocable by setting it to null.
alter table contacts
  add column if not exists jobs_token text unique;

-- Nothing reads this column from a browser. The jobs page runs on the server,
-- looks the token up with the service role, and returns only that vendor's
-- rows -- so there is no policy here to get wrong, and the token never reaches
-- any client but the one that already has it.
revoke select (jobs_token) on contacts from authenticated;

-- ------------------------------------------------ photographs of finished work
--
-- A tech's completion photo lands under 'work-orders/<id>/...', which the
-- conversation media policy does not cover. Same trick as that one: the job id
-- is in the path, so the rule reuses whatever visibility work_orders already
-- has rather than inventing a second set that drifts from the first.
--
-- No insert policy, deliberately. Uploads happen in the route that checks the
-- vendor's token, running with the service role; letting signed-in users write
-- here would let any employee put files under any job's path.
drop policy if exists staff_reads_work_order_media on storage.objects;
create policy staff_reads_work_order_media on storage.objects
for select to authenticated
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = 'work-orders'
  and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
  and exists (
    select 1 from work_orders w
    where w.id = ((storage.foldername(name))[2])::uuid
  )
);

do $$ begin
  raise notice 'work orders can be held by a vendor, carry a due date, and be listed by token';
end $$;

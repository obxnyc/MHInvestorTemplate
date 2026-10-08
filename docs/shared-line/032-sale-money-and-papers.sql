-- 032 — what an owner pays us every month, and the paper it rests on.
--
-- 030 recorded the sale: price, down payment, and the note if we financed
-- it. That is the deal struck once. This is the deal running: four
-- separate monthly charges that arrive on one statement and are argued
-- about one at a time.

alter table home_sales
  -- The lot fee. The home is theirs and the ground is ours, and this is
  -- the whole reason a park is a business.
  add column if not exists lot_rent_cents    integer
    check (lot_rent_cents is null or lot_rent_cents >= 0),
  -- What we charge to run it for them -- find the tenant, collect the
  -- rent, send the plumber. Nil when the owner manages it themselves,
  -- which is why it is separate from the lot fee rather than folded in.
  add column if not exists management_cents  integer
    check (management_cents is null or management_cents >= 0),
  -- The home warranty, if they took one.
  add column if not exists warranty_cents    integer
    check (warranty_cents is null or warranty_cents >= 0),
  -- What the tenant living in it pays, where we are the ones letting it.
  -- Kept on the sale rather than the unit because it belongs to this
  -- owner's arrangement and ends when their ownership does.
  add column if not exists tenant_rent_cents integer
    check (tenant_rent_cents is null or tenant_rent_cents >= 0),
  -- A pet fee, which is monthly and is charged often enough to be a
  -- column rather than a note somebody has to read.
  add column if not exists pet_fee_cents     integer
    check (pet_fee_cents is null or pet_fee_cents >= 0),
  -- What a late payment costs. Not a monthly charge: this is the figure
  -- the agreement names, and what gets charged when is a job for the
  -- payment side, which does not exist yet.
  add column if not exists late_fee_cents    integer
    check (late_fee_cents is null or late_fee_cents >= 0);

-- A charge we make for managing a home we are not managing is a charge
-- somebody will ask about and nobody can explain.
alter table home_sales drop constraint if exists management_fee_needs_managing;

comment on column home_sales.lot_rent_cents is
  'Monthly lot fee the home owner pays the park.';
comment on column home_sales.management_cents is
  'Monthly fee for the park letting and running the home on the owner''s behalf.';
comment on column home_sales.warranty_cents is
  'Monthly home warranty, where one was taken.';
comment on column home_sales.tenant_rent_cents is
  'Monthly rent the tenant pays, where the park lets the home.';
comment on column home_sales.pet_fee_cents is
  'Monthly pet fee, where the tenant has one.';
comment on column home_sales.late_fee_cents is
  'What the agreement charges for a late payment. Not a monthly figure.';

-- ---------------------------------------------------------------------
-- The paperwork.
-- ---------------------------------------------------------------------
--
-- A bill of sale and a lease are the two documents somebody asks for
-- when a figure is disputed, and "it is in the filing cabinet" is how an
-- afternoon goes. Hung off the sale rather than the unit, because the
-- lot outlives the deal: lot 3107 has had three bills of sale and each
-- belongs to its own.
--
-- The file itself lives in the same storage bucket as every other
-- attachment; this is the path to it and what it is.
do $$ begin
  create type paper_kind as enum
    ('bill_of_sale', 'lease', 'note', 'title', 'warranty', 'other');
exception when duplicate_object then null; end $$;

create table if not exists sale_papers (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references home_sales(id) on delete cascade,
  kind       paper_kind not null,

  -- Where the file sits in the attachments bucket, and what to call it
  -- on screen. Both, because a storage path is not a filename anybody
  -- wants to read.
  path       text not null,
  name       text,

  signed_on  date,
  note       text,
  added_at   timestamptz not null default now(),
  added_by   uuid references staff(id) on delete set null
);

create index if not exists sale_papers_by_sale on sale_papers (sale_id, kind);
-- The same file attached twice to the same sale is a mistake, not two
-- documents.
create unique index if not exists sale_papers_one_of_each_file
  on sale_papers (sale_id, path);

alter table sale_papers enable row level security;
revoke all on sale_papers from anon;
-- A paper filed against the wrong sale gets detached, so delete is
-- allowed here -- unlike a vendor invoice, this is a pointer to a file
-- rather than a figure anybody relies on, and the file itself stays in
-- the bucket.
grant select, insert, update, delete on sale_papers to authenticated;

drop policy if exists staff_reads_papers on sale_papers;
create policy staff_reads_papers on sale_papers
  for select using (is_active_staff());
drop policy if exists staff_writes_papers on sale_papers;
create policy staff_writes_papers on sale_papers
  for insert with check (is_active_staff());
drop policy if exists staff_updates_papers on sale_papers;
create policy staff_updates_papers on sale_papers
  for update using (is_active_staff()) with check (is_active_staff());
drop policy if exists staff_removes_papers on sale_papers;
create policy staff_removes_papers on sale_papers
  for delete using (is_active_staff());

do $$ begin
  raise notice 'a sale has its monthly charges and its paperwork';
end $$;

-- The signature on our side
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query with
-- alter, drop or update in it. Here that is `drop policy if exists`, which
-- takes the previous copy of a permission rule off before putting it back,
-- and `alter table ... enable row level security`. Nothing is deleted and no
-- existing row changes.
--
-- Every purchase agreement and every land lease goes out with two signature
-- lines on it, and one of them is ours. Signing our own line in DocuSign is a
-- round trip through another company's website to put a mark on a document we
-- wrote, for every home, on a deal that might be eight of them.
--
-- So the mark is kept here and drawn onto the Seller and the Park Owner lines
-- as the file is made. The buyer's line stays blank: they sign for themselves,
-- wherever they sign.
--
-- One per person, not one per company. A signature belongs to whoever made it,
-- and "Larabee Homes LLC" does not have a hand.

create table if not exists signatures (
  staff_id   uuid primary key references staff(id) on delete cascade,
  -- A PNG, as a data URL. Kept small by the screen that captures it -- a
  -- signature is about two inches across and there is no reason for it to be
  -- more than a few tens of kilobytes.
  png        text not null,
  -- What it is a signature OF, so a document can say whose mark it carries
  -- rather than only showing it.
  signs_as   text,
  updated_at timestamptz not null default now()
);

alter table signatures enable row level security;
revoke all on signatures from anon;

-- A signature is a personal thing: everybody may use their own and nobody
-- else's. Not "the office can read them all" -- the whole point of a mark on
-- a contract is that one person made it.
drop policy if exists own_signature_read on signatures;
create policy own_signature_read on signatures
  for select using (staff_id = auth.uid());

grant select on signatures to authenticated;
-- Written by the route with the service role, which checks who is asking.
-- Deliberately not grantable: a signature that anybody signed in could write
-- is not a signature.
revoke insert, update, delete on signatures from authenticated;

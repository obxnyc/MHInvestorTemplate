-- Sending it to be signed
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query with
-- alter, drop or update in it. Here that is `drop policy if exists`, which
-- takes the previous copy of a permission rule off before putting it back,
-- and `alter table ... enable row level security`. Nothing is deleted and no
-- existing row changes.
--
-- The seller's side is signed in the application. This is the other half: a
-- link the investor opens, reads, and signs the same way, without an account
-- and without a third-party signing service.
--
-- THE DOCUMENT IS FROZEN WHEN IT IS SENT. `pack` is the HTML as it was at
-- that moment, and it is the document of record. Regenerating it when
-- somebody signs would mean a change to the code could change what they had
-- already agreed to, which is the one thing a contract may not do. Signing
-- fills the slots that were marked in that exact text and stores the result
-- beside it, so both what was offered and what was signed are kept.

create table if not exists signing_requests (
  id          uuid primary key default gen_random_uuid(),
  -- Long, random, and the only thing standing between a stranger and
  -- somebody's purchase agreement. Issued by the route, never by a client.
  token       text not null unique,
  owner_id    uuid references owners(id) on delete set null,

  -- What was sent, exactly.
  title       text not null,
  pack        text not null,
  doc_count   int  not null default 0,

  -- Who it went to, and how. Both may be set; at least one has to be, or
  -- nobody was sent anything.
  to_name     text not null,
  to_email    text,
  to_phone    text,

  sent_by     uuid references staff(id) on delete set null,
  sent_at     timestamptz not null default now(),
  expires_at  timestamptz not null,
  opened_at   timestamptz,

  -- What they did. `agreed` is its own column rather than something implied
  -- by the signature: intending to sign electronically is a separate fact
  -- from having made a mark, and it is the fact that matters if anybody ever
  -- asks whether this was a signature at all.
  agreed      boolean not null default false,
  signed_at   timestamptz,
  signed_name text,
  signed_png  text,
  signed_pack text,
  signed_ip   text,
  signed_agent text,

  -- Called off before it was signed.
  voided_at   timestamptz,
  voided_by   uuid references staff(id) on delete set null,

  constraint signing_requests_somewhere_to_send
    check (to_email is not null or to_phone is not null)
);

create index if not exists signing_requests_owner
  on signing_requests (owner_id, sent_at desc);
-- The ones still waiting, which is the only list anybody asks for.
create index if not exists signing_requests_open
  on signing_requests (expires_at)
  where signed_at is null and voided_at is null;

alter table signing_requests enable row level security;
revoke all on signing_requests from anon;

-- The office may see what was sent and what came back.
drop policy if exists staff_reads_signing_requests on signing_requests;
create policy staff_reads_signing_requests on signing_requests
  for select using (is_active_staff());

grant select on signing_requests to authenticated;
-- Everything is written by routes holding the service role: one checks who is
-- asking, the other checks the token. A row here is a contract offered and a
-- contract signed, and neither is something a browser gets to write.
revoke insert, update, delete on signing_requests from authenticated;

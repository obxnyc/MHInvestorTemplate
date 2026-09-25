-- What work costs
--
-- Run in the Supabase SQL editor, after 007. Safe to run twice.
--
-- The point of this is not accounting. It is that somebody in the office with
-- no feel for what a water heater swap costs gets handed a $680 invoice and has
-- no way to know whether that is normal. Writing down what was paid last time,
-- for the same kind of work, turns that from a judgement call into a lookup --
-- and it is the difference between paying a fair price and paying whatever was
-- asked, for years, without anyone noticing.
--
-- So the unit of record is the JOB, not the invoice. A job already knows what
-- was wrong, who did it, when it was finished and where. Adding what it cost
-- makes it a price history for free.

alter table work_orders
  add column if not exists cost_cents  integer,
  add column if not exists invoice_ref text,
  -- Which trade this was, so "what does plumbing usually run" is answerable.
  -- Left null on old rows rather than guessed: an invented category would
  -- poison the very average it exists to produce.
  add column if not exists trade_id    text references trades(id),
  add column if not exists costed_on   date,
  add column if not exists costed_by   uuid references staff(id) on delete set null;

create index if not exists work_orders_cost
  on work_orders (trade_id, completed_at) where cost_cents is not null;

-- A price with no date is a rumour, and a four-year-old price quoted as
-- current is worse than none. Everything that reads this can say how old it is.
update work_orders set costed_on = coalesce(costed_on, completed_at::date)
  where cost_cents is not null and costed_on is null;

do $$ begin
  raise notice 'jobs can carry what they cost';
end $$;

-- Where we are with this person
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query with
-- alter, drop or update in it. Here that is `alter table ... add column if not
-- exists` and `alter column ... set default`, which add two new columns and
-- say what future rows should start as. No existing row is changed and
-- nothing is deleted.
--
-- An inquiry has had two states since it was built: open, or ended. So a lead
-- who rang on Monday, was shown a lot on Wednesday and whose application is
-- sitting on somebody's desk reads exactly the same as one that came in an
-- hour ago and nobody has opened -- both "open", both on the same board, in
-- the same colour. The question the owner is actually asking about a renter
-- is not whether they are still in play. It is what the next move is and
-- whose it is.
--
-- STAGE IS THE OPEN PROGRESSION ONLY, AND `outcome` IS STILL THE ENDING.
-- There is deliberately no 'leased' stage: that is `outcome =
-- 'leased_with_us'`, and a lease recorded in two columns is two columns that
-- will disagree by the end of the month. The stage runs up to the point a
-- decision is made and stops.
--
-- AND A ROW THAT PREDATES THIS COLUMN IS LEFT NULL, which is the whole
-- reason the column has no backfill.
--
-- `add column ... default 'new'` would write 'new' onto every inquiry already
-- on file, and 'new' is not an empty value -- it is the claim that nobody has
-- replied to this person yet. For the leads already in there, some of which
-- have been answered, that is a false statement about work somebody did, and
-- it is the statement that decides who gets rung this afternoon.
--
-- So the column is added with no default, which in Postgres leaves existing
-- rows NULL, and the default is set in a SECOND statement, which applies only
-- to rows inserted afterwards. Null means "this lead predates the column, so
-- nobody has said" -- a different thing from 'new', and the board says so in
-- those words rather than picking one of them.
--
-- Same shape as `plan.fenceFrom` being absent rather than guessed, and
-- `described` being null before it is false. A park whose line predates the
-- question is not evidence either way, and guessing there is the same lie in
-- a new place.

-- `create type` has no `if not exists`, so this asks whether it is there.
-- Deliberately a conditional and NOT a `do $$ ... exception when others then
-- null $$`: an exception handler would have swallowed a real failure and left
-- the type quietly absent with nothing on screen to say so. That exact
-- wrapper nearly shipped in 038.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'inquiry_stage') then
    create type inquiry_stage as enum (
      'new',          -- nobody has replied to them yet
      'replied',      -- we have answered; waiting on them
      'tour_booked',  -- a showing is arranged
      'toured',       -- they have seen it
      'applied',      -- an application is in
      'approved'      -- screened and approved; waiting on a lease
    );
  end if;
end $$;

-- No default here ON PURPOSE -- see the note above. Existing rows stay null.
alter table inquiries
  add column if not exists stage inquiry_stage;

-- And the default applies only to rows inserted from here on.
alter table inquiries
  alter column stage set default 'new';

-- WHEN THE STAGE LAST MOVED, which is the half that makes the board worth
-- looking at. "Applied" is not a state anybody acts on; "applied, and it has
-- been nine days" is. Measured from the stage change rather than from
-- `inquired_at`, because a lead that moved this morning is not waiting.
alter table inquiries
  add column if not exists stage_at timestamptz;

alter table inquiries
  alter column stage_at set default now();

create index if not exists inquiries_stage_idx
  on inquiries (stage, stage_at) where outcome = 'open';

-- WHAT WE REFUSED TO RECORD, AND WHY, which rides along in this migration
-- because the Zillow leads are what made it necessary.
--
-- A Zillow enquiry hands over a form: move-in date, bedrooms and pets, which
-- are stated preferences and are kept -- and number of occupants, income and
-- credit score, which are not, and are not. Those three are in the message
-- body, so they are on screen in the thread whatever this column does.
--
-- The hazard is specific and it has happened here before: somebody reads
-- "Number of Occupants 5" in the thread, sees an empty Beds box on the board,
-- and helpfully types 5 into it -- and a familial-status fact is now in a
-- column this business matches on. The blank is what invites them. So the
-- refusal travels with the row and the card says "Zillow says 5 occupants;
-- that is the size of the household, not a number of bedrooms" where the
-- empty box is.
--
-- `readWanted` has produced these refusals since 037 and nothing has ever
-- been able to store one. A default of '[]' is honest for the rows already
-- there: nothing was declined on them, because nothing read them.
--
--   [{"field": "bedroomsMin", "because": "Zillow says 5 occupants. That is …"}]
alter table inquiries
  add column if not exists declined jsonb not null default '[]'::jsonb;

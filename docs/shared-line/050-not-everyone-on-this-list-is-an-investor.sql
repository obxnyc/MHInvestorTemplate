-- Not everyone on this list is an investor
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query with
-- alter, drop or update in it. Here that is `alter table ... add column`,
-- `drop policy if exists` before creating the policy again, and one `update`
-- that sets the new column on seven named rows. Nothing is deleted and no
-- existing column changes.
--
-- Three different things were sharing one table and one screen.
--
--   An INVESTOR buys homes from us. We finance them, they get a purchase
--   agreement and a park land lease, and the papers screen is theirs.
--
--   A RESIDENT owns their own home and rents the lot it stands on. There is
--   no purchase agreement from us and never was -- they bought the home
--   somewhere else, or they have owned it for twenty years. Charlie Nemier,
--   Christie Moore, David Bell, Earl McGraw, Jerry Scalice and Lori Cooke
--   are all this, and all six were being listed as investors.
--
--   And some of them are US. Hudson Yards LLC owns The Pines; Larabee Homes
--   owns most of Cross Creek. A company of ours appearing in a list of
--   people who owe us money is a number that is wrong in both directions.
--
-- The distinction is not derivable. "Has no sale recorded" describes a
-- resident, and it also describes eighty-four lots at Northside whose sales
-- were destroyed by an import and may yet come back, and it describes an
-- investor whose first purchase has not been entered. So nothing here
-- guesses: every existing row keeps the meaning it already had, and only the
-- seven named below are changed, because those seven were named.

alter table owners
  add column if not exists kind text not null default 'investor';

do $$ begin
  alter table owners add constraint owners_kind_known
    check (kind in ('investor', 'resident', 'ours'));
exception when duplicate_object then null; end $$;

comment on column owners.kind is
  'investor: buys homes from us and gets papers. '
  'resident: owns their own home on one of our lots, rents the lot only. '
  'ours: one of our own companies.';

-- The list is read by kind and then by name, so an index on it earns its
-- keep the moment there are a few hundred.
create index if not exists owners_by_kind on owners (kind);

-- The seven the owner named, and nobody else. Matched case-insensitively on
-- the exact name because `Lori Cooke` was written `Lori cook` and
-- `charlie nemier` lower-cased -- but NOT with `like`, which would make
-- `SHB Investments` and `SHB INVESTMENTS` the same row by accident.
update owners set kind = 'resident'
where lower(name) in (
  'charlie nemier', 'christie moore', 'david bell',
  'earl mcgraw', 'jerry scalice', 'lori cooke'
);

update owners set kind = 'ours'
where lower(name) in ('hudson yards llc');

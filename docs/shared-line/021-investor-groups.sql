-- A group can be an investor, and a group can be misspelled
--
-- Run in the Supabase SQL editor, after 020. Safe to run twice.
--
-- Two things 020 could not say.
--
-- RNMK is not a company of ours and not a park. It is one investor, and the
-- group is a lens: those properties are homes he owns standing on lots in
-- OUR parks, tagged so a report can pick them out in one click. Which means
-- a property is in two groups at once -- its park, which decides where it
-- sits, and his, which decides nothing structural and is worth knowing
-- anyway. Filing that under "one of our companies" would put his name on our
-- land; filing it under "a reporting filter" would throw away the fact that
-- there is a person behind it.
--
-- And their group is spelled RHMK when the investor is RNMK. Correcting it
-- in Rent Manager is their business and ours to leave alone; carrying the
-- right name on our screens is not. 020 gave parks a local name for a
-- different reason -- The Retreat 2 is 1148 Northside -- and the same field
-- answers this, so it is simply allowed on any group now rather than only on
-- parks.

alter table rm_groups
  drop constraint if exists rm_groups_role_check;

alter table rm_groups
  add constraint rm_groups_role_check
  check (role in ('park','llc','investor','managed','ignore','unset'));

do $$
begin
  -- The constraint has to accept the new word and still refuse nonsense,
  -- because a check that accepts everything is a comment.
  begin
    insert into rm_groups (name, role) values ('__probe__', 'investor');
    delete from rm_groups where name = '__probe__';
  exception when check_violation then
    raise exception 'investor was not accepted by the role check';
  end;

  begin
    insert into rm_groups (name, role) values ('__probe__', 'nonsense');
    delete from rm_groups where name = '__probe__';
    raise exception 'the role check is letting anything through';
  exception when check_violation then
    null;
  end;

  raise notice 'a group can now be an investor, and can carry a name we spell correctly';
end $$;

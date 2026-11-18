-- 073: a maintenance conversation is never private.
--
-- The owner, 18 November 2026: "something that is labeled maintenance should
-- probably not be labeled as private, because everyone needs to be able to
-- see that." Private is for side conversations -- Natashia and Hannah, or
-- Natashia and her husband on the company line -- so they do not clutter
-- everybody else's inbox. A repair is everybody's business.
--
-- Two ways a maintenance conversation could end up private, and two answers:
--   * somebody tries to make one private: refused, saying why;
--   * a private conversation is re-filed as maintenance: it becomes shared
--     again, because the repair now matters more than the privacy did.
-- In the database, so neither the Private button nor any route that files a
-- category can get round it. Safe to run twice.

create or replace function maintenance_stays_shared() returns trigger
language plpgsql as $$
begin
  if new.category::text <> 'maintenance'
     or new.private_to is null or cardinality(new.private_to) = 0 then
    return new;
  end if;

  -- The privacy is what is being changed: say no, in words.
  if tg_op = 'INSERT' or new.private_to is distinct from old.private_to then
    raise exception 'A maintenance conversation stays shared so everyone can see the repair.'
      using errcode = 'check_violation';
  end if;

  -- The category is what changed: the repair wins, and it is shared again.
  new.private_to := null;
  return new;
end $$;

drop trigger if exists maintenance_stays_shared on conversations;
create trigger maintenance_stays_shared before insert or update of private_to, category
  on conversations for each row execute function maintenance_stays_shared();

-- Anything already in that state, put right once.
update conversations set private_to = null
where category::text = 'maintenance' and private_to is not null;

-- 073: evaluate auth.uid() once per query, not once per row.
--
-- WHY. Supabase's performance advisor names it: `auth_rls_initplan`. Eighteen
-- row-level security policies call `auth.uid()` directly, and Postgres
-- re-evaluates it FOR EVERY ROW IT TESTS, on every query the inbox makes.
--
-- AND IT IS NOT WHAT THE OWNER REPORTED. This was written looking for the
-- cause of "I just started a new chat and it's taking forever to load", and it
-- is not that. The tables are 322 conversations, 346 messages, 316 work
-- orders; the thread read, timed as a signed-in office user, is six
-- milliseconds. Eighteen policies re-evaluating a function across 346 rows is
-- a real inefficiency and it is not an afternoon. It is kept because it is
-- right, not because it fixed anything anybody felt -- and it is written down
-- that way so the next person reading this file does not take a cleared lint
-- for a solved complaint. A plausible fix, shipped against an unreproduced
-- symptom and then described as the answer, is how a slow screen stays slow
-- while everybody believes it was dealt with.
--
-- Wrapping it in a scalar sub-select makes it an InitPlan: computed once and
-- reused. The documented Supabase fix.
--
-- THIS CHANGES NO RULE. `(select auth.uid())` returns exactly what
-- `auth.uid()` returns. Nobody can see a row they could not see before and
-- nobody loses one they could. Only the plan changes.
--
-- WRITTEN FROM THE LIVE DEFINITIONS rather than retyped. Eighteen policies
-- copied by hand into a migration is eighteen chances to widen one by a
-- character, on a database holding tenants' conversations. This reads each
-- policy out of `pg_policies`, substitutes, and puts it back with ALTER
-- POLICY -- which replaces the expression in place, so there is no instant at
-- which the table is unprotected.

do $$
declare
  p record;
  q text;
  c text;
  stmt text;
  done int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       -- Not the ones already wrapped. Postgres prints a wrapped call as
       -- `( SELECT auth.uid() AS uid)`, whose inner text would match a naive
       -- search and be wrapped a second time on a re-run.
       and (qual       ~ '(?<!SELECT )auth\.(uid|jwt|role)\(\)'
         or with_check ~ '(?<!SELECT )auth\.(uid|jwt|role)\(\)')
  loop
    q := regexp_replace(p.qual,       '(?<!SELECT )auth\.(uid|jwt|role)\(\)',
                        '(select auth.\1())', 'g');
    c := regexp_replace(p.with_check, '(?<!SELECT )auth\.(uid|jwt|role)\(\)',
                        '(select auth.\1())', 'g');

    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if q is not null then stmt := stmt || format(' using (%s)', q); end if;
    if c is not null then stmt := stmt || format(' with check (%s)', c); end if;

    execute stmt;
    done := done + 1;
  end loop;

  raise notice 'rewrote % policies', done;
end $$;

-- AND ASK WHETHER IT WORKED, rather than taking the absence of an error as an
-- answer. A `do` block that matched nothing raises nothing at all, which is
-- the shape this repository has been caught by before.
do $$
declare left_over int;
begin
  select count(*) into left_over
    from pg_policies
   where schemaname = 'public'
     and (qual       ~ '(?<!SELECT )auth\.(uid|jwt|role)\(\)'
       or with_check ~ '(?<!SELECT )auth\.(uid|jwt|role)\(\)');

  if left_over > 0 then
    raise exception 'still % policies evaluating auth.uid() per row', left_over;
  end if;
end $$;

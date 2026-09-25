-- Let staff actually write a note
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The row-level security pass revoked insert from `authenticated` on every
-- table and then created an insert POLICY on notes. A policy does not grant a
-- privilege -- it filters one that has already been granted. So the policy was
-- checking rows that could never be offered, and writing a note failed for
-- everyone, silently, from the moment security was tightened.
--
-- Fixed with a grant rather than by moving the write to the service role. The
-- policy pins author_id to the signed-in person, which means the DATABASE
-- guarantees nobody can file a note under someone else's name. Hand the write
-- to the service role and that guarantee becomes a line of application code
-- that has to stay correct forever.
--
-- Column-level, so the grant covers exactly what the route sets and nothing
-- else: no writing timestamps, no touching the id.

grant insert (conversation_id, author_id, body, mentions) on notes to authenticated;

-- has_ANY_COLUMN_privilege, not has_table_privilege. A column-level grant does
-- not register as a table privilege, so the obvious check reports failure on a
-- grant that worked perfectly -- and in an editor that wraps a script in a
-- transaction, that false alarm rolls the grant back and leaves notes exactly
-- as broken as before.
do $$
begin
  if not has_any_column_privilege('authenticated', 'notes', 'insert') then
    raise exception 'the grant did not take';
  end if;
  raise notice 'staff can write notes again';
end $$;

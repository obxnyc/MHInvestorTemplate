-- What has already been asked on a thread
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The suggestion strip has to stop suggesting. A tenant who has already told
-- you the water is off should not be asked again on the next reply, and a
-- strip that never shortens is one people stop reading after a week -- at
-- which point it is worse than nothing, because it looks like it is working.
--
-- On the conversation rather than per person: two people work one thread, and
-- the question was asked of the tenant, not by an individual. Hannah should
-- not be re-asking what Sam asked an hour ago.
--
-- Keys, not sentences. The wording in lib/prompts.ts will get edited; what was
-- asked should survive that.

alter table conversations
  add column if not exists asked text[] not null default '{}';

-- Column-level, so this grants exactly the one field the strip writes and
-- nothing else on the conversation -- not the category, not who it is assigned
-- to. has_ANY_COLUMN_privilege below for the same reason as 006: a
-- column-level grant does not register as a table privilege.
grant update (asked) on conversations to authenticated;

do $$
begin
  if not has_any_column_privilege('authenticated', 'conversations', 'update') then
    raise exception 'the grant did not take';
  end if;
  raise notice 'threads remember what has been asked';
end $$;

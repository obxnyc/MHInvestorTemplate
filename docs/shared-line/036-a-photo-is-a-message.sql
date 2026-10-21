-- 036 — a photograph with no words is a whole message
--
-- 013 made `dm_messages.body` a column that must say something:
--
--     body text not null check (length(trim(body)) > 0)
--
-- which was right when a message was words and nothing else. 027 added
-- `media_paths` and the screen started saying "a screenshot with no
-- words is a whole message" -- and nobody came back here. So dragging a
-- photo into a team chat and pressing enter hit:
--
--     new row for relation "dm_messages" violates check constraint
--     "dm_messages_body_check"
--
-- The rule was never "the body must say something". It was "the MESSAGE
-- must say something", and a photograph says plenty. This replaces the
-- constraint with the rule that was always meant.
--
-- Idempotent, and safe on a database where 027 has not been run: the
-- media clause is only added where the column exists, so an older
-- database keeps the old rule rather than failing to migrate.

do $$
begin
  -- The name Postgres gave it in 013, and the name this migration gives
  -- its replacement. Both dropped, so running this twice is quiet.
  alter table dm_messages drop constraint if exists dm_messages_body_check;
  alter table dm_messages drop constraint if exists dm_messages_says_something;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dm_messages'
      and column_name = 'media_paths'
  ) then
    -- Words, or something attached. `array_length` of an empty array is
    -- null rather than zero, which is the trap in this one line.
    alter table dm_messages add constraint dm_messages_says_something
      check (
        length(trim(body)) > 0
        or coalesce(array_length(media_paths, 1), 0) > 0
      );
  else
    alter table dm_messages add constraint dm_messages_says_something
      check (length(trim(body)) > 0);
  end if;
end $$;

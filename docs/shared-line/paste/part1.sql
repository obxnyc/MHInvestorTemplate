grant insert (conversation_id, author_id, body, mentions) on notes to authenticated;

do $$
begin
  if not has_any_column_privilege('authenticated', 'notes', 'insert') then
    raise exception 'the grant did not take';
  end if;
  raise notice 'staff can write notes again';
end $$;

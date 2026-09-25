-- Row-level security — what each role can actually read
--
-- Run against a scratch database with schema.sql and seed.sql loaded, as a
-- superuser (the Supabase SQL editor qualifies). It creates its own placeholder
-- rows, then tries to read them as anon, as a tech and as an admin.
--
-- The one that matters most is the first. Supabase publishes every table in
-- `public` through its REST API, and the anon key that reaches it is embedded
-- in the browser. A table with RLS off is world-readable no matter what the
-- application does, so "anon reads nothing" is not a nicety -- it is the wall.

\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-00000000c101'),
  ('aaaaaaaa-0000-0000-0000-00000000c102')
on conflict do nothing;

insert into staff (id, full_name, role) values
  ('aaaaaaaa-0000-0000-0000-00000000c101','RLS Test Tech','tech'),
  ('aaaaaaaa-0000-0000-0000-00000000c102','RLS Test Admin','admin')
on conflict (id) do update set role = excluded.role, active = true;

select set_staff_pin('aaaaaaaa-0000-0000-0000-00000000c101','8317');

insert into contacts (phone, full_name, party)
values ('+15555550199','RLS Test Tenant','current_tenant')
on conflict (phone) do nothing;

insert into court_filings (case_number) values ('26CV000RLS-690')
on conflict do nothing;

insert into prequal_submissions (answers, outcome, rule_set_id)
  select '{"credit_score":712}'::jsonb, 'auto_approve', id from prequal_rule_sets limit 1;

\set QUIET off

-- 1. No table in public may have RLS off, ever.
do $$
declare open_tables text[];
begin
  select array_agg(c.relname order by c.relname) into open_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if open_tables is not null then
    raise exception 'FAIL: RLS is off on %, which publishes them to anyone holding the anon key', open_tables;
  end if;
  raise notice 'ok  every table in public has RLS enabled';
end $$;

-- 2. anon is not a credential. It gets nothing.
set role anon;
do $$
declare t text; n int; leaked text[] := '{}';
begin
  foreach t in array array['staff','contacts','consent','conversations','messages','calls',
                           'notes','work_orders','prequal_submissions','showings','inquiries',
                           'court_filings','audit_log','properties','units','push_subscriptions',
                           'broadcasts','templates','nurture_touches','reassigned_number_checks',
                           'teams','team_members','prequal_rule_sets'] loop
    begin
      execute format('select count(*) from %I', t) into n;
      if n > 0 then leaked := leaked || t; end if;
    exception when insufficient_privilege then null;   -- refused outright is fine
    end;
  end loop;
  if array_length(leaked, 1) is not null then
    raise exception 'FAIL: anon can read %', leaked;
  end if;
  raise notice 'ok  anon reads nothing at all';
end $$;
reset role;

-- 3. A tech sees the shared line, and none of the sensitive files.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000c101';
do $$
declare n int;
begin
  select count(*) into n from contacts;
  if n < 1 then raise exception 'FAIL: a tech cannot see contacts, so the inbox is empty for them'; end if;
  select count(*) into n from staff;
  if n < 1 then raise exception 'FAIL: a tech cannot see the roster'; end if;

  select count(*) into n from prequal_submissions;
  if n > 0 then raise exception 'FAIL: a tech can read applicants'' credit scores'; end if;
  select count(*) into n from court_filings;
  if n > 0 then raise exception 'FAIL: a tech can read eviction filings'; end if;
  select count(*) into n from audit_log;
  if n > 0 then raise exception 'FAIL: a tech can read the audit trail'; end if;
  raise notice 'ok  a tech reads the shared line but not the sensitive files';
end $$;

-- 4. Nobody signed in can read a PIN. RLS cannot hide a column; a column grant
--    is what does it, and it has to actually be in place.
do $$
declare h text;
begin
  select pin_hash into h from staff limit 1;
  raise exception 'FAIL: a signed-in employee read a PIN hash';
exception when insufficient_privilege then
  raise notice 'ok  pin_hash is unreadable even by signed-in staff';
end $$;

-- 5. Clients read. They do not write. Every write in the application goes
--    through the service role or a security definer function, which is what
--    stops anyone filing a reply under somebody else's name.
do $$
declare blocked int := 0;
begin
  begin insert into contacts (phone) values ('+15555550188'); exception when others then blocked := blocked + 1; end;
  begin update conversations set subject = 'tampered';        exception when others then blocked := blocked + 1; end;
  begin delete from messages;                                  exception when others then blocked := blocked + 1; end;
  begin update staff set role = 'admin' where id = auth.uid(); exception when others then blocked := blocked + 1; end;
  if blocked < 4 then
    raise exception 'FAIL: a signed-in client could write directly (% of 4 refused)', blocked;
  end if;
  raise notice 'ok  writes are refused, including self-promotion to admin';
end $$;

-- 5b. ...except the one write staff genuinely do, which has to keep working.
--     A policy filters a privilege, it does not grant one, and a revoke that
--     swept up `notes` left the policy checking rows that could never be
--     offered. Nobody could write a note for as long as that stood.
do $$
declare c uuid;
begin
  insert into contacts (phone, full_name, party) values ('+15555550177','RLS Note Target','other')
    on conflict (phone) do nothing;
  select id into c from conversations limit 1;
  if c is null then
    insert into conversations (contact_id, category)
      select id, 'other' from contacts where phone = '+15555550177' returning id into c;
  end if;

  begin
    insert into notes (conversation_id, author_id, body)
      values (c, auth.uid(), 'a note typed by a person');
  exception when others then
    raise exception 'FAIL: a signed-in employee cannot write a note (%)', sqlerrm;
  end;
  raise notice 'ok  staff can write a note';

  -- ...and only ever under their own name.
  begin
    insert into notes (conversation_id, author_id, body)
      values (c, 'aaaaaaaa-0000-0000-0000-00000000c102', 'filed under somebody else');
    raise exception 'FAIL: a note was filed under another person''s name';
  exception when insufficient_privilege then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'ok  a note cannot be filed under someone else';
end $$;
reset role;

-- 6. An admin can reach what an admin is for.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000c102';
do $$
declare n int;
begin
  select count(*) into n from prequal_submissions;
  if n < 1 then raise exception 'FAIL: an admin cannot read submissions'; end if;
  select count(*) into n from court_filings;
  if n < 1 then raise exception 'FAIL: an admin cannot read court filings'; end if;
  select count(*) into n from audit_log;
  if n < 1 then raise exception 'FAIL: an admin cannot read the audit trail'; end if;
  raise notice 'ok  an admin reads submissions, filings and the audit trail';
end $$;
reset role;

do $$ begin
  raise notice '';
  raise notice 'all 7 checks passed';
end $$;

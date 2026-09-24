-- PIN sign-in — security checks
--
-- Run against a scratch database that has schema.sql loaded. Every one of these
-- is a property the sign-in depends on; if any raises, do not ship it.
--
--   createdb pincheck && psql -d pincheck -f schema.sql && psql -d pincheck -f pin-tests.sql
--
-- (schema.sql needs an `auth` schema with a users table and auth.uid(), which
-- Supabase provides; see the header of storage.sql.)

\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-00000000f001'),
  ('aaaaaaaa-0000-0000-0000-00000000f002'),
  ('aaaaaaaa-0000-0000-0000-00000000f003')
on conflict do nothing;

insert into staff (id, full_name, role) values
  ('aaaaaaaa-0000-0000-0000-00000000f001','Test Tech','tech'),
  ('aaaaaaaa-0000-0000-0000-00000000f002','Test Admin','admin'),
  ('aaaaaaaa-0000-0000-0000-00000000f003','Test NoPin','tech')
on conflict (id) do update set role = excluded.role, active = true;

\set QUIET off

do $$
declare
  TECH  uuid := 'aaaaaaaa-0000-0000-0000-00000000f001';
  ADMIN uuid := 'aaaaaaaa-0000-0000-0000-00000000f002';
  NOPIN uuid := 'aaaaaaaa-0000-0000-0000-00000000f003';
  GHOST uuid := 'dddddddd-0000-0000-0000-0000000dead0';
  p text; r record; i int; h text;
  t0 timestamptz; a numeric; b numeric;
begin
  -- 1. A PIN anyone would guess first is not a PIN.
  foreach p in array array['0000','1111','1234','4321','2580','123456','999999'] loop
    begin
      perform set_staff_pin(TECH, p);
      raise exception 'FAIL: accepted trivial PIN %', p;
    exception when others then
      if sqlerrm not like '%too easy%' then raise; end if;
    end;
  end loop;
  raise notice 'ok  trivial PINs refused';

  -- 2. Nor is something that is not four to eight digits.
  foreach p in array array['123','abcd','12 34','123456789',''] loop
    begin
      perform set_staff_pin(TECH, p);
      raise exception 'FAIL: accepted % as a PIN', p;
    exception when others then
      if sqlerrm not like '%4 to 8 digits%' then raise; end if;
    end;
  end loop;
  raise notice 'ok  malformed PINs refused';

  -- 3. Four digits is the wrong lock for the door that opens court filings.
  begin
    perform set_staff_pin(ADMIN, '8317');
    raise exception 'FAIL: an admin was given a PIN';
  exception when others then
    if sqlerrm not like '%field staff only%' then raise; end if;
  end;
  raise notice 'ok  admins cannot have a PIN';

  -- 4. What is stored is a bcrypt hash, not the PIN.
  perform set_staff_pin(TECH, '8317');
  select pin_hash into h from staff where id = TECH;
  if h = '8317' or h not like '$2%' then
    raise exception 'FAIL: PIN is not bcrypt-hashed (%)', h;
  end if;
  raise notice 'ok  stored as bcrypt';

  -- 5. The obvious one.
  select * into r from verify_staff_pin(TECH, '8317');
  if not r.ok then raise exception 'FAIL: correct PIN rejected'; end if;
  select * into r from verify_staff_pin(TECH, '8318');
  if r.ok then raise exception 'FAIL: wrong PIN accepted'; end if;
  raise notice 'ok  right PIN in, wrong PIN out';

  -- 6. Three different situations, one indistinguishable answer -- otherwise
  --    the sign-in page is a staff directory.
  select * into r from verify_staff_pin(GHOST, '8317');
  if r.ok or r.locked_until is not null then raise exception 'FAIL: ghost leaked'; end if;
  select * into r from verify_staff_pin(NOPIN, '8317');
  if r.ok or r.locked_until is not null then raise exception 'FAIL: no-PIN leaked'; end if;
  raise notice 'ok  unknown person answers like a wrong PIN';

  -- 7. ...including in how long it takes. A fast "no" is an answer too.
  update staff set pin_failures = 0, pin_locked_until = null where id = TECH;
  t0 := clock_timestamp();
  for i in 1..5 loop
    update staff set pin_failures = 0, pin_locked_until = null where id = TECH;
    perform verify_staff_pin(TECH, '0001');
  end loop;
  a := extract(epoch from clock_timestamp() - t0);
  t0 := clock_timestamp();
  for i in 1..5 loop perform verify_staff_pin(GHOST, '0001'); end loop;
  b := extract(epoch from clock_timestamp() - t0);
  if b < a * 0.5 then
    raise exception 'FAIL: timing oracle -- ghost % ms vs real % ms',
      round(b*200), round(a*200);
  end if;
  raise notice 'ok  no timing oracle (% ms vs % ms per try)', round(a*200), round(b*200);

  -- 8. The lockout is the thing that actually protects four digits, and it has
  --    to get longer or five tries a quarter-hour walks 10,000 PINs in ~10 days.
  update staff set pin_failures = 0, pin_locked_until = null where id = TECH;
  for i in 1..15 loop
    update staff set pin_locked_until = null where id = TECH;  -- observe the next tier
    select * into r from verify_staff_pin(TECH, '0001');
    if i = 5  and (r.locked_until is null or r.locked_until - now() > interval '16 minutes')
      then raise exception 'FAIL: 5th failure did not lock for ~15 minutes'; end if;
    if i = 10 and (r.locked_until is null or r.locked_until - now() < interval '50 minutes')
      then raise exception 'FAIL: 10th failure did not escalate to an hour'; end if;
    if i = 15 and (r.locked_until is null or r.locked_until - now() < interval '20 hours')
      then raise exception 'FAIL: 15th failure did not escalate to a day'; end if;
  end loop;
  raise notice 'ok  lockout escalates 15 min -> 1 hour -> 24 hours';

  -- 9. A locked account stays shut even for the person who knows the PIN.
  update staff set pin_failures = 5, pin_locked_until = now() + interval '15 minutes'
   where id = TECH;
  select * into r from verify_staff_pin(TECH, '8317');
  if r.ok then raise exception 'FAIL: correct PIN opened a locked account'; end if;
  if r.locked_until is null then raise exception 'FAIL: lock does not say when it lifts'; end if;
  raise notice 'ok  locked means locked';

  -- 10. And it resets cleanly, or every employee ends up permanently locked.
  update staff set pin_locked_until = now() - interval '1 second' where id = TECH;
  select * into r from verify_staff_pin(TECH, '8317');
  if not r.ok then raise exception 'FAIL: still locked after expiry'; end if;
  perform 1 from staff where id = TECH and pin_failures = 0 and pin_locked_until is null;
  if not found then raise exception 'FAIL: counter not reset on success'; end if;
  raise notice 'ok  expiry clears, success resets the counter';

  -- 11. The hour somebody leaves, both of these have to work.
  update staff set active = false where id = TECH;
  select * into r from verify_staff_pin(TECH, '8317');
  if r.ok then raise exception 'FAIL: a deactivated employee still signed in'; end if;
  update staff set active = true where id = TECH;

  perform clear_staff_pin(TECH);
  select * into r from verify_staff_pin(TECH, '8317');
  if r.ok then raise exception 'FAIL: a cleared PIN still worked'; end if;
  raise notice 'ok  deactivating and clearing both revoke';

  -- 12. None of it is worth much if it leaves no trace.
  perform 1 from audit_log where action = 'pin_failed' having count(*) > 0;
  if not found then raise exception 'FAIL: failures are not audited'; end if;
  perform 1 from audit_log where action = 'pin_signin' having count(*) > 0;
  if not found then raise exception 'FAIL: sign-ins are not audited'; end if;
  raise notice 'ok  every attempt is on the audit trail';

  raise notice '';
  raise notice 'all 12 checks passed';
end $$;

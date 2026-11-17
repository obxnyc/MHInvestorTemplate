-- 053: crew can have a PIN.
--
-- 038 added the crew role and never told the two functions that guard PINs.
-- Both still said "tech or shower", so a man added as Crew reached "pick your
-- PIN" on his setup link and was refused, and could never sign in at all --
-- the crew clock's whole sign-in was a door with no key. Found on the owner's
-- own first attempt, not by any check.
--
-- Both functions are the live definitions word for word, with 'crew' added to
-- the list. Office and admin still cannot have a PIN: four digits is not the
-- lock for accounts that reach the audit trail.
--
-- Safe to re-run.

create or replace function public.set_staff_pin(p_staff uuid, p_pin text)
returns void language plpgsql security definer as $function$
declare
  r staff_role;
begin
  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'A PIN is 4 to 8 digits';
  end if;
  if pin_is_trivial(p_pin) then
    raise exception 'That PIN is too easy to guess -- pick another';
  end if;
  select role into r from staff where id = p_staff and active;
  if r is null then
    raise exception 'No such active employee';
  end if;
  -- Never an admin or an office account. Those reach court filings and the
  -- audit trail, and four digits is not the right lock for that door.
  if r not in ('tech','shower','crew') then
    raise exception 'PIN sign-in is for field staff only; % uses an email link', r;
  end if;
  update staff
     set pin_hash = crypt(p_pin, gen_salt('bf', 12)), pin_set_at = now(),
         pin_failures = 0, pin_locked_until = null
   where id = p_staff;
end $function$;

create or replace function public.verify_staff_pin(p_staff uuid, p_pin text)
returns table(ok boolean, locked_until timestamp with time zone)
language plpgsql security definer as $function$
declare
  s        staff%rowtype;
  fails    integer;
  lock_for interval;
begin
  select * into s from staff where id = p_staff;

  if s.id is null or not s.active or s.pin_hash is null
     or s.role not in ('tech','shower','crew') then
    -- Burn the same ~250ms bcrypt an existing account would, against a throwaway
    -- hash. Returning instantly here would make the page a directory: a fast no
    -- means no such person, a slow no means wrong PIN.
    perform crypt(p_pin, gen_salt('bf', 12));
    return query select false, null::timestamptz;
    return;
  end if;

  if s.pin_locked_until is not null and s.pin_locked_until > now() then
    return query select false, s.pin_locked_until;
    return;
  end if;

  if s.pin_hash = crypt(p_pin, s.pin_hash) then
    update staff set pin_failures = 0, pin_locked_until = null where id = s.id;
    insert into audit_log (actor_id, entity, entity_id, action, changed)
    values (s.id, 'staff', s.id, 'pin_signin', jsonb_build_object('result', 'ok'));
    return query select true, null::timestamptz;
    return;
  end if;

  -- Wrong. Every fifth failure locks the account, and for longer each time:
  -- five guesses a quarter-hour would still walk a 4-digit PIN in about ten
  -- days, which is not a wall. This is.
  fails := s.pin_failures + 1;
  lock_for := case
    when fails % 5 <> 0 then null
    when fails < 10 then interval '15 minutes'
    when fails < 15 then interval '1 hour'
    else interval '24 hours'
  end;

  update staff
     set pin_failures = fails,
         pin_locked_until = case when lock_for is null then s.pin_locked_until
                                 else now() + lock_for end
   where id = s.id;

  -- Logged against the account, because a burst of these is how you find out
  -- someone is trying PINs on the office iPad.
  insert into audit_log (actor_id, entity, entity_id, action, changed)
  values (s.id, 'staff', s.id, 'pin_failed',
          jsonb_build_object('failures', fails, 'locked', lock_for is not null));

  return query select false,
    case when lock_for is null then null else now() + lock_for end;
end $function$;

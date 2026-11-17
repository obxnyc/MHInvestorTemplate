-- 072: the key Zillow presents when it delivers a lead.
--
-- Zillow's Lead API POSTs each rental lead to /api/intake/zillow and can be
-- configured to send one static header with it. That header's value is this
-- key. It is generated here, inside Postgres, and checked here, the same way
-- as the report schedule's key in 051 -- so it never has to be copied out of
-- one dashboard and into another.
--
-- Safe to re-run: the key is made only if it does not exist yet.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'zillow_lead_key') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'zillow_lead_key',
      'Sent by Zillow as the X-Zillow-Key header on every lead to /api/intake/zillow');
  end if;
end $$;

create or replace function public.zillow_lead_key_ok(k text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'zillow_lead_key' and decrypted_secret = k and length(k) >= 32
  );
$$;
revoke all on function public.zillow_lead_key_ok(text) from public, anon, authenticated;
grant execute on function public.zillow_lead_key_ok(text) to service_role;

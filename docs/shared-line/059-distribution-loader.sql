-- 059 One call to read a month's statements in.
--
-- The monthly read-in (docs/distributions-monthly.md) turns the accountant's
-- sheets into statements. Doing that as one INSERT per statement is thirty
-- statements of SQL a month and thirty places to get a column wrong, so it
-- is one function taking the month as JSON.
--
--   select distribution_load('2026-11-01', '[{ "name": ..., "lines": [[label, cents, date, merchant, category], ...], ... }]');
--
-- Lines are positional to keep the payload small. A statement already
-- emailed, or with a payment marked paid, is never overwritten: what was sent
-- is the record. A payee's email and bank days are kept if already set.
-- Service role only. Safe to re-run.

create or replace function distribution_load(p_month date, p_statements jsonb)
returns table (payee text, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r_id uuid;
  s jsonb;
  p_id uuid;
  locked boolean;
begin
  insert into distribution_runs (month) values (p_month) on conflict (month) do nothing;
  select id into r_id from distribution_runs where month = p_month;

  for s in select * from jsonb_array_elements(p_statements) loop
    insert into distribution_payees (name, emails, sheet_id)
    values (s->>'name', nullif(s->>'emails', ''), s->>'sheet')
    on conflict (name) do update
      set emails = coalesce(distribution_payees.emails, excluded.emails),
          sheet_id = coalesce(distribution_payees.sheet_id, excluded.sheet_id)
    returning id into p_id;

    select exists (
      select 1 from distribution_statements st
      where st.run_id = r_id and st.payee_id = p_id
        and (st.emailed_at is not null
             or exists (select 1 from distribution_payments dp where dp.statement_id = st.id and dp.paid_at is not null))
    ) into locked;
    if locked then
      payee := s->>'name'; outcome := 'left alone: already emailed or paid'; return next; continue;
    end if;

    insert into distribution_statements (
      run_id, payee_id, lines, title, previous_owed_cents, prior_paid_cents, prior_paid_on,
      deposits_cents, stated_net_cents, stated_owed_cents, owed_note, source, updated_at)
    values (
      r_id, p_id,
      coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'label', l->>0, 'cents', (l->>1)::int,
          'date', nullif(l->>2, ''), 'merchant', nullif(l->>3, ''), 'category', nullif(l->>4, ''))))
        from jsonb_array_elements(s->'lines') l), '[]'::jsonb),
      s->>'title', (s->>'prev')::int, (s->>'paid')::int, s->>'paidOn',
      (s->>'dep')::int, (s->>'snet')::int, (s->>'sowed')::int, s->>'note', s->'source', now())
    on conflict (run_id, payee_id) do update set
      lines = excluded.lines, title = excluded.title,
      previous_owed_cents = excluded.previous_owed_cents, prior_paid_cents = excluded.prior_paid_cents,
      prior_paid_on = excluded.prior_paid_on, deposits_cents = excluded.deposits_cents,
      stated_net_cents = excluded.stated_net_cents, stated_owed_cents = excluded.stated_owed_cents,
      owed_note = excluded.owed_note, source = excluded.source, updated_at = now();

    payee := s->>'name'; outcome := 'read in'; return next;
  end loop;
end $$;

revoke all on function distribution_load(date, jsonb) from public, anon, authenticated;

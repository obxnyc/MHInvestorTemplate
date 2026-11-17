-- 071: every version of a park's layout, kept.
--
-- The Retreat's sixty homes were put down and angled one at a time, by
-- hand, and properties.plan was the only copy: one button ("Clear all",
-- "Start over") or one stale browser tab saving over it, and the
-- afternoon was gone with nothing to put back.
--
-- A trigger rather than the route, so a write from anywhere -- the app,
-- the connector, the SQL editor -- leaves the old version behind. The
-- row kept is the plan BEFORE the change, so the newest history row plus
-- the live column is the whole story.

create table if not exists public.plan_history (
  id bigserial primary key,
  property_id uuid not null references public.properties(id) on delete cascade,
  plan jsonb,
  homes int,
  kept_at timestamptz not null default now()
);
create index if not exists plan_history_property
  on public.plan_history (property_id, kept_at desc);

alter table public.plan_history enable row level security;
revoke all on public.plan_history from anon, authenticated;

create or replace function public.keep_plan_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.plan is distinct from new.plan and old.plan is not null then
    insert into public.plan_history (property_id, plan, homes)
    values (old.id, old.plan,
      (select coalesce(sum(jsonb_array_length(r->'numbers')), 0)::int
         from jsonb_array_elements(coalesce(old.plan->'rows', '[]'::jsonb)) r));
  end if;
  return new;
end $$;

drop trigger if exists properties_plan_history on public.properties;
create trigger properties_plan_history
  before update of plan on public.properties
  for each row execute function public.keep_plan_history();

-- Today's layouts, as the first entry, so there is something to go back
-- to before anything changes. Only once: a re-run adds nothing.
insert into public.plan_history (property_id, plan, homes)
select p.id, p.plan,
  (select coalesce(sum(jsonb_array_length(r->'numbers')), 0)::int
     from jsonb_array_elements(coalesce(p.plan->'rows', '[]'::jsonb)) r)
from public.properties p
where p.plan is not null
  and not exists (select 1 from public.plan_history h where h.property_id = p.id);

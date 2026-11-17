-- 074: what we buy, per asset class and per area.
--
-- One row is one buy box: "mobile home parks, Sanford and east, 20-150
-- lots, up to $40k a lot". The same criteria will answer two questions --
-- what goes in a "here's what we buy" email to brokers, and (later) which
-- listings are worth a text -- so they are data, edited on the screen, and
-- never written into an email or a filter by hand.
--
-- Nothing here deletes: a box is switched off, not removed.

create table if not exists buy_boxes (
  id                 uuid primary key default gen_random_uuid(),
  asset_class        text not null check (asset_class in
                       ('mhp','multifamily','single_family','rv_park','land','self_storage','commercial','other')),
  area               text not null default '' ,       -- "Sanford and east", "Wake County", "SC"
  min_units          int,
  max_units          int,
  min_price          numeric,
  max_price          numeric,
  max_price_per_unit numeric,
  min_occupancy      numeric check (min_occupancy is null or (min_occupancy >= 0 and min_occupancy <= 100)),
  financing          text,                              -- "cash, bank, seller finance"
  wants              text,                              -- value-add we like
  avoids             text,                              -- deal-breakers
  notes              text,
  active             boolean not null default true,
  sort               int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references staff(id)
);

alter table buy_boxes enable row level security;
revoke all on buy_boxes from anon;
grant select, insert, update on buy_boxes to authenticated;
revoke delete on buy_boxes from authenticated;
drop policy if exists office_works_buy_boxes on buy_boxes;
create policy office_works_buy_boxes on buy_boxes for all
  using (staff_has_role('admin','office')) with check (staff_has_role('admin','office'));

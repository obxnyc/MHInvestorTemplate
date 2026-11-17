-- 068: the person behind an entity owner.
-- The 226 Ocean Trust is the investor -- on the lot, the papers and the
-- statements. Josh Barron is the person behind it, shown in small print.
-- Applied 17 November 2026 through the Supabase connector.
alter table owners add column if not exists contact_name text;
comment on column owners.contact_name is 'The person behind an entity owner (a trust, an LLC). Shown in small print under the owner''s name; never on the papers.';

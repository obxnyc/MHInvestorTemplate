-- 061 Owners paid as if their empty homes were let.
--
-- Some owners have an agreement: if we do not fill a home, we still pay the
-- distribution as though it had a tenant. Alex's sheet shows those homes with
-- costs and no rent, so the statement comes out short -- or negative -- and
-- the agreement is the thing that corrects it.
--
-- The rent to pay per empty home lives on the payee, so it is typed once and
-- applies every month. Empty: no such agreement. The lines it adds are
-- category "Guaranteed rent", so the screen can tell them from the sheet's
-- own and still check the sheet's figures.
--
-- The "Potential issue detected" warning is the `alter table ... add column`.
-- Nothing is removed. Safe to re-run.

alter table distribution_payees add column if not exists guaranteed_rent_cents integer
  check (guaranteed_rent_cents is null or guaranteed_rent_cents > 0);

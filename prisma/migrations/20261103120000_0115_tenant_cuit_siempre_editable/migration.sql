-- 0115_tenant_cuit_siempre_editable
--
-- User decision (2026-11-03, openspec/changes/cuit-farmacia-siempre-editable/):
-- the ADM may change the farmacia's CUIT at any time, not only until the
-- first cierre diario is signed. Signed cierre PDFs, libro recetario pages
-- and fichas keep reading the CUIT live from fsj.tenant, so after a change
-- they show the new one: accepted, and explained by a warning in the form.
--
-- Drops the 0105 trigger (INV-PL-005). Keeps 0105's GRANT UPDATE (cuit) to
-- fsj_app: it is what lets the app write the CUIT.
--
-- Rollback: prisma/rollbacks/0115_tenant_cuit_siempre_editable.down.sql.

DROP TRIGGER IF EXISTS trg_tenant_cuit_antes_primer_cierre ON fsj.tenant;
DROP FUNCTION IF EXISTS fsj.tenant_cuit_antes_primer_cierre();

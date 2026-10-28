-- Rollback of 0105_tenant_cuit_antes_primer_cierre (apply as a NEW forward migration).
-- The CUIT goes back to read-only for fsj_app (migration 0020's grant). A CUIT already changed stays as it is.
-- The code must be reverted too (docs/rollbacks/cuit-farmacia.md).

REVOKE UPDATE (cuit) ON fsj.tenant FROM fsj_app;

DROP TRIGGER IF EXISTS trg_tenant_cuit_antes_primer_cierre ON fsj.tenant;
DROP FUNCTION IF EXISTS fsj.tenant_cuit_antes_primer_cierre();

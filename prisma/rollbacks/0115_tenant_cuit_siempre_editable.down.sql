-- Rollback of 0115_tenant_cuit_siempre_editable (apply as a NEW forward migration).
-- Recreates migration 0105's trigger: the CUIT goes back to editable only while the tenant has no signed cierre
-- diario. A CUIT already changed stays as it is (the trigger only checks future updates).
-- The code must be reverted too (docs/rollbacks/cuit-farmacia.md).

CREATE OR REPLACE FUNCTION fsj.tenant_cuit_antes_primer_cierre()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = fsj, extensions
AS $$
BEGIN
  IF NEW.cuit IS DISTINCT FROM OLD.cuit
     AND EXISTS (SELECT 1 FROM fsj.cierre_diario c WHERE c.tenant_id = OLD.id) THEN
    RAISE EXCEPTION 'INV-PL-005: tenant cuit cannot change after its first cierre diario' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION fsj.tenant_cuit_antes_primer_cierre() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_tenant_cuit_antes_primer_cierre ON fsj.tenant;
CREATE TRIGGER trg_tenant_cuit_antes_primer_cierre
  BEFORE UPDATE OF cuit ON fsj.tenant
  FOR EACH ROW EXECUTE FUNCTION fsj.tenant_cuit_antes_primer_cierre();

COMMENT ON FUNCTION fsj.tenant_cuit_antes_primer_cierre() IS
  'INV-PL-005 (openspec/specs/cuit-farmacia/spec.md): fsj.tenant.cuit can change only while the tenant has no signed cierre diario.';

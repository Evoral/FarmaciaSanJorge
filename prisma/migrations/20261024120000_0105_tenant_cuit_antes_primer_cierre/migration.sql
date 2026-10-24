-- 0105_tenant_cuit_antes_primer_cierre
--
-- User decision (2026-10-24, docs/specs/cuit-farmacia.md): the ADM may set
-- the farmacia's CUIT from Configuración › Farmacia, but ONLY until the
-- tenant's first cierre diario is signed. A signed cierre's PDF reads the
-- CUIT live from fsj.tenant (modules/cierres/infrastructure/cierre-pdf.ts),
-- so changing it afterwards would silently rewrite already-signed legal
-- documents. Migration 0020 kept cuit out of fsj_app's column grant
-- altogether; this one grants it and moves the rule into a trigger.
--
-- The trigger applies to every role, owner included: a fsj.cierre_diario row
-- exists only once a cierre is signed, so "has a row" = "first cierre done".
-- Under fsj_app the EXISTS is RLS-scoped to the session tenant, which
-- fsj.tenant_forbid_cross_tenant_update (0020) already forces to be OLD.id.
--
-- Rollback: prisma/rollbacks/0105_tenant_cuit_antes_primer_cierre.down.sql.

GRANT UPDATE (cuit) ON fsj.tenant TO fsj_app;

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
  'INV-PL-005 (docs/specs/cuit-farmacia.md): fsj.tenant.cuit can change only while the tenant has no signed cierre diario.';

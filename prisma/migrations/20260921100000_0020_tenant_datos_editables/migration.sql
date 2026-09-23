-- 0020_tenant_datos_editables
--
-- FASE 3, point 3.10: lets an ADM edit their own tenant's institutional
-- data (razon_social, nombre_fantasia, domicilio, matricula_farmacia)
-- through fsj_app. Migration 0001 already granted UPDATE on ALL FIVE
-- columns it declared editable (razon_social, nombre_fantasia, domicilio,
-- matricula_farmacia, zona_horaria) -- this migration narrows that grant
-- to the FOUR the plan actually allows an ADM to change. zona_horaria is
-- deliberately excluded even though the earlier grant included it:
-- changing it would silently shift the jornada boundary
-- (fsj.jornada_actual(), used by cierre_diario_calcular_fuera_de_termino
-- and every "jornada de hoy" check) of every FUTURE legal date and break
-- the chronology of already-signed cierres. cuit, fecha_baja and
-- fecha_activacion_contralor were never granted and stay that way (cuit is
-- a legal identifier; fecha_baja is a platform-operator lifecycle field;
-- fecha_activacion_contralor is its own future flow that requires opening
-- balances -- task instruction).
--
-- fsj.tenant is a GLOBAL table (no tenant_id column of its own, no RLS --
-- it IS the tenant boundary that every other table's tenant_id points
-- at). Without a guard, fsj_app could UPDATE ANY tenant's row by id, not
-- just the row of the tenant set on the current session -- RLS cannot
-- express "this row IS the session's tenant" the way tenant_id-keyed
-- policies do elsewhere (fsj.setup_tenant_table does not apply to this
-- table). The trigger below is that guard: it rejects any fsj_app UPDATE
-- where id <> fsj.current_tenant_id() (the tenant fsj_app's own
-- withTenantTransaction set for the current transaction), independent of
-- which columns are being changed. fsj_owner (migrations, seed scripts,
-- the future contralor-activation flow) is intentionally NOT restricted
-- by this trigger -- it is already fully trusted and may run without a
-- tenant context (e.g. scripts/create-tenant.ts).

REVOKE UPDATE ON fsj.tenant FROM fsj_app;
GRANT UPDATE (razon_social, nombre_fantasia, domicilio, matricula_farmacia)
  ON fsj.tenant TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.tenant_forbid_cross_tenant_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'INV-PL-004: tenant id cannot be modified' USING ERRCODE = 'P0001';
  END IF;

  IF current_user = 'fsj_app'
     AND (fsj.current_tenant_id() IS NULL OR fsj.current_tenant_id() IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'INV-PL-004: fsj_app cannot update a tenant row other than the current session tenant' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_forbid_cross_tenant_update ON fsj.tenant;
CREATE TRIGGER trg_tenant_forbid_cross_tenant_update
  BEFORE UPDATE ON fsj.tenant
  FOR EACH ROW EXECUTE FUNCTION fsj.tenant_forbid_cross_tenant_update();

COMMENT ON FUNCTION fsj.tenant_forbid_cross_tenant_update() IS
  'INV-PL-004 (FASE 3 point 3.10): fsj.tenant has no RLS (global table) -- this trigger is the only guard against fsj_app updating a tenant row other than the one set by withTenantTransaction for the current session. fsj_owner is not restricted.';

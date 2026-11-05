-- 0119 -- RLS on fsj.tenant (security audit P1-02, docs/auditoria/informes/parte-1.md).
--
-- Until now fsj.tenant had no RLS (0001: "this IS the tenant boundary"), so fsj_app could SELECT every pharmacy's row
-- (CUIT, razón social, teléfonos, domicilio, logo). Nothing exploited it, but one unfiltered query would have leaked
-- another client's data. The only legitimate cross-tenant reader was the two daily jobs listing the active tenants.
--
--   1. fsj.listar_tenants_activos(): SECURITY DEFINER, ids ONLY (never the other columns). The jobs
--      (modules/archivo/application/actualizar-plazos.ts, modules/entregas/application/vencer-retiros.ts) call it from
--      withPlatformTransaction, where app.tenant_id is unset.
--   2. fsj.tenant gets RLS enabled + forced and the standard tenant_isolation policy, keyed on the row's own id.
--      The owner (postgres, BYPASSRLS) is unaffected: migrations, scripts/create-tenant.ts and SECURITY DEFINER
--      functions keep seeing every row.
--
-- Every other reader already runs inside withTenantTransaction and reads its own tenant's row, so it is unchanged.
-- The invoker functions that read fsj.tenant (jornada_actual, relevamiento_inicial_abierto,
-- movimiento_stock_validar_contralor, movimiento_stock_validar_vale) are always called with the transaction's own
-- tenant id. trg_tenant_forbid_cross_tenant_update (0020) stays as a second barrier: under RLS a cross-tenant UPDATE
-- now matches zero rows before the trigger can fire.
--
-- *** APPLY 0119 TOGETHER WITH THE CODE THAT CALLS fsj.listar_tenants_activos(). ***
-- Between the two, the old jobs' unscoped read sees zero tenants and does nothing (no error, no data change).
-- Rollback: prisma/rollbacks/0119_tenant_rls.down.sql (as a NEW forward migration).

CREATE OR REPLACE FUNCTION fsj.listar_tenants_activos()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
  SELECT id FROM fsj.tenant WHERE fecha_baja IS NULL ORDER BY creado_en, id;
$$;

REVOKE ALL ON FUNCTION fsj.listar_tenants_activos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.listar_tenants_activos() TO fsj_app;

COMMENT ON FUNCTION fsj.listar_tenants_activos() IS
  '0119 (P1-02). Ids of every active tenant (fecha_baja IS NULL), for the daily jobs that run without app.tenant_id. Returns ids only: fsj.tenant itself is RLS-scoped to the current tenant.';

ALTER TABLE fsj.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsj.tenant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fsj.tenant;
CREATE POLICY tenant_isolation ON fsj.tenant
  USING (id = fsj.current_tenant_id())
  WITH CHECK (id = fsj.current_tenant_id());

COMMENT ON TABLE fsj.tenant IS
  'Platform-level table (M00): one row per pharmacy tenant. RLS since 0119 (P1-02): fsj_app sees only the row whose id is app.tenant_id; the jobs list active tenants through fsj.listar_tenants_activos().';

-- Rollback of 0119_tenant_rls (apply as a NEW forward migration). Revert the code FIRST (docs/rollbacks/tenant-rls.md):
-- the jobs stop calling fsj.listar_tenants_activos() before it is dropped.
-- Reopens P1-02: fsj_app can read every tenant's row again. No data is lost.

DROP POLICY IF EXISTS tenant_isolation ON fsj.tenant;
ALTER TABLE fsj.tenant NO FORCE ROW LEVEL SECURITY;
ALTER TABLE fsj.tenant DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS fsj.listar_tenants_activos();

COMMENT ON TABLE fsj.tenant IS
  'Platform-level table (M00): one row per pharmacy tenant. No tenant_id, no RLS -- this IS the tenant boundary, not a tenant-scoped table.';

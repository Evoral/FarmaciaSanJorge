-- 0122 -- A query without app.tenant_id fails loudly (security audit P1-09, docs/auditoria/informes/parte-6.md).
--
-- fsj.current_tenant_id() returned NULL when app.tenant_id was not set, so every RLS policy
-- (tenant_id = fsj.current_tenant_id()) hid every row: a query run outside withTenantTransaction showed an empty
-- list, and an UPDATE/DELETE silently changed nothing. The bug looked like an empty pharmacy. Now it raises
-- SQLSTATE TN001.
--
--   1. fsj.tenant_no_fijado(): raises TN001. No INV- token on purpose: shared/errors#mapDbError maps it to
--      INTERNAL_ERROR (logged as an error, generic message to the user), because it is a programming bug, not a
--      business rule.
--   2. fsj.current_tenant_id(): still one SQL expression (so Postgres keeps inlining it into the 61 policies and the
--      tenant_id indexes keep being used). coalesce only calls tenant_no_fijado() when the setting is missing.
--   3. fsj.tenant_id_o_null(): the old NULL-returning behaviour, for the one caller that must tell "no tenant" apart
--      without failing: trg_tenant_forbid_cross_tenant_update (0020). Owner scripts (scripts/create-tenant.ts)
--      update fsj.tenant with no tenant set, and Postgres does not guarantee that `current_user = 'fsj_app'` is
--      evaluated before the other side of the AND.
--
-- Unaffected, checked on 2026-11-05: the owner (postgres, BYPASSRLS) never evaluates policies; the login and session
-- resolvers and fsj.listar_tenants_activos() are SECURITY DEFINER; /api/health runs SELECT 1; the views are
-- security_invoker. cierre_diario_firmar and libro_configurar_numeracion still refuse a call without a tenant, now with
-- TN001 instead of their own message.
-- Limit: the error only fires when a policy is evaluated on a row; a table with no rows for that query returns empty.
--
-- No code change: apply it any time (dev first, then `npm run test:db`).
-- Rollback: prisma/rollbacks/0122_tenant_obligatorio.down.sql (as a NEW forward migration).

CREATE OR REPLACE FUNCTION fsj.tenant_no_fijado()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RAISE EXCEPTION 'fsj: app.tenant_id is not set (query outside withTenantTransaction)'
    USING ERRCODE = 'TN001',
          HINT = 'Run it through defineQuery/defineCommand or withTenantTransaction.';
END;
$$;

COMMENT ON FUNCTION fsj.tenant_no_fijado() IS
  '0122 (P1-09). Raises TN001: a tenant-scoped query ran with no app.tenant_id. Called only by fsj.current_tenant_id().';

CREATE OR REPLACE FUNCTION fsj.tenant_id_o_null()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION fsj.tenant_id_o_null() IS
  '0122 (P1-09). app.tenant_id or NULL, never raises. Only for code that must detect "no tenant" (trg_tenant_forbid_cross_tenant_update); everything else uses fsj.current_tenant_id().';

REVOKE ALL ON FUNCTION fsj.tenant_no_fijado() FROM PUBLIC;
REVOKE ALL ON FUNCTION fsj.tenant_id_o_null() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.tenant_no_fijado() TO fsj_app;
GRANT EXECUTE ON FUNCTION fsj.tenant_id_o_null() TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(current_setting('app.tenant_id', true), '')::uuid, fsj.tenant_no_fijado());
$$;

COMMENT ON FUNCTION fsj.current_tenant_id() IS
  'Returns the tenant id set via set_config(''app.tenant_id'', ..., true) for the current transaction. Raises TN001 when unset (0122, P1-09). Used by every RLS policy (INV-T01).';

CREATE OR REPLACE FUNCTION fsj.tenant_forbid_cross_tenant_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'INV-PL-004: tenant id cannot be modified' USING ERRCODE = 'P0001';
  END IF;

  IF current_user = 'fsj_app'
     AND (fsj.tenant_id_o_null() IS NULL OR fsj.tenant_id_o_null() IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'INV-PL-004: fsj_app cannot update a tenant row other than the current session tenant' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

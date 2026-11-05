-- Rollback of 0122_tenant_obligatorio (apply as a NEW forward migration). No code depends on it.
-- Reopens P1-09: a query without app.tenant_id goes back to seeing zero rows instead of failing. No data is lost.

CREATE OR REPLACE FUNCTION fsj.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION fsj.current_tenant_id() IS
  'Returns the tenant id set via set_config(''app.tenant_id'', ..., true) for the current transaction, or NULL if unset. Used by RLS policies (INV-T01).';

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

DROP FUNCTION IF EXISTS fsj.tenant_no_fijado();
DROP FUNCTION IF EXISTS fsj.tenant_id_o_null();

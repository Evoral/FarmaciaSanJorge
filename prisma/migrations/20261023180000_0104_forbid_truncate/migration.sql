-- 0104_forbid_truncate
--
-- Security audit finding P3-06. Row-level BEFORE UPDATE/DELETE triggers
-- (fsj.forbid_update_delete, fsj.forbid_delete) do not fire on TRUNCATE.
-- fsj_app has no TRUNCATE grant on these tables (tests/db/grants-finales.test.ts),
-- so this guards against an accidental TRUNCATE by the owner or an admin role:
-- every fsj table protected by either function also refuses TRUNCATE
-- (statement-level trigger). An owner can still bypass it on purpose
-- (DISABLE TRIGGER / session_replication_role): this is a guard, not a control.
--
-- Tables are taken from the catalog (the same rule as fsj.v_grants_legal), so
-- re-running is idempotent. A table protected later needs its own
-- `CREATE TRIGGER ... BEFORE TRUNCATE ... fsj.forbid_truncate()`.
--
-- Code-independent. Rollback: prisma/rollbacks/0104_forbid_truncate.down.sql.

CREATE OR REPLACE FUNCTION fsj.forbid_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = fsj, extensions
AS $$
BEGIN
  RAISE EXCEPTION 'INV-IMMUTABLE: table % is immutable, TRUNCATE is not allowed', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE EXECUTE ON FUNCTION fsj.forbid_truncate() FROM PUBLIC;

COMMENT ON FUNCTION fsj.forbid_truncate() IS
  'BEFORE TRUNCATE FOR EACH STATEMENT trigger on every table protected by forbid_update_delete/forbid_delete (migration 0104, audit P3-06).';

DO $$
DECLARE
  v_tabla text;
BEGIN
  FOR v_tabla IN
    SELECT DISTINCT c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relnamespace = 'fsj'::regnamespace
      AND c.relkind = 'r'
      AND NOT t.tgisinternal
      AND p.pronamespace = 'fsj'::regnamespace
      AND p.proname IN ('forbid_update_delete', 'forbid_delete')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_forbid_truncate ON fsj.%I', v_tabla, v_tabla);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_forbid_truncate BEFORE TRUNCATE ON fsj.%I FOR EACH STATEMENT EXECUTE FUNCTION fsj.forbid_truncate()',
      v_tabla, v_tabla
    );
  END LOOP;
END;
$$;

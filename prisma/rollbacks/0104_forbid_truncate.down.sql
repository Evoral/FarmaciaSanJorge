-- Rollback of migration 0104: drops every BEFORE TRUNCATE guard and fsj.forbid_truncate().

DO $$
DECLARE
  v_trigger record;
BEGIN
  FOR v_trigger IN
    SELECT t.tgname, c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE p.oid = to_regprocedure('fsj.forbid_truncate()')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON fsj.%I', v_trigger.tgname, v_trigger.relname);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS fsj.forbid_truncate();

-- 0017_grants_finales
--
-- FASE 1, point 1.15: final grants pass for every "legal" table (the ones
-- whose integrity IS the point of FASE 1.12-1.14 -- INV-X01) + a queryable
-- enumeration (fsj.v_grants_legal) that the DB test in tests/db/ uses to
-- assert fsj_app has NO UPDATE/DELETE beyond the explicitly allowed
-- columns, rather than re-deriving the allow-list purely in TypeScript.
--
-- Every REVOKE below is a defensive, idempotent RE-ASSERTION of grants
-- already set by the table's own migration (0003, 0008, 0012, 0014, 0015)
-- -- nothing here changes prior behavior; it exists so this ONE migration
-- is the single place that documents "these are the legal tables and this
-- is exactly what fsj_app may write on each of them".

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.registro_auditoria FROM fsj_app;
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.movimiento_stock FROM fsj_app;
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.ficha_tecnica FROM fsj_app;
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.linea_pesaje FROM fsj_app;
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.asiento_recetario FROM fsj_app;
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.detalle_asiento FROM fsj_app;
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.anulacion_asiento FROM fsj_app;
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.asiento_historico FROM fsj_app;
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.asiento_contralor FROM fsj_app;
REVOKE INSERT, DELETE, TRUNCATE ON fsj.cierre_diario FROM fsj_app;
REVOKE INSERT, UPDATE ON fsj.contador_correlativo FROM fsj_app;

-- libro_rubricado keeps its single allowed UPDATE column (fecha_cierre);
-- everything else (including DELETE) stays revoked -- re-asserted here.
REVOKE DELETE, TRUNCATE ON fsj.libro_rubricado FROM fsj_app;

-- ============================================================================
-- fsj.v_grants_legal: enumerates, straight from the Postgres catalogs
-- (has_table_privilege / has_column_privilege for role fsj_app), exactly
-- what fsj_app may currently UPDATE/DELETE on every legal table. The DB
-- test compares this against a hardcoded allow-list -- if a future
-- migration accidentally widens a grant, this view (and therefore the
-- test) catches it without needing to know the mechanism (GRANT vs missing
-- REVOKE vs a table-level default) that caused the widening.
-- ============================================================================
DROP VIEW IF EXISTS fsj.v_grants_legal;

CREATE VIEW fsj.v_grants_legal
WITH (security_invoker = true) AS
SELECT
  c.relname AS tabla,
  has_table_privilege('fsj_app', c.oid, 'DELETE') AS delete_permitido,
  coalesce(
    (SELECT array_agg(a.attname::text ORDER BY a.attname)
     FROM pg_attribute a
     WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege('fsj_app', c.oid, a.attnum, 'UPDATE')),
    ARRAY[]::text[]
  )::text[] AS columnas_update
FROM pg_class c
WHERE c.relnamespace = 'fsj'::regnamespace
  AND c.relkind = 'r'
  AND c.relname IN (
    'registro_auditoria', 'movimiento_stock', 'ficha_tecnica', 'linea_pesaje',
    'contador_correlativo', 'libro_rubricado', 'asiento_recetario', 'detalle_asiento',
    'anulacion_asiento', 'asiento_historico', 'asiento_contralor', 'cierre_diario'
  );

COMMENT ON VIEW fsj.v_grants_legal IS
  'INV-X01 (FASE 1 point 1.15): enumerates the legal tables and exactly what fsj_app may UPDATE/DELETE on each, read from the Postgres catalogs. See tests/db/grants-finales.test.ts.';

GRANT SELECT ON fsj.v_grants_legal TO fsj_app;

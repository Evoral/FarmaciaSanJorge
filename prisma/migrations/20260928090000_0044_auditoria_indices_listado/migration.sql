-- 0044_auditoria_indices_listado
--
-- Read-path indexes for the /auditoria viewer (M01/M03, FASE 3 point 3.11).
-- No new tables or columns, so no GRANT/REVOKE statements are needed (same
-- as migration 0043).
--
-- The viewer paginates by keyset over ORDER BY ocurrido_en DESC, id DESC
-- (modules/auditoria/infrastructure/auditoria-repository.ts), but none of
-- migration 0003's indexes can serve that order for the two most common
-- requests -- all three lead with a filter column after tenant_id:
--   (tenant_id, entidad, entidad_id, ocurrido_en)
--   (tenant_id, usuario_id, ocurrido_en)
--   (tenant_id, accion, ocurrido_en)
-- so the default, unfiltered view (and a date-only filter) read and sort
-- EVERY row of the tenant on each page load, and a filter by entidad
-- without entidad_id sorts every row of that entidad. registro_auditoria
-- is never purged (INV-A02), so that cost grows forever.
--
--   1. (tenant_id, ocurrido_en DESC, id DESC): unfiltered view, date
--      range, and every "Cargar mas" page -- an index range scan that stops
--      after pageSize + 1 rows.
--   2. (tenant_id, entidad, ocurrido_en DESC, id DESC): entidad filter.
--
-- CREATE INDEX IF NOT EXISTS, NOT CONCURRENTLY -- this migration runs
-- inside Prisma's implicit per-file transaction, and CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction block (same as 0043).

CREATE INDEX IF NOT EXISTS idx_registro_auditoria_tenant_fecha
  ON fsj.registro_auditoria (tenant_id, ocurrido_en DESC, id DESC);

COMMENT ON INDEX fsj.idx_registro_auditoria_tenant_fecha IS
  'Keyset pagination of /auditoria (ORDER BY ocurrido_en DESC, id DESC per tenant): unfiltered view, date range filter, "Cargar mas" pages.';

CREATE INDEX IF NOT EXISTS idx_registro_auditoria_tenant_entidad_fecha
  ON fsj.registro_auditoria (tenant_id, entidad, ocurrido_en DESC, id DESC);

COMMENT ON INDEX fsj.idx_registro_auditoria_tenant_entidad_fecha IS
  'Keyset pagination of /auditoria filtered by entidad (without entidad_id).';

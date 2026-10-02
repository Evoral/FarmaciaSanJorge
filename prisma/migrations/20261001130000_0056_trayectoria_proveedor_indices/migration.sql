-- 0056_trayectoria_proveedor_indices
--
-- Read-path index for the per-proveedor "Trayectoria" view
-- (docs/specs/trayectoria-proveedor.md, modules/proveedores/infrastructure/
-- trayectoria-repository.ts). No new tables, columns, data changes or
-- GRANT/REVOKE statements (same as migrations 0043/0044/0051). ADDITIVE
-- ONLY, and PERFORMANCE ONLY: the view returns the same rows with or without
-- this index, it just reads them faster -- so the code does not depend on it
-- being applied first. Rollback is
-- `prisma/rollbacks/0056_trayectoria_proveedor_indices.down.sql` (applied as
-- a NEW forward migration, since prisma migrate has no "down"; full steps in
-- docs/rollbacks/trayectoria-proveedor.md).
--
-- The view reads "the partidas of ONE proveedor, newest first" (page of 10 by
-- `fecha_ingreso DESC, id DESC`) plus per-proveedor counters over all of
-- them. The existing indexes on fsj.partida all lead with another column:
--   uq (tenant_id, id), uq (tenant_id, droga_id, proveedor_id, lote) and
--   idx_partida_tenant_droga (tenant_id, droga_id, 0043).
-- Nothing starts with (tenant_id, proveedor_id), so without this index the
-- page and the counters are a scan of every partida of the tenant.
--
--   partida (tenant_id, proveedor_id, fecha_ingreso DESC): the newest-first
--   page is an index range scan, and the counters read only this proveedor's
--   rows. The `id DESC` tie-break of the ORDER BY is resolved by a cheap
--   incremental sort over rows that share a fecha_ingreso.
--
-- Already covered, so NOT indexed here: movimiento_stock
-- (idx_movimiento_stock_tenant_partida_fecha, 0043: the per-partida movement
-- list), asiento_contralor (UNIQUE movimiento_stock_id), preparacion (PK /
-- UNIQUE tenant_id, id) and registro_auditoria
-- (idx_registro_auditoria_tenant_entidad_fecha, 0044).
--
-- CREATE INDEX IF NOT EXISTS, NOT CONCURRENTLY -- this migration runs inside
-- Prisma's implicit per-file transaction, and CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block (same as 0043/0044/0051).
--
-- Numbering: 0056 is the next free number in this repository after
-- 0055_paciente_recordatorios_whatsapp. Another developer's 0051..0054 are
-- not in this repository (see the header of 0055).

CREATE INDEX IF NOT EXISTS idx_partida_tenant_proveedor_ingreso
  ON fsj.partida (tenant_id, proveedor_id, fecha_ingreso DESC);

COMMENT ON INDEX fsj.idx_partida_tenant_proveedor_ingreso IS
  'Trayectoria del proveedor (0056): partidas of one proveedor, newest first (fecha_ingreso DESC), plus its per-proveedor counters.';

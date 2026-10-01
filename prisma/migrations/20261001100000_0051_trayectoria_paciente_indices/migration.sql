-- 0051_trayectoria_paciente_indices
--
-- Read-path indexes for the per-paciente "Trayectoria" view
-- (docs/specs/trayectoria-paciente.md, modules/pacientes/infrastructure/
-- trayectoria-repository.ts). No new tables, columns, data changes or
-- GRANT/REVOKE statements (same as migrations 0043/0044). ADDITIVE ONLY:
-- rollback is `prisma/rollbacks/0051_trayectoria_paciente_indices.down.sql`
-- (applied as a NEW forward migration, since prisma migrate has no "down";
-- full steps in docs/rollbacks/trayectoria-paciente.md).
--
-- The view walks paciente -> receta -> item_receta -> preparacion, and none
-- of the existing indexes leads with the column it filters on:
--   receta           : only UNIQUE (tenant_id, id), (tenant_id, numero_interno)
--                      and the partial uq_receta_emisor_nro_vigente. Nothing
--                      starts with (tenant_id, paciente_id), so "this
--                      paciente's recetas" (page + counters) is a seq scan
--                      of every receta of the tenant.
--   item_receta      : only UNIQUE (tenant_id, id). "Items of these recetas"
--                      (IN list) is a seq scan.
--   preparacion      : uq_preparacion_ficha_activa (tenant_id, ficha_tecnica_id
--                      WHERE estado <> 'DESCARTADA') and
--                      uq_preparacion_item_confirmada (tenant_id, item_receta_id
--                      WHERE estado = 'CONFIRMADA'). Both are PARTIAL, so the
--                      planner cannot use them for "every preparacion of these
--                      items" (INICIADA and DESCARTADA rows are not in them).
-- Already covered, so NOT indexed here: ficha_tecnica (UNIQUE tenant_id,
-- item_receta_id, version), componente_item_receta (UNIQUE tenant_id,
-- item_receta_id, orden), cotizacion (cotizacion_item_receta_calculada_idx,
-- 0031), entrega (UNIQUE receta_id), asiento_recetario
-- (uq_asiento_recetario_preparacion / _rectificativo_unico, 0014: usable
-- because the view always filters origen = 'SISTEMA' / 'RECTIFICATIVO').
--
--   1. receta (tenant_id, paciente_id, fecha_ingreso DESC): the newest-first
--      page (ORDER BY fecha_ingreso DESC) is an index range scan, and the
--      per-paciente counters read only this paciente's rows.
--   2. item_receta (tenant_id, receta_id)
--   3. preparacion (tenant_id, item_receta_id)
--
-- CREATE INDEX IF NOT EXISTS, NOT CONCURRENTLY -- this migration runs inside
-- Prisma's implicit per-file transaction, and CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block (same as 0043/0044).

CREATE INDEX IF NOT EXISTS idx_receta_tenant_paciente_ingreso
  ON fsj.receta (tenant_id, paciente_id, fecha_ingreso DESC);

COMMENT ON INDEX fsj.idx_receta_tenant_paciente_ingreso IS
  'Trayectoria del paciente (0051): recetas of one paciente, newest first (fecha_ingreso DESC), plus its per-paciente counters.';

CREATE INDEX IF NOT EXISTS idx_item_receta_tenant_receta
  ON fsj.item_receta (tenant_id, receta_id);

COMMENT ON INDEX fsj.idx_item_receta_tenant_receta IS
  'Trayectoria del paciente (0051): items of a set of recetas (IN list), no FK-side index existed.';

CREATE INDEX IF NOT EXISTS idx_preparacion_tenant_item_receta
  ON fsj.preparacion (tenant_id, item_receta_id);

COMMENT ON INDEX fsj.idx_preparacion_tenant_item_receta IS
  'Trayectoria del paciente (0051): every preparacion (any estado) of a set of items; the existing item_receta indexes are partial (CONFIRMADA only).';

-- 0077_preparacion_viva_por_item
--
-- docs/specs/reserva-stock-preparacion.md R19: at most ONE live preparacion
-- (INICIADA or CONFIRMADA) per item_receta, across all of its ficha versions.
-- Defense in depth for reservarStockPreparacion, which checks it under the
-- receta + item_receta locks: INV-P02 (uq_preparacion_ficha_activa, 0013) is
-- per FICHA, so a stale dialog on an older ficha version could start a second
-- INICIADA preparacion for the same item and hold stock forever.
-- Subsumes INV-PRP-003 (uq_preparacion_item_confirmada) for live rows; that
-- index is kept unchanged.
--
-- *** FAILS if duplicates already exist. Find them first and discard/release
-- the extra INICIADA ones (Liberar reserva / Descartar) before applying: ***
--   SELECT tenant_id, item_receta_id, array_agg(id || ':' || estado) AS preparaciones
--   FROM fsj.preparacion
--   WHERE estado IN ('INICIADA', 'CONFIRMADA')
--   GROUP BY tenant_id, item_receta_id
--   HAVING count(*) > 1;
--
-- Rollback: prisma/rollbacks/0077_preparacion_viva_por_item.down.sql (as a NEW
-- forward migration).

CREATE UNIQUE INDEX IF NOT EXISTS uq_preparacion_item_viva
  ON fsj.preparacion (tenant_id, item_receta_id)
  WHERE estado IN ('INICIADA', 'CONFIRMADA');

COMMENT ON INDEX fsj.uq_preparacion_item_viva IS
  '0077. At most one live (INICIADA or CONFIRMADA) preparacion per item_receta, any ficha version (docs/specs/reserva-stock-preparacion.md R19).';

-- 0121 -- Indexes for the queries that read a child by its parent (security audit P1-10, docs/auditoria/informes/parte-6.md).
--
-- The audit counted the composite FKs (tenant_id, x_id) with no covering index (77 as of 0120). Postgres indexes the
-- parent side of a FK, never the child side, so "children of this parent" scans the whole tenant slice. Most of those
-- FKs are actor columns (*_por_id) nobody filters by; indexing them would only slow every write. These are the ones a
-- real query (app code or a trigger) filters by, checked one by one against the code on 2026-11-05:
--
--   asiento_recetario / asiento_contralor, pending asientos (estado VIGENTE, no cierre yet): the layout banner
--     (cierre-repository#getResumenPendientes, every page load), listJornadasPendientes and fsj.cierre_diario_firmar.
--     Partial: it only holds the unsigned asientos, so it stays small while the libro grows forever.
--   asiento_recetario (tenant_id, fecha_asiento): the cierre reads a day's asientos (cierre-repository) and the libro
--     search filters by date range (asiento-repository). No index by date existed.
--   movimiento_stock (tenant_id, linea_pesaje_id): fsj.linea_pesaje_validar_consumo, on every confirmed preparación.
--   movimiento_stock (tenant_id, preparacion_id): the cierre's contralor detail (preparación -> its egresos).
--   receta (tenant_id, medico_id): the preparaciones list filtered by médico.
--   receta (tenant_id, lote_archivo_id): conformar lote looks up the recetas with no lote yet (IS NULL).
--   sesion (tenant_id, usuario_id), active only: revoking a usuario's sessions (password change, suspension, baja).
--   elaboracion_lote (tenant_id, formula_id): the FK check when a fórmula is deleted.
--
-- Nullable FKs that are only looked up by value get a partial `IS NOT NULL` index, like
-- idx_movimiento_stock_elaboracion_lote (most movimientos have neither a línea nor a preparación).
-- Partial indexes live only here (Prisma cannot express them); the plain ones are mirrored in schema.prisma.
--
-- No CONCURRENTLY: Prisma runs each migration in a transaction, and at the current volume (largest table ~2,000 rows)
-- the write lock while each index builds lasts milliseconds.
--
-- No code change: apply it any time. Rollback: prisma/rollbacks/0121_indices_consultas.down.sql (as a NEW forward migration).

CREATE INDEX IF NOT EXISTS idx_asiento_recetario_pendientes
  ON fsj.asiento_recetario (tenant_id, fecha_asiento)
  WHERE estado = 'VIGENTE' AND cierre_diario_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_asiento_contralor_pendientes
  ON fsj.asiento_contralor (tenant_id, fecha_asiento)
  WHERE estado = 'VIGENTE' AND cierre_diario_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_asiento_recetario_tenant_fecha
  ON fsj.asiento_recetario (tenant_id, fecha_asiento);

CREATE INDEX IF NOT EXISTS idx_movimiento_stock_linea_pesaje
  ON fsj.movimiento_stock (tenant_id, linea_pesaje_id)
  WHERE linea_pesaje_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movimiento_stock_preparacion
  ON fsj.movimiento_stock (tenant_id, preparacion_id)
  WHERE preparacion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receta_tenant_medico
  ON fsj.receta (tenant_id, medico_id);

CREATE INDEX IF NOT EXISTS idx_receta_tenant_lote_archivo
  ON fsj.receta (tenant_id, lote_archivo_id);

CREATE INDEX IF NOT EXISTS idx_sesion_usuario_activas
  ON fsj.sesion (tenant_id, usuario_id)
  WHERE revocada_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_elaboracion_lote_formula
  ON fsj.elaboracion_lote (tenant_id, formula_id)
  WHERE formula_id IS NOT NULL;

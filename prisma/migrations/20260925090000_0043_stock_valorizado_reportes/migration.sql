-- 0043_stock_valorizado_reportes
--
-- FASE 13, points 13.1-13.4 (M16): reportes y tablero. This migration only
-- touches the permission catalog and adds two read-path indexes -- no new
-- tables, no new columns, so no GRANT/REVOKE statements are needed (same
-- as migration 0040, which only seeded rows).
--
-- Two independent additions:
--   1. New permiso `stock.valorizado.ver` (user decision 2, 2026-09-25):
--      the stock valorizado report (13.2) shows droga-level costo_unitario
--      aggregated into money-like totals -- a step up from `stock.ver`'s
--      plain quantity view -- so it gets its own permiso, seeded ONLY for
--      ADMINISTRADOR, DIRECTOR_TECNICO, FARMACEUTICO (not ATENCION_PUBLICO,
--      not SOLO_CONSULTA). Mirrored in modules/auth/domain/permisos.ts and
--      tests/db/auth-permisos.test.ts so the seed==TS bidirectional test
--      keeps holding both ways.
--   2. Supporting indexes for the new heavy aggregates (stock valorizado,
--      kardex report): `fsj.partida(tenant_id, droga_id)` (valorizado
--      groups/filters by droga per tenant; today only the WIDER
--      `partida_lote_unico UNIQUE (tenant_id, droga_id, proveedor_id, lote)`
--      index exists, whose 4-column shape is a usable but not ideal prefix)
--      and `fsj.movimiento_stock(tenant_id, partida_id, registrado_en DESC)`
--      (the kardex query filters by partida_id/tenant_id and orders by
--      registrado_en desc; today NO index at all backs
--      movimiento_stock_partida_fkey or the ORDER BY). Both are CREATE INDEX
--      IF NOT EXISTS, NOT CONCURRENTLY -- this migration already runs
--      inside Prisma's implicit per-file transaction, and CREATE INDEX
--      CONCURRENTLY cannot run inside a transaction block.

-- ============================================================================
-- 1. Permiso stock.valorizado.ver (ADMINISTRADOR, DIRECTOR_TECNICO,
--    FARMACEUTICO only).
-- ============================================================================
INSERT INTO fsj.permiso (codigo, descripcion) VALUES
  ('stock.valorizado.ver', 'Ver stock valorizado (costo actual por partida)')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO fsj.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM (VALUES
  ('ADMINISTRADOR', 'stock.valorizado.ver'),
  ('DIRECTOR_TECNICO', 'stock.valorizado.ver'),
  ('FARMACEUTICO', 'stock.valorizado.ver')
) AS m(rol_codigo, permiso_codigo)
JOIN fsj.rol r ON r.codigo = m.rol_codigo
JOIN fsj.permiso p ON p.codigo = m.permiso_codigo
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. Indexes for the FASE 13 heavy aggregates.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_partida_tenant_droga
  ON fsj.partida (tenant_id, droga_id);

COMMENT ON INDEX fsj.idx_partida_tenant_droga IS
  'FASE 13 point 13.2: supports the stock valorizado report''s per-droga grouping/filtering (fsj.partida joined to fsj.droga by tenant_id, droga_id).';

CREATE INDEX IF NOT EXISTS idx_movimiento_stock_tenant_partida_fecha
  ON fsj.movimiento_stock (tenant_id, partida_id, registrado_en DESC);

COMMENT ON INDEX fsj.idx_movimiento_stock_tenant_partida_fecha IS
  'FASE 13 point 13.2: supports the kardex report''s filter by (tenant_id, partida_id) plus its ORDER BY registrado_en DESC (modules/stock/infrastructure/partida-repository.ts#kardexMovimientos).';

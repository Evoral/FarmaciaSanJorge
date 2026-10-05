-- 0058_potencia_por_partida
--
-- Purity (potencia) correction per LOT. A drug's purity is a property of the
-- partida, never of the droga: a droga is never split per purity/provider.
-- Scope: purity in percent only (no salt factor, no international units).
--
-- ADDITIVE: three nullable/defaulted columns; existing rows are unaffected.
--
--   - fsj.partida.potencia_declarada (numeric, NULL = 100%, i.e. no
--     correction). 0 < p <= 100 (partida_potencia_declarada_check). Set only
--     at INSERT (stock.partida.ingresar): the table-level INSERT privilege
--     (ALTER DEFAULT PRIVILEGES, Phase 0) covers it; NO UPDATE grant -- a
--     lot's declared purity is a fact of its certificate, not something to
--     edit afterwards (fsj.partida's UPDATE privilege is per column, 0008).
--   - fsj.droga.requiere_correccion_potencia (boolean, default false). When
--     true, the app requires potencia_declarada on every NEW partida of that
--     droga (modules/stock/application/ingresar-partida.ts) -- an [APP] rule,
--     not enforced here: older partidas keep NULL. fsj.droga's UPDATE
--     privilege is per column (0007), so the new column needs its own grant.
--   - fsj.movimiento_stock.potencia_aplicada (numeric): snapshot of the
--     purity used to compute an EGRESO_PREPARACION's physical quantity
--     (modules/preparaciones/application/confirmar-preparacion.ts). Same
--     0 < p <= 100 range. movimiento_stock stays fully immutable (INV-S06):
--     the column is written by the INSERT only.
--
-- The ficha técnica is unchanged: linea_pesaje.cantidad_a_pesar (theoretical
-- x (1 + exceso)) now reads as "active ingredient required"; the physical
-- weight per partida is cantidad_a_pesar x 100 / potencia, computed by the
-- app at confirmation. movimiento_stock.cantidad stays the PHYSICAL quantity
-- (fsj.movimiento_stock_aplicar(), 0008, is unchanged).
--
-- Existing triggers checked: trg_partida_validar_update (0008) only looks at
-- cantidad_disponible/fecha_apertura; trg_droga_validar_clasificacion_inmutable
-- (0028) only at unidad_base_id/es_controlada/tipo_control; movimiento_stock's
-- triggers (0008/0014) do not compare whole rows. RLS (tenant_isolation,
-- setup_tenant_table) is row-based and covers the new columns as-is.
--
-- Numbering: 0057 (20261002090000_0057_toma_receta) is the highest at the
-- time of writing -- re-check the number and timestamp before applying.
--
-- *** APPLY 0058 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0058_potencia_por_partida.down.sql (as a NEW
-- forward migration).

-- ============================================================================
-- 1. fsj.partida.potencia_declarada
-- ============================================================================
ALTER TABLE fsj.partida
  ADD COLUMN IF NOT EXISTS potencia_declarada numeric;

ALTER TABLE fsj.partida
  ADD CONSTRAINT partida_potencia_declarada_check CHECK (potencia_declarada IS NULL OR (potencia_declarada > 0 AND potencia_declarada <= 100));

COMMENT ON COLUMN fsj.partida.potencia_declarada IS
  '0058. Declared purity of the lot, in percent (0 < p <= 100). NULL = 100% (no correction). Physical weight to consume = active required x 100 / potencia_declarada. Insert-only for fsj_app (no UPDATE grant).';

-- ============================================================================
-- 2. fsj.droga.requiere_correccion_potencia
-- ============================================================================
ALTER TABLE fsj.droga
  ADD COLUMN IF NOT EXISTS requiere_correccion_potencia boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fsj.droga.requiere_correccion_potencia IS
  '0058. When true, every NEW partida of this droga must declare potencia_declarada ([APP] rule, stock.partida.ingresar). Existing partidas are unaffected.';

GRANT UPDATE (requiere_correccion_potencia) ON fsj.droga TO fsj_app;

-- ============================================================================
-- 3. fsj.movimiento_stock.potencia_aplicada
-- ============================================================================
ALTER TABLE fsj.movimiento_stock
  ADD COLUMN IF NOT EXISTS potencia_aplicada numeric;

ALTER TABLE fsj.movimiento_stock
  ADD CONSTRAINT movimiento_stock_potencia_aplicada_check CHECK (potencia_aplicada IS NULL OR (potencia_aplicada > 0 AND potencia_aplicada <= 100));

COMMENT ON COLUMN fsj.movimiento_stock.potencia_aplicada IS
  '0058. Snapshot of the purity (percent) used to compute this EGRESO_PREPARACION''s physical cantidad (100 = partida without declared purity). NULL for every other movement and for manual-enrase lines (no correction).';

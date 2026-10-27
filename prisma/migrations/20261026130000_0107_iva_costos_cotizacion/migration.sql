-- 0107_iva_costos_cotizacion
--
-- User decision (2026-10-26, openspec/specs/costos-proveedor/spec.md R7, R7a): a costo de proveedor carries its
-- IVA from the start and the price shown to the client is calculated on the cost WITH IVA (tramo margin and
-- precio mínimo included). The net figures stay; both numbers are stored.
--
--   1. fsj.costo_proveedor gets alicuota_iva (percent, editable per costo, default = the tenant's
--      alicuota_iva_porcentaje parametro) and the two prices with IVA: precio_informado_con_iva (per 1
--      unidad_precio) and costo_unitario_con_iva (per the droga's unidad base, what a cotización multiplies).
--      Computed by the application (modules/costos-proveedor/domain/costo-proveedor.ts#calcularConIva); the
--      CHECKs below refuse a row whose figures disagree.
--      Existing rows were loaded net of IVA: they get 21 % (the parametro's default). Backfilled through a
--      temporary GENERATED expression that is then dropped, so no UPDATE runs and
--      trg_costo_proveedor_validar_update (INV-CP-001, every column but vigente_hasta immutable) is never
--      bypassed. The new columns are immutable by that same trigger (it compares every column).
--   2. fsj.cotizacion gets costo_insumos_con_iva: the base the price is calculated on. NULL = a cotización
--      calculated before this migration (priced on costo_insumos, without IVA); costo_insumos keeps meaning net.
--   3. The parametro alicuota_iva_porcentaje (21) for every existing tenant; scripts/create-tenant.ts seeds it
--      for new ones. A partida (the fallback cost source, R27) is costed with it at cotización time; the
--      partida itself is not touched.
--
-- Rollback: prisma/rollbacks/0107_iva_costos_cotizacion.down.sql.

-- ============================================================================
-- 1. fsj.costo_proveedor
-- ============================================================================
ALTER TABLE fsj.costo_proveedor ADD COLUMN IF NOT EXISTS alicuota_iva numeric NOT NULL DEFAULT 21;

ALTER TABLE fsj.costo_proveedor
  ADD COLUMN IF NOT EXISTS precio_informado_con_iva numeric
    GENERATED ALWAYS AS (round(precio_informado * (1 + alicuota_iva / 100), 6)) STORED,
  ADD COLUMN IF NOT EXISTS costo_unitario_con_iva numeric
    GENERATED ALWAYS AS (round(costo_unitario * (1 + alicuota_iva / 100), 10)) STORED;

-- Plain columns from here on: the application writes them on every insert.
ALTER TABLE fsj.costo_proveedor ALTER COLUMN precio_informado_con_iva DROP EXPRESSION;
ALTER TABLE fsj.costo_proveedor ALTER COLUMN costo_unitario_con_iva DROP EXPRESSION;
ALTER TABLE fsj.costo_proveedor ALTER COLUMN precio_informado_con_iva SET NOT NULL;
ALTER TABLE fsj.costo_proveedor ALTER COLUMN costo_unitario_con_iva SET NOT NULL;
ALTER TABLE fsj.costo_proveedor ALTER COLUMN alicuota_iva DROP DEFAULT;

ALTER TABLE fsj.costo_proveedor
  ADD CONSTRAINT costo_proveedor_alicuota_iva_check CHECK (alicuota_iva >= 0 AND alicuota_iva <= 100),
  ADD CONSTRAINT costo_proveedor_precio_informado_con_iva_check
    CHECK (precio_informado_con_iva = round(precio_informado * (1 + alicuota_iva / 100), 6)),
  ADD CONSTRAINT costo_proveedor_costo_unitario_con_iva_check
    CHECK (costo_unitario_con_iva = round(costo_unitario * (1 + alicuota_iva / 100), 10));

COMMENT ON COLUMN fsj.costo_proveedor.alicuota_iva IS
  '0107 (R7a): IVA rate in percent (0-100) of this costo. Defaults in the app to the tenant parametro alicuota_iva_porcentaje, editable per costo. Rows before 0107 got 21.';
COMMENT ON COLUMN fsj.costo_proveedor.precio_informado_con_iva IS
  '0107 (R7a): precio_informado * (1 + alicuota_iva / 100), 6 decimals half-up. Computed by the application; costo_proveedor_precio_informado_con_iva_check enforces it.';
COMMENT ON COLUMN fsj.costo_proveedor.costo_unitario_con_iva IS
  '0107 (R7a): costo_unitario * (1 + alicuota_iva / 100), 10 decimals half-up: what a cotización multiplies (R25). Computed by the application; costo_proveedor_costo_unitario_con_iva_check enforces it.';

-- ============================================================================
-- 2. fsj.cotizacion
-- ============================================================================
ALTER TABLE fsj.cotizacion ADD COLUMN IF NOT EXISTS costo_insumos_con_iva numeric;

ALTER TABLE fsj.cotizacion
  ADD CONSTRAINT cotizacion_costo_insumos_con_iva_check CHECK (costo_insumos_con_iva IS NULL OR costo_insumos_con_iva >= costo_insumos);

COMMENT ON COLUMN fsj.cotizacion.costo_insumos_con_iva IS
  '0107 (openspec/specs/costos-proveedor/spec.md R31): costo_insumos with each línea''s IVA, the base precio_final is calculated on (tramo + precio mínimo). NULL = calculated before 0107, priced on costo_insumos (no IVA).';

-- ============================================================================
-- 3. Parametro for every existing tenant
-- ============================================================================
INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT
  t.id,
  'alicuota_iva_porcentaje',
  'NUMERO',
  '21',
  'Alicuota de IVA, en porcentaje, que se propone para cada costo de proveedor nuevo y con la que se cotizan las partidas -- openspec/specs/costos-proveedor/spec.md R7a'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;

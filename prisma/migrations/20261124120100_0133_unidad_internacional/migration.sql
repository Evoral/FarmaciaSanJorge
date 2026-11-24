-- 0133_unidad_internacional
--
-- Unidades internacionales (U.I.) -- openspec/changes/unidad-internacional/.
-- Depends on 0132 (fsj.tipo_magnitud 'ACTIVIDAD').
--
--   1. Global unit seed: UNIDAD_INTERNACIONAL ('U.I.', ACTIVIDAD, factor 1, base).
--   2. fsj.droga.se_dosifica_en_ui: only clase = 'DROGA', unidad_base of MASA,
--      cannot unset while a partida has actividad_declarada IS NOT NULL AND cantidad_disponible > 0.
--   3. fsj.partida.actividad_declarada (U.I./g): > 0, exclusive with potencia_declarada,
--      requires droga.se_dosifica_en_ui, kind (NULL vs NOT NULL) immutable on UPDATE,
--      UPDATE grant for fsj_app ("Corregir pureza").
--   4. fsj.movimiento_stock.actividad_aplicada: snapshot of U.I./g on EGRESO_PREPARACION,
--      exclusive with potencia_aplicada.
--   5. equivalencia_manual on fsj.reserva_stock and fsj.movimiento_stock.
--   6. INV-S12 (fsj.linea_pesaje_validar_consumo): rebuilt from 0088 to support ACTIVIDAD
--      lines (both pesada_real and computed active U.I. sum) and equivalencia_manual.
--
-- Rollback: prisma/rollbacks/0133_unidad_internacional.down.sql (as a NEW forward migration).

-- ============================================================================
-- 1. Seed: UNIDAD_INTERNACIONAL (global catalog, no tenant)
-- ============================================================================
INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base)
VALUES ('UNIDAD_INTERNACIONAL', 'Unidad internacional', 'U.I.', 'ACTIVIDAD', 1, true)
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================================
-- 2. fsj.droga.se_dosifica_en_ui
-- ============================================================================
ALTER TABLE fsj.droga
  ADD COLUMN IF NOT EXISTS se_dosifica_en_ui boolean NOT NULL DEFAULT false;

ALTER TABLE fsj.droga
  ADD CONSTRAINT droga_se_dosifica_en_ui_clase_check CHECK (NOT se_dosifica_en_ui OR clase = 'DROGA');

COMMENT ON COLUMN fsj.droga.se_dosifica_en_ui IS
  '0133. When true (only clase = DROGA, unidad_base of MASA), accepts U.I. in recetas and U.I./g partidas. Cannot be unset while a U.I. partida has cantidad_disponible > 0. Column-level UPDATE grant.';

GRANT UPDATE (se_dosifica_en_ui) ON fsj.droga TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.droga_validar_se_dosifica_en_ui()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_magnitud fsj.tipo_magnitud;
BEGIN
  IF NEW.se_dosifica_en_ui THEN
    SELECT tipo_magnitud INTO v_magnitud
    FROM fsj.unidad_medida
    WHERE id = NEW.unidad_base_id;

    IF v_magnitud IS DISTINCT FROM 'MASA' THEN
      RAISE EXCEPTION 'droga % cannot set se_dosifica_en_ui because unidad_base_id % has tipo_magnitud % (MASA required)',
        NEW.id, NEW.unidad_base_id, v_magnitud
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.se_dosifica_en_ui AND NOT NEW.se_dosifica_en_ui THEN
    IF EXISTS (
      SELECT 1
      FROM fsj.partida p
      WHERE p.tenant_id = NEW.tenant_id
        AND p.droga_id = NEW.id
        AND p.actividad_declarada IS NOT NULL
        AND p.cantidad_disponible > 0
    ) THEN
      RAISE EXCEPTION 'droga % cannot unset se_dosifica_en_ui while a U.I. partida has cantidad_disponible > 0', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_droga_validar_se_dosifica_en_ui
  BEFORE INSERT OR UPDATE ON fsj.droga
  FOR EACH ROW EXECUTE FUNCTION fsj.droga_validar_se_dosifica_en_ui();

-- ============================================================================
-- 3. fsj.partida.actividad_declarada
-- ============================================================================
ALTER TABLE fsj.partida
  ADD COLUMN IF NOT EXISTS actividad_declarada numeric;

ALTER TABLE fsj.partida
  ADD CONSTRAINT partida_actividad_declarada_check CHECK (actividad_declarada IS NULL OR actividad_declarada > 0),
  ADD CONSTRAINT partida_potencia_o_actividad_check CHECK (actividad_declarada IS NULL OR potencia_declarada IS NULL);

COMMENT ON COLUMN fsj.partida.actividad_declarada IS
  '0133. Declared activity of the lot in U.I. per gram of physical lot (> 0). Exclusive with potencia_declarada. Requires droga.se_dosifica_en_ui; kind (NULL vs NOT NULL) is immutable after insert. Column-level UPDATE grant for Corregir pureza.';

GRANT UPDATE (actividad_declarada) ON fsj.partida TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.partida_validar_actividad()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_se_dosifica_en_ui boolean;
BEGIN
  IF NEW.actividad_declarada IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.actividad_declarada IS DISTINCT FROM OLD.actividad_declarada) THEN
    SELECT se_dosifica_en_ui INTO v_se_dosifica_en_ui
    FROM fsj.droga
    WHERE tenant_id = NEW.tenant_id AND id = NEW.droga_id;

    IF NOT coalesce(v_se_dosifica_en_ui, false) THEN
      RAISE EXCEPTION 'partida % cannot set actividad_declarada because droga % does not have se_dosifica_en_ui',
        NEW.id, NEW.droga_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.actividad_declarada IS NULL) IS DISTINCT FROM (NEW.actividad_declarada IS NULL) THEN
    RAISE EXCEPTION 'partida % cannot switch between gram lot and U.I. lot after intake', NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_partida_validar_actividad
  BEFORE INSERT OR UPDATE ON fsj.partida
  FOR EACH ROW EXECUTE FUNCTION fsj.partida_validar_actividad();

-- ============================================================================
-- 4. fsj.movimiento_stock.actividad_aplicada & equivalencia_manual
-- ============================================================================
ALTER TABLE fsj.movimiento_stock
  ADD COLUMN IF NOT EXISTS actividad_aplicada numeric,
  ADD COLUMN IF NOT EXISTS equivalencia_manual boolean NOT NULL DEFAULT false;

ALTER TABLE fsj.movimiento_stock
  ADD CONSTRAINT movimiento_stock_actividad_aplicada_check CHECK (actividad_aplicada IS NULL OR actividad_aplicada > 0),
  ADD CONSTRAINT movimiento_stock_potencia_o_actividad_check CHECK (actividad_aplicada IS NULL OR potencia_aplicada IS NULL);

COMMENT ON COLUMN fsj.movimiento_stock.actividad_aplicada IS
  '0133. Snapshot of the activity (U.I./g) used to compute this EGRESO_PREPARACION''s physical cantidad. Exclusive with potencia_aplicada; NULL for non-U.I. movements and manual lines.';
COMMENT ON COLUMN fsj.movimiento_stock.equivalencia_manual IS
  '0133. True when this EGRESO_PREPARACION was weighed as a manual quantity due to missing U.I.<->mass equivalence on a se_dosifica_en_ui droga.';

-- ============================================================================
-- 5. fsj.reserva_stock.equivalencia_manual
-- ============================================================================
ALTER TABLE fsj.reserva_stock
  ADD COLUMN IF NOT EXISTS equivalencia_manual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fsj.reserva_stock.equivalencia_manual IS
  '0133. True when a non-enrase-manual línea is weighed manually (reusing cantidad_manual) because no convertible partida exists.';

-- ============================================================================
-- 6. INV-S12: fsj.linea_pesaje_validar_consumo (rebuilt from 0088)
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.linea_pesaje_validar_consumo(p_tenant_id uuid, p_linea_pesaje_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_manual            boolean;
  v_cantidad          numeric;
  v_unidad_linea      uuid;
  v_magnitud_linea    fsj.tipo_magnitud;
  v_unidad_stock      uuid;
  v_factor_stock      numeric;
  v_unidad_gramo      uuid;
  v_cantidad_stock    numeric;
  v_real              numeric;
  v_real_stock        numeric;
  v_sum               numeric;
  v_sum_activo        numeric;
  v_sum_ui            numeric;
  v_max_actividad     numeric;
  v_missing_actividad boolean;
  v_any_actividad     boolean;
  v_eq_manual_factor  boolean;
  v_any_eq_manual     boolean;
  v_all_eq_manual     boolean;
  v_mov_count         bigint;
  v_tolerancia        constant numeric := 0.0001;
  v_tolerancia_ui     numeric;
BEGIN
  SELECT l.es_enrase_manual, l.cantidad_a_pesar, l.unidad_medida_id, u.tipo_magnitud, d.unidad_base_id, us.factor_a_base
    INTO v_manual, v_cantidad, v_unidad_linea, v_magnitud_linea, v_unidad_stock, v_factor_stock
  FROM fsj.linea_pesaje l
  JOIN fsj.unidad_medida u ON u.id = l.unidad_medida_id
  JOIN fsj.droga d ON d.tenant_id = l.tenant_id AND d.id = l.droga_id
  JOIN fsj.unidad_medida us ON us.id = d.unidad_base_id
  WHERE l.tenant_id = p_tenant_id AND l.id = p_linea_pesaje_id;

  SELECT coalesce(sum(cantidad), 0),
         coalesce(sum(cantidad * coalesce(potencia_aplicada, 100) / 100), 0),
         coalesce(bool_or(actividad_aplicada IS NOT NULL), false),
         coalesce(bool_or(equivalencia_manual AND (potencia_aplicada IS NOT NULL OR actividad_aplicada IS NOT NULL)), false),
         coalesce(bool_or(equivalencia_manual), false),
         coalesce(bool_and(equivalencia_manual), true),
         count(*)
    INTO v_sum, v_sum_activo, v_any_actividad, v_eq_manual_factor, v_any_eq_manual, v_all_eq_manual, v_mov_count
  FROM fsj.movimiento_stock
  WHERE tenant_id = p_tenant_id AND linea_pesaje_id = p_linea_pesaje_id AND tipo = 'EGRESO_PREPARACION';

  IF v_mov_count > 0 AND v_any_eq_manual AND NOT v_all_eq_manual THEN
    RAISE EXCEPTION 'INV-S12: linea_pesaje % cannot mix equivalencia_manual and computed movements', p_linea_pesaje_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_eq_manual_factor THEN
    RAISE EXCEPTION 'INV-S12: linea_pesaje % equivalencia_manual movements cannot carry potencia_aplicada or actividad_aplicada', p_linea_pesaje_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_manual OR (v_mov_count > 0 AND v_all_eq_manual) THEN
    IF v_sum <= 0 THEN
      RAISE EXCEPTION 'INV-S12: manual-enrase linea_pesaje % must have a positive registered consumption (found %)', p_linea_pesaje_id, v_sum
        USING ERRCODE = 'P0001';
    END IF;
    RETURN;
  END IF;

  IF v_magnitud_linea <> 'ACTIVIDAD' AND v_any_actividad THEN
    RAISE EXCEPTION 'INV-S12: non-ACTIVIDAD linea_pesaje % cannot consume a movement with actividad_aplicada', p_linea_pesaje_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT cantidad_real INTO v_real
  FROM fsj.pesada_real
  WHERE tenant_id = p_tenant_id AND linea_pesaje_id = p_linea_pesaje_id;

  IF FOUND THEN
    -- 0088/0133: the PHYSICAL consumption is the real weighing.
    -- For ACTIVIDAD líneas, pesada_real.cantidad_real is already in the droga's unidad base.
    IF v_magnitud_linea = 'ACTIVIDAD' THEN
      v_real_stock := v_real;
    ELSE
      v_real_stock := fsj.convertir(v_real, v_unidad_linea, v_unidad_stock);
    END IF;

    IF abs(v_sum - v_real_stock) >= v_tolerancia THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % physical consumption must equal its pesada real % (% in the droga''s unidad base; found %)', p_linea_pesaje_id, v_real, v_real_stock, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_magnitud_linea = 'ACTIVIDAD' THEN
    SELECT id INTO v_unidad_gramo
    FROM fsj.unidad_medida
    WHERE codigo = 'GRAMO';

    IF v_unidad_gramo IS NULL THEN
      RAISE EXCEPTION 'INV-S12: GRAMO unit not found in fsj.unidad_medida'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT coalesce(sum(
             CASE
               WHEN actividad_aplicada IS NULL THEN 0
               ELSE fsj.convertir(cantidad, v_unidad_stock, v_unidad_gramo) * actividad_aplicada
             END
           ), 0),
           max(actividad_aplicada),
           bool_or(actividad_aplicada IS NULL)
      INTO v_sum_ui, v_max_actividad, v_missing_actividad
    FROM fsj.movimiento_stock
    WHERE tenant_id = p_tenant_id AND linea_pesaje_id = p_linea_pesaje_id AND tipo = 'EGRESO_PREPARACION';

    IF v_missing_actividad THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % in ACTIVIDAD requires actividad_aplicada on every EGRESO_PREPARACION movement', p_linea_pesaje_id
        USING ERRCODE = 'P0001';
    END IF;

    v_tolerancia_ui := v_tolerancia * v_factor_stock * coalesce(v_max_actividad, 0);
    IF v_sum_ui < v_cantidad OR (v_sum_ui - v_cantidad) >= v_tolerancia_ui THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % active UI consumption must equal cantidad_a_pesar % UI (found % UI, tolerance %)', p_linea_pesaje_id, v_cantidad, v_sum_ui, v_tolerancia_ui
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- 0073 rule, unchanged: movimiento_stock.cantidad is in the droga's unidad base; cantidad_a_pesar in the línea's unit.
    v_cantidad_stock := fsj.convertir(v_cantidad, v_unidad_linea, v_unidad_stock);
    IF v_sum_activo < v_cantidad_stock OR v_sum_activo - v_cantidad_stock >= v_tolerancia THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % active consumption must equal cantidad_a_pesar % (% in the droga''s unidad base; found % active, % physical)', p_linea_pesaje_id, v_cantidad, v_cantidad_stock, v_sum_activo, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

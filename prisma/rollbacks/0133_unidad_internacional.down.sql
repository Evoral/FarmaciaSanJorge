-- Rollback of 0133_unidad_internacional (apply as a NEW forward migration).
-- Restores INV-S12 (fsj.linea_pesaje_validar_consumo) to its 0088 body and drops the 0133 columns, triggers and seed.

-- 1. Restore INV-S12 to 0088 definition
CREATE OR REPLACE FUNCTION fsj.linea_pesaje_validar_consumo(p_tenant_id uuid, p_linea_pesaje_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_manual          boolean;
  v_cantidad        numeric;
  v_unidad_linea    uuid;
  v_unidad_stock    uuid;
  v_cantidad_stock  numeric;
  v_real            numeric;
  v_real_stock      numeric;
  v_sum             numeric;
  v_sum_activo      numeric;
  v_tolerancia      constant numeric := 0.0001;
BEGIN
  SELECT l.es_enrase_manual, l.cantidad_a_pesar, l.unidad_medida_id, d.unidad_base_id
    INTO v_manual, v_cantidad, v_unidad_linea, v_unidad_stock
  FROM fsj.linea_pesaje l
  JOIN fsj.droga d ON d.tenant_id = l.tenant_id AND d.id = l.droga_id
  WHERE l.tenant_id = p_tenant_id AND l.id = p_linea_pesaje_id;

  SELECT coalesce(sum(cantidad), 0),
         coalesce(sum(cantidad * coalesce(potencia_aplicada, 100) / 100), 0)
    INTO v_sum, v_sum_activo
  FROM fsj.movimiento_stock
  WHERE tenant_id = p_tenant_id AND linea_pesaje_id = p_linea_pesaje_id AND tipo = 'EGRESO_PREPARACION';

  IF v_manual THEN
    IF v_sum <= 0 THEN
      RAISE EXCEPTION 'INV-S12: manual-enrase linea_pesaje % must have a positive registered consumption (found %)', p_linea_pesaje_id, v_sum
        USING ERRCODE = 'P0001';
    END IF;
    RETURN;
  END IF;

  SELECT cantidad_real INTO v_real
  FROM fsj.pesada_real
  WHERE tenant_id = p_tenant_id AND linea_pesaje_id = p_linea_pesaje_id;

  IF FOUND THEN
    v_real_stock := fsj.convertir(v_real, v_unidad_linea, v_unidad_stock);
    IF abs(v_sum - v_real_stock) >= v_tolerancia THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % physical consumption must equal its pesada real % (% in the droga''s unidad base; found %)', p_linea_pesaje_id, v_real, v_real_stock, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_cantidad_stock := fsj.convertir(v_cantidad, v_unidad_linea, v_unidad_stock);
    IF v_sum_activo < v_cantidad_stock OR v_sum_activo - v_cantidad_stock >= v_tolerancia THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % active consumption must equal cantidad_a_pesar % (% in the droga''s unidad base; found % active, % physical)', p_linea_pesaje_id, v_cantidad, v_cantidad_stock, v_sum_activo, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

-- 2. Drop reserva_stock and movimiento_stock columns
ALTER TABLE fsj.reserva_stock
  DROP COLUMN IF EXISTS equivalencia_manual;

ALTER TABLE fsj.movimiento_stock
  DROP CONSTRAINT IF EXISTS movimiento_stock_potencia_o_actividad_check,
  DROP CONSTRAINT IF EXISTS movimiento_stock_actividad_aplicada_check,
  DROP COLUMN IF EXISTS equivalencia_manual,
  DROP COLUMN IF EXISTS actividad_aplicada;

-- 3. Drop partida trigger, grant, constraints, column
DROP TRIGGER IF EXISTS trg_partida_validar_actividad ON fsj.partida;
DROP FUNCTION IF EXISTS fsj.partida_validar_actividad();
REVOKE UPDATE (actividad_declarada) ON fsj.partida FROM fsj_app;
ALTER TABLE fsj.partida
  DROP CONSTRAINT IF EXISTS partida_potencia_o_actividad_check,
  DROP CONSTRAINT IF EXISTS partida_actividad_declarada_check,
  DROP COLUMN IF EXISTS actividad_declarada;

-- 4. Drop droga trigger, grant, constraint, column
DROP TRIGGER IF EXISTS trg_droga_validar_se_dosifica_en_ui ON fsj.droga;
DROP FUNCTION IF EXISTS fsj.droga_validar_se_dosifica_en_ui();
REVOKE UPDATE (se_dosifica_en_ui) ON fsj.droga FROM fsj_app;
ALTER TABLE fsj.droga
  DROP CONSTRAINT IF EXISTS droga_se_dosifica_en_ui_clase_check,
  DROP COLUMN IF EXISTS se_dosifica_en_ui;

-- 5. Remove UNIDAD_INTERNACIONAL seed (fails if any table still references it via FK)
ALTER TABLE fsj.unidad_medida DISABLE TRIGGER trg_unidad_medida_forbid_delete;
DELETE FROM fsj.unidad_medida WHERE codigo = 'UNIDAD_INTERNACIONAL';
ALTER TABLE fsj.unidad_medida ENABLE TRIGGER trg_unidad_medida_forbid_delete;

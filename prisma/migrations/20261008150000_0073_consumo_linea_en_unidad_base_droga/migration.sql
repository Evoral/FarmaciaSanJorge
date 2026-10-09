-- 0073_consumo_linea_en_unidad_base_droga
--
-- Stock quantities (partida.cantidad_*, movimiento_stock.cantidad,
-- reserva_stock.cantidad, asiento_contralor.cantidad) are in the DROGA's
-- unidad base (droga.unidad_base_id, e.g. mg -- ingresar-partida converts to
-- it). A línea de pesaje (cantidad_a_pesar, unidad_medida_id) is in its
-- MAGNITUD's base unit (unidad_medida.es_base, e.g. g -- the ficha técnica
-- calculator). The app used to split cantidad_a_pesar over the partidas
-- without converting, so a 950 g línea of a droga kept in mg consumed 950 mg.
-- The app now converts the línea's quantity into the droga's unidad base
-- before the split (modules/preparaciones/application/confirmar-preparacion.ts,
-- `planificarConsumoEnTx`; docs/specs/reserva-stock-preparacion.md, R12).
--
-- INV-S12 (fsj.linea_pesaje_validar_consumo, 0014, revised by 0060) compared
-- the ACTIVE sum of a línea's EGRESO_PREPARACION movements (droga unidad
-- base) with cantidad_a_pesar (línea unit) with no conversion: with the fix,
-- every línea whose unit differs from its droga's unidad base would be
-- rejected (950000 mg vs 950). Revised rule (non-manual lines): the same
-- comparison, with cantidad_a_pesar converted into the droga's unidad base
-- via fsj.convertir (INV-M01: raises when the magnitudes differ; the app
-- refuses that case first with a clear message). v_tolerancia (0.0001) is now
-- in the droga's unidad base, which is the unit potencia.ts rounds the
-- physical weight in (DECIMALES_PESO_FISICO = 4): the overshoot bound of 0060
-- holds unchanged. When the línea's unit IS the droga's unidad base,
-- fsj.convertir returns the value unchanged: identical to 0060.
-- Manual-enrase lines are unchanged (positive physical consumption).
--
-- Existing rows are not touched (the movimientos already written with the
-- wrong unit are test data; the deferred check only runs for new egresos).
--
-- CREATE OR REPLACE keeps the signature, so the deferred constraint trigger
-- from 0014 keeps calling it as-is.
--
-- Numbering: 0072 (20261008120000_0072_receta_editable_sin_preparacion_viva)
-- is the highest at the time of writing -- re-check before applying.
--
-- *** APPLY 0073 TOGETHER WITH THE CODE THAT CONVERTS (same deploy). ***
-- Old code + 0073: a línea whose unit differs from its droga's unidad base is
-- rejected (INV-S12) instead of consuming the wrong amount. New code without
-- 0073: the same líneas are rejected by 0060. Líneas already in the droga's
-- unidad base work in every combination.
-- Rollback: prisma/rollbacks/0073_consumo_linea_en_unidad_base_droga.down.sql
-- (as a NEW forward migration).

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
  ELSE
    -- movimiento_stock.cantidad is in the droga's unidad base; cantidad_a_pesar in the línea's unit.
    v_cantidad_stock := fsj.convertir(v_cantidad, v_unidad_linea, v_unidad_stock);
    IF v_sum_activo < v_cantidad_stock OR v_sum_activo - v_cantidad_stock >= v_tolerancia THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % active consumption must equal cantidad_a_pesar % (% in the droga''s unidad base; found % active, % physical)', p_linea_pesaje_id, v_cantidad, v_cantidad_stock, v_sum_activo, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

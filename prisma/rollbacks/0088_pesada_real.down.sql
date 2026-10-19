-- Rollback of 0088_pesada_real (apply as a NEW forward migration).
-- Restores 0073's INV-S12 (active consumption = cantidad_a_pesar), drops fsj.pesada_real, the reserva_stock columns
-- and the tolerancia_pesada_porcentaje parameter. A línea already confirmed with a real weighing that differs from
-- cantidad_a_pesar keeps its movimientos (the deferred check only runs for new egresos). The code must be reverted
-- too (pesada real field of the "Marcar como preparada" form, planificarConsumoEnTx, docs/specs/pesada-real.md).

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

DROP TABLE IF EXISTS fsj.pesada_real;
DROP FUNCTION IF EXISTS fsj.pesada_real_validar_autorizacion();

ALTER TABLE fsj.reserva_stock
  DROP CONSTRAINT IF EXISTS reserva_stock_pesada_autorizada_por_fkey,
  DROP CONSTRAINT IF EXISTS reserva_stock_cantidad_real_check,
  DROP COLUMN IF EXISTS pesada_autorizada_por_id,
  DROP COLUMN IF EXISTS cantidad_real;

DELETE FROM fsj.parametro WHERE clave = 'tolerancia_pesada_porcentaje';

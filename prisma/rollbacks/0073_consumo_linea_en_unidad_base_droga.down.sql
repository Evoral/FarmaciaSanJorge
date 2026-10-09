-- Rollback of 0073_consumo_linea_en_unidad_base_droga. Prisma has no "down":
-- apply this as the body of a NEW forward migration (next free number), in
-- the SAME deploy as the code that reverts the unit conversion in
-- `planificarConsumoEnTx` (see docs/rollbacks/stock-unidad-base-droga.md).
-- Restores 0060's INV-S12: cantidad_a_pesar compared with no conversion, so
-- with the converting code still deployed every línea whose unit differs from
-- its droga's unidad base would be rejected.

CREATE OR REPLACE FUNCTION fsj.linea_pesaje_validar_consumo(p_tenant_id uuid, p_linea_pesaje_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_manual        boolean;
  v_cantidad      numeric;
  v_sum           numeric;
  v_sum_activo    numeric;
  v_tolerancia    constant numeric := 0.0001;
BEGIN
  SELECT es_enrase_manual, cantidad_a_pesar INTO v_manual, v_cantidad
  FROM fsj.linea_pesaje
  WHERE tenant_id = p_tenant_id AND id = p_linea_pesaje_id;

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
    IF v_sum_activo < v_cantidad OR v_sum_activo - v_cantidad >= v_tolerancia THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % active consumption must equal cantidad_a_pesar % (found % active, % physical)', p_linea_pesaje_id, v_cantidad, v_sum_activo, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

-- Rollback of 0060_consumo_linea_en_activo. Prisma has no "down": apply this
-- as the body of a NEW forward migration (next free number). Restores 0014's
-- physical-equality INV-S12: confirmations of lots with purity < 100% will be
-- rejected again.

CREATE OR REPLACE FUNCTION fsj.linea_pesaje_validar_consumo(p_tenant_id uuid, p_linea_pesaje_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_manual        boolean;
  v_cantidad      numeric;
  v_sum           numeric;
BEGIN
  SELECT es_enrase_manual, cantidad_a_pesar INTO v_manual, v_cantidad
  FROM fsj.linea_pesaje
  WHERE tenant_id = p_tenant_id AND id = p_linea_pesaje_id;

  SELECT coalesce(sum(cantidad), 0) INTO v_sum
  FROM fsj.movimiento_stock
  WHERE tenant_id = p_tenant_id AND linea_pesaje_id = p_linea_pesaje_id AND tipo = 'EGRESO_PREPARACION';

  IF v_manual THEN
    IF v_sum <= 0 THEN
      RAISE EXCEPTION 'INV-S12: manual-enrase linea_pesaje % must have a positive registered consumption (found %)', p_linea_pesaje_id, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF v_sum <> v_cantidad THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % consumption must equal cantidad_a_pesar % (found %)', p_linea_pesaje_id, v_cantidad, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

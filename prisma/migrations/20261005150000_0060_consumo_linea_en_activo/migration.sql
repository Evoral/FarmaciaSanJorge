-- 0060_consumo_linea_en_activo
--
-- INV-S12 (0014, fsj.linea_pesaje_validar_consumo) compared the PHYSICAL sum
-- of a línea's EGRESO_PREPARACION movements against cantidad_a_pesar. Since
-- 0058, cantidad_a_pesar is the ACTIVE ingredient required and each movement
-- records potencia_aplicada: a lot at p% is weighed cantidad x 100 / p, so the
-- physical sum is greater than cantidad_a_pesar whenever p < 100 and every
-- such confirmation was rejected.
--
-- Revised rule (non-manual lines): the ACTIVE sum
--   sum(cantidad x coalesce(potencia_aplicada, 100) / 100)
-- must cover cantidad_a_pesar, overshooting by less than 0.0001. The app
-- (modules/preparaciones/domain/potencia.ts) drains whole partidas exactly
-- and rounds only the last one's physical weight UP to DECIMALES_PESO_FISICO
-- (4) decimals, so the overshoot is < 10^-4 x p/100 < 0.0001. If that
-- rounding changes, change v_tolerancia here too.
-- With no purity declared (potencia_aplicada NULL or 100) the active sum is
-- the physical sum and the overshoot is 0: identical to the old equality.
-- Manual-enrase lines are unchanged (positive physical consumption).
--
-- CREATE OR REPLACE keeps the signature, so the deferred constraint trigger
-- from 0014 keeps calling it as-is.
-- Rollback: prisma/rollbacks/0060_consumo_linea_en_activo.down.sql (as a NEW
-- forward migration).

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

-- 0072_receta_editable_sin_preparacion_viva
--
-- docs/specs/reserva-stock-preparacion.md ("Receta editable again after
-- liberar"). Reserving stock no longer moves the receta to EN_PREPARACION:
-- it stays PENDIENTE_PREPARACION until the first "Imprimir etiqueta"
-- (confirmation). Releasing a reserva discards its preparación, and the
-- receta must be editable again. So editing is blocked only by a LIVE
-- preparación (INICIADA or CONFIRMADA); a DESCARTADA one no longer counts.
--
--   - fsj.receta_assert_editable (INV-R11, migration 0030, the DB backstop of
--     item_receta / componente_item_receta DELETEs): same body, but the
--     "ficha técnica with a preparación" check now ignores DESCARTADA
--     preparaciones. The PENDIENTE_PREPARACION check is unchanged.
--   - Nothing else changes: INV-R08 (no backward receta transitions) is
--     untouched -- the receta only ever moves forward, at the confirmation.
--     A discarded preparación keeps pointing at its (old) ficha técnica;
--     editing generates a new ficha version as always.
--
-- Numbering: 0071 (20261008090000_0071_reserva_stock) is the highest at the
-- time of writing -- re-check before applying.
--
-- *** APPLY 0072 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0072_receta_editable_sin_preparacion_viva.down.sql
-- (as a NEW forward migration).

CREATE OR REPLACE FUNCTION fsj.receta_assert_editable(p_tenant_id uuid, p_receta_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_estado           fsj.estado_receta;
  v_con_preparacion  boolean;
BEGIN
  SELECT estado INTO v_estado
  FROM fsj.receta
  WHERE tenant_id = p_tenant_id AND id = p_receta_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-R11: receta % not found', p_receta_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_estado <> 'PENDIENTE_PREPARACION' THEN
    RAISE EXCEPTION 'INV-R11: receta % is not editable (estado = %, must be PENDIENTE_PREPARACION)', p_receta_id, v_estado
      USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM fsj.ficha_tecnica ft
    JOIN fsj.item_receta ir ON ir.tenant_id = ft.tenant_id AND ir.id = ft.item_receta_id
    JOIN fsj.preparacion p ON p.tenant_id = ft.tenant_id AND p.ficha_tecnica_id = ft.id
    WHERE ft.tenant_id = p_tenant_id AND ir.receta_id = p_receta_id
      AND p.estado <> 'DESCARTADA'
  ) INTO v_con_preparacion;

  IF v_con_preparacion THEN
    RAISE EXCEPTION 'INV-R11: receta % is not editable (has a ficha tecnica with a live preparacion)', p_receta_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION fsj.receta_assert_editable(uuid, uuid) IS
  'INV-R11 (migration 0030, revised by 0072). Backstop for item_receta/componente_item_receta DELETEs: only while the receta is PENDIENTE_PREPARACION and none of its items has a ficha_tecnica with a LIVE (INICIADA/CONFIRMADA) preparacion -- a DESCARTADA one does not block editing.';

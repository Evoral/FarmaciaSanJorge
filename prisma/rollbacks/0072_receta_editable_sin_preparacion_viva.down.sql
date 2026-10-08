-- Rollback of 0072_receta_editable_sin_preparacion_viva. Apply as a NEW forward
-- migration, together with the code that moves the receta to EN_PREPARACION
-- when a preparación is started. Restores migration 0030's INV-R11 body: ANY
-- preparación (DESCARTADA included) blocks deleting items/componentes.
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
  ) INTO v_con_preparacion;

  IF v_con_preparacion THEN
    RAISE EXCEPTION 'INV-R11: receta % is not editable (has a ficha tecnica with a preparacion)', p_receta_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION fsj.receta_assert_editable(uuid, uuid) IS
  'INV-R11 (new, migration 0030). Backstop for item_receta/componente_item_receta DELETEs: only while the receta is PENDIENTE_PREPARACION and none of its items has a ficha_tecnica with a preparacion.';

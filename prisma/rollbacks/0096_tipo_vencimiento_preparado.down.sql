-- Rollback of 0096_tipo_vencimiento_preparado. Apply as a NEW forward migration, AFTER deploying the code that no
-- longer reads or writes tipo_vencimiento (docs/rollbacks/tipo-vencimiento-preparado.md has the full procedure).
--
-- DATA LOSS: every snapshotted tipo_vencimiento. fecha_vencimiento is kept (0068): reprinted etiquetas rebuilt from
-- data go back to "Vence: MM/YY" and the generic storage note; the etiqueta.contenido text already persisted keeps the
-- date format and note it was generated with.

-- Restore fsj.preparacion_validar_update() exactly as migration 0068 defined it (INV-P07 on fecha_vencimiento only).
CREATE OR REPLACE FUNCTION fsj.preparacion_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ficha_tecnica_id IS DISTINCT FROM OLD.ficha_tecnica_id THEN
    RAISE EXCEPTION 'INV-P01: ficha_tecnica_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.item_receta_id IS DISTINCT FROM OLD.item_receta_id THEN
    RAISE EXCEPTION 'INV-P01: item_receta_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.iniciada_en IS DISTINCT FROM OLD.iniciada_en THEN
    RAISE EXCEPTION 'INV-P05: iniciada_en cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.iniciada_por_id IS DISTINCT FROM OLD.iniciada_por_id THEN
    RAISE EXCEPTION 'INV-P05: iniciada_por_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    -- INV-P05: CONFIRMADA never changes state again; DESCARTADA is also terminal.
    IF OLD.estado <> 'INICIADA' THEN
      RAISE EXCEPTION 'INV-P05: invalid preparacion state transition % -> % (% is terminal)', OLD.estado, NEW.estado, OLD.estado
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.estado NOT IN ('CONFIRMADA', 'DESCARTADA') THEN
      RAISE EXCEPTION 'INV-P05: invalid preparacion state transition % -> %', OLD.estado, NEW.estado
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- INV-P07 (0068): the expiry is snapshotted in the confirming UPDATE and
  -- frozen afterwards.
  IF NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento
     AND NOT (OLD.estado = 'INICIADA' AND NEW.estado = 'CONFIRMADA') THEN
    RAISE EXCEPTION 'INV-P07: fecha_vencimiento can only be set when the preparacion is confirmed' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_update() IS
  'INV-P05: INICIADA -> CONFIRMADA | DESCARTADA, both terminal. No other transition. Also freezes ficha_tecnica_id/item_receta_id/iniciada_en/iniciada_por_id after insert. INV-P07 (0068): fecha_vencimiento changes only in the INICIADA -> CONFIRMADA UPDATE.';

REVOKE UPDATE (tipo_vencimiento) ON fsj.preparacion FROM fsj_app;
ALTER TABLE fsj.preparacion DROP CONSTRAINT IF EXISTS preparacion_tipo_vencimiento_check;
ALTER TABLE fsj.preparacion DROP COLUMN IF EXISTS tipo_vencimiento;
DROP TYPE IF EXISTS fsj.tipo_vencimiento_preparado;

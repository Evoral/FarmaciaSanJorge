-- Rollback of 0068_preparacion_fecha_vencimiento. Apply as a NEW forward
-- migration, together with the code that prints the blank "Vence: ______"
-- etiqueta line again (docs/rollbacks/preparacion-fecha-vencimiento.md has the
-- full procedure).
--
-- DATA LOSS: every snapshotted fecha_vencimiento. Reprinted etiquetas go back
-- to the blank "Vence" line. The etiqueta.contenido text persisted at
-- generation time keeps whatever date it was generated with.
-- The meses_vencimiento_preparado parametro rows are left in place: the
-- registry entry is what shows them, and an orphan row is harmless.

-- Restore fsj.preparacion_validar_update() exactly as migration 0013 defined it (without INV-P07).
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

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_update() IS
  'INV-P05: INICIADA -> CONFIRMADA | DESCARTADA, both terminal. No other transition. Also freezes ficha_tecnica_id/item_receta_id/iniciada_en/iniciada_por_id after insert.';

REVOKE UPDATE (fecha_vencimiento) ON fsj.preparacion FROM fsj_app;
ALTER TABLE fsj.preparacion DROP CONSTRAINT IF EXISTS preparacion_fecha_vencimiento_check;
ALTER TABLE fsj.preparacion DROP COLUMN IF EXISTS fecha_vencimiento;

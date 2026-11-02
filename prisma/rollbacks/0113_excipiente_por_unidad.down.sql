-- Rollback of 0113_excipiente_por_unidad (apply as a NEW forward migration). The code must be reverted too.
-- Preparaciones loaded per unidad keep their total (excipiente_cantidad) and their fórmula text; only the per-unit
-- quantity is dropped. Drafts typed per unidad would read as a total afterwards: this script aborts while any exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.excipiente_borrador WHERE por_unidad) THEN
    RAISE EXCEPTION 'Rollback 0113: excipiente drafts typed per unidad exist -- reserve or clear them first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fsj.preparacion_validar_excipiente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.excipiente_texto IS DISTINCT FROM OLD.excipiente_texto
      OR NEW.excipiente_droga_id IS DISTINCT FROM OLD.excipiente_droga_id
      OR NEW.excipiente_cantidad IS DISTINCT FROM OLD.excipiente_cantidad)
     AND OLD.estado <> 'INICIADA' THEN
    RAISE EXCEPTION 'INV-P08: the excipiente can only change while the preparacion is INICIADA (is %)', OLD.estado
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.excipiente_droga_id IS NOT NULL AND NEW.excipiente_droga_id IS DISTINCT FROM OLD.excipiente_droga_id
     AND NOT EXISTS (SELECT 1 FROM fsj.droga d WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.excipiente_droga_id AND d.clase = 'EXCIPIENTE') THEN
    RAISE EXCEPTION 'preparacion.excipiente_droga_id % is not a droga of clase EXCIPIENTE', NEW.excipiente_droga_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_excipiente() IS
  '0083/0092, INV-P08: the excipiente (texto, droga, cantidad) changes only while INICIADA; the droga must be of clase EXCIPIENTE.';

DROP TRIGGER IF EXISTS trg_preparacion_validar_excipiente ON fsj.preparacion;
CREATE TRIGGER trg_preparacion_validar_excipiente
  BEFORE UPDATE OF excipiente_texto, excipiente_droga_id, excipiente_cantidad ON fsj.preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.preparacion_validar_excipiente();

ALTER TABLE fsj.preparacion DROP CONSTRAINT IF EXISTS preparacion_excipiente_cantidad_por_unidad_check;
ALTER TABLE fsj.preparacion DROP COLUMN IF EXISTS excipiente_cantidad_por_unidad;
ALTER TABLE fsj.excipiente_borrador DROP COLUMN IF EXISTS por_unidad;

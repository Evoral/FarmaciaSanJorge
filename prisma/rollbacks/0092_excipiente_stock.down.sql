-- Rollback of 0092_excipiente_stock (apply as a NEW forward migration).
-- Refused while a reserva or an egreso without línea exists. Release those reservas first; an excipiente already
-- descontado is history: then keep section 2 (the column stays nullable) and revert only the draft table and the
-- code (docs/rollbacks/excipiente-preparacion.md).

-- 3. Draft
DROP TABLE IF EXISTS fsj.excipiente_borrador;

-- 2. Línea-less rows
DROP TRIGGER IF EXISTS trg_movimiento_stock_validar_excipiente ON fsj.movimiento_stock;
DROP TRIGGER IF EXISTS trg_reserva_stock_validar_excipiente ON fsj.reserva_stock;
DROP FUNCTION IF EXISTS fsj.validar_egreso_excipiente();
DROP FUNCTION IF EXISTS fsj.validar_reserva_excipiente();
ALTER TABLE fsj.movimiento_stock DROP CONSTRAINT movimiento_stock_linea_pesaje_check;
ALTER TABLE fsj.movimiento_stock
  ADD CONSTRAINT movimiento_stock_linea_pesaje_check CHECK (tipo <> 'EGRESO_PREPARACION' OR linea_pesaje_id IS NOT NULL);
ALTER TABLE fsj.reserva_stock ALTER COLUMN linea_pesaje_id SET NOT NULL;

-- 1. preparacion
DROP TRIGGER IF EXISTS trg_preparacion_validar_excipiente ON fsj.preparacion;
CREATE OR REPLACE FUNCTION fsj.preparacion_validar_excipiente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.excipiente_texto IS DISTINCT FROM OLD.excipiente_texto AND OLD.estado <> 'INICIADA' THEN
    RAISE EXCEPTION 'INV-P08: excipiente_texto can only change while the preparacion is INICIADA (is %)', OLD.estado
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_preparacion_validar_excipiente
  BEFORE UPDATE OF excipiente_texto ON fsj.preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.preparacion_validar_excipiente();
REVOKE UPDATE (excipiente_droga_id, excipiente_cantidad) ON fsj.preparacion FROM fsj_app;
ALTER TABLE fsj.preparacion
  DROP CONSTRAINT IF EXISTS preparacion_excipiente_cantidad_check,
  DROP CONSTRAINT IF EXISTS preparacion_excipiente_droga_fkey,
  DROP COLUMN IF EXISTS excipiente_cantidad,
  DROP COLUMN IF EXISTS excipiente_droga_id;

-- Rollback of 0127_corregir_datos_existencia_inicial (apply as a NEW forward migration).
-- Drops fsj.partida_corregir_datos_inicial and restores fsj.partida_validar_update to 0124 verbatim.
-- See docs/rollbacks/planilla-existencia-inicial.md.

-- 1. Drop function
DROP FUNCTION IF EXISTS fsj.partida_corregir_datos_inicial(uuid, uuid, text, date, uuid);

-- 2. Restore fsj.partida_validar_update to 0124 body verbatim
CREATE OR REPLACE FUNCTION fsj.partida_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cantidad_disponible IS DISTINCT FROM OLD.cantidad_disponible
     AND coalesce(current_setting('fsj.mov', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S01: partida.cantidad_disponible can only be changed by a movimiento_stock insert'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.cantidad_inicial IS DISTINCT FROM OLD.cantidad_inicial THEN
    IF coalesce(current_setting('fsj.mov', true), '') <> 'on' OR OLD.origen <> 'EXISTENCIA_INICIAL' THEN
      RAISE EXCEPTION 'INV-S01: partida.cantidad_inicial can only be changed by a movimiento_stock on an EXISTENCIA_INICIAL partida'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- INV-S17: once set, fecha_apertura never changes again (not even via
  -- the movimiento trigger).
  IF OLD.fecha_apertura IS NOT NULL AND NEW.fecha_apertura IS DISTINCT FROM OLD.fecha_apertura THEN
    RAISE EXCEPTION 'INV-S17: partida.fecha_apertura cannot change once set'
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-S16: the NULL -> value transition itself is also trigger-only.
  IF OLD.fecha_apertura IS NULL AND NEW.fecha_apertura IS NOT NULL
     AND coalesce(current_setting('fsj.mov', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S16: partida.fecha_apertura can only be set by a movimiento_stock insert'
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-S23 (0074): the original expiry is never rewritten; the vigente one
  -- only moves through a reanálisis.
  IF NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento THEN
    RAISE EXCEPTION 'INV-S23: partida.fecha_vencimiento cannot change (a reanálisis is recorded in fsj.reanalisis_partida)'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.fecha_vencimiento_vigente IS DISTINCT FROM OLD.fecha_vencimiento_vigente
     AND coalesce(current_setting('fsj.reanalisis', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S23: partida.fecha_vencimiento_vigente can only be changed by a reanalisis_partida insert'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.partida_validar_update() IS
  'INV-S01/S04, INV-S16/S17 (0008), INV-S23 (0074) and 0124: cantidad_disponible / fecha_apertura only through fsj.movimiento_stock_aplicar(), cantidad_inicial only for EXISTENCIA_INICIAL via movimiento_stock, fecha_vencimiento never, fecha_vencimiento_vigente only through fsj.reanalisis_partida_aplicar().';

-- Rollback of 0132_tipo_magnitud_actividad (apply as a NEW forward migration after 0133's rollback).
--
-- Postgres does not support dropping an enum value from fsj.tipo_magnitud.
-- Once no row in fsj.unidad_medida uses 'ACTIVIDAD' (dropped by 0133's rollback),
-- keeping the enum value is harmless. This guard fails if 0133 was not rolled back first.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.unidad_medida WHERE tipo_magnitud = 'ACTIVIDAD') THEN
    RAISE EXCEPTION 'Cannot rollback 0132: fsj.unidad_medida still has rows with tipo_magnitud = ACTIVIDAD (run 0133 rollback first)'
      USING ERRCODE = 'P0001';
  END IF;
END
$$;

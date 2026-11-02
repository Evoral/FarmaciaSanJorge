-- Rollback of 0112_concentracion_componente (apply as a NEW forward migration).
-- Only possible while NO componente uses CONCENTRACION: a receta loaded that way would lose its prescription. With
-- any present this script aborts; edit those recetas first. The enum value CONCENTRACION stays (Postgres cannot drop
-- an enum value); with no row using it, it is inert. Fichas keep their lines; only the prescripcion text is dropped.
-- The code must be reverted too.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.componente_item_receta WHERE modo_expresion::text = 'CONCENTRACION') THEN
    RAISE EXCEPTION 'Rollback 0112: componentes expressed as a concentration exist -- edit those recetas first';
  END IF;
END $$;

ALTER TABLE fsj.linea_pesaje DROP COLUMN IF EXISTS prescripcion;

ALTER TABLE fsj.componente_item_receta DROP CONSTRAINT IF EXISTS componente_item_receta_concentracion_check;
ALTER TABLE fsj.componente_item_receta DROP CONSTRAINT IF EXISTS componente_item_receta_unidad_referencia_fkey;
ALTER TABLE fsj.componente_item_receta DROP COLUMN IF EXISTS unidad_referencia_id;

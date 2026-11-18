-- Rollback of 0129_componente_posicion (apply as a NEW forward migration).
-- The componentes go back to the 0065 display rule; the load order is lost.

ALTER TABLE fsj.componente_item_receta DROP CONSTRAINT IF EXISTS componente_item_receta_posicion_check;
ALTER TABLE fsj.componente_item_receta DROP COLUMN IF EXISTS posicion;

-- Rollback of 0115_lote_elaborado_nombre (apply as a NEW forward migration). The code must be reverted too.
-- Drops the name and aspecto of the elaborated lots: their etiquetas can no longer be printed with them.

ALTER TABLE fsj.elaboracion_lote DROP CONSTRAINT IF EXISTS elaboracion_lote_nombre_check;
ALTER TABLE fsj.elaboracion_lote DROP CONSTRAINT IF EXISTS elaboracion_lote_aspecto_check;
ALTER TABLE fsj.elaboracion_lote DROP COLUMN IF EXISTS aspecto;
ALTER TABLE fsj.elaboracion_lote DROP COLUMN IF EXISTS nombre;

-- Rollback of 0130_etiqueta_fondo_color (apply as a NEW forward migration). The code must be reverted too.
-- Drops the configurable red background columns from fsj.etiqueta_hoja.

REVOKE UPDATE (formas_fondo_rojo, tono_fondo_rojo) ON fsj.etiqueta_hoja FROM fsj_app;
ALTER TABLE fsj.etiqueta_hoja
  DROP CONSTRAINT IF EXISTS etiqueta_hoja_tono_fondo_rojo_check,
  DROP COLUMN IF EXISTS formas_fondo_rojo,
  DROP COLUMN IF EXISTS tono_fondo_rojo;

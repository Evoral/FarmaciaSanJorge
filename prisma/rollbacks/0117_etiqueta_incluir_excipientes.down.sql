-- Rollback of 0117_etiqueta_incluir_excipientes (apply as a NEW forward migration). The code must be reverted too.
-- Drops the default of the "Incluir excipientes en la etiqueta" switch; etiquetas already generated keep their content.

REVOKE UPDATE (incluir_excipientes) ON fsj.etiqueta_hoja FROM fsj_app;
ALTER TABLE fsj.etiqueta_hoja DROP COLUMN IF EXISTS incluir_excipientes;

-- Rollback of 0083_preparacion_excipiente. Apply as a NEW forward migration, AFTER deploying the code that no longer
-- reads or writes preparacion.excipiente_texto. Asientos already written keep the excipiente inside their hashed
-- formula_texto: dropping the column does not touch them.
DROP TRIGGER IF EXISTS trg_preparacion_validar_excipiente ON fsj.preparacion;
DROP FUNCTION IF EXISTS fsj.preparacion_validar_excipiente();
REVOKE UPDATE (excipiente_texto) ON fsj.preparacion FROM fsj_app;
ALTER TABLE fsj.preparacion DROP CONSTRAINT IF EXISTS preparacion_excipiente_texto_check;
ALTER TABLE fsj.preparacion DROP COLUMN IF EXISTS excipiente_texto;

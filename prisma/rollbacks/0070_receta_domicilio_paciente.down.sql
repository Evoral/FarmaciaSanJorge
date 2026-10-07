-- Rollback of 0070_receta_domicilio_paciente. Apply as a NEW forward
-- migration, together with the code that no longer reads/writes
-- domicilio_paciente (docs/rollbacks/receta-domicilio-paciente.md).
--
-- DATA LOSS: the patient's domicilio stored on each receta. The audit rows
-- (fsj.registro_auditoria, entidad "receta") keep the values that were
-- loaded or edited.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'fsj'
      AND table_name = 'receta'
      AND column_name = 'domicilio_paciente'
  ) THEN
    REVOKE UPDATE (domicilio_paciente) ON fsj.receta FROM fsj_app;
  END IF;
END
$$;

ALTER TABLE fsj.receta DROP COLUMN IF EXISTS domicilio_paciente;

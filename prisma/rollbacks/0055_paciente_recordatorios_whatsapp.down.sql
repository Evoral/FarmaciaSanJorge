-- Rollback of 0055_paciente_recordatorios_whatsapp (docs/rollbacks/pacientes-recurrentes.md).
-- Prisma has no "down": apply this as the body of a NEW forward migration
-- (next free number, e.g. 0056_revert_paciente_recordatorios_whatsapp).
--
-- DATA LOSS: dropping the column discards every stored consent value. After
-- a rollback no patient has a recorded WhatsApp opt-in, and re-applying 0055
-- would bring them all back as `false`. The values remain only in
-- fsj.registro_auditoria (valor_anterior / valor_nuevo of paciente CREAR and
-- MODIFICAR entries).
--
-- The column-level grant is revoked first, guarded so the script is safe to
-- re-run (REVOKE on a column that no longer exists would raise). Dropping the
-- column removes its privileges anyway; the explicit REVOKE just mirrors 0055.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'fsj'
      AND table_name = 'paciente'
      AND column_name = 'acepta_recordatorios_whatsapp'
  ) THEN
    REVOKE UPDATE (acepta_recordatorios_whatsapp) ON fsj.paciente FROM fsj_app;
  END IF;
END
$$;

ALTER TABLE fsj.paciente DROP COLUMN IF EXISTS acepta_recordatorios_whatsapp;

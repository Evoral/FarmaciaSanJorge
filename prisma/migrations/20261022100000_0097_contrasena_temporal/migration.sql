-- 0097_contrasena_temporal
--
-- docs/specs/contrasena-temporal.md: an alta (or "Restablecer contraseña") now sets a temporary password chosen by
-- the admin instead of issuing an activation link. The user logs in with it and is forced to pick their own.
--
--   1. fsj.usuario.debe_cambiar_password (boolean, default false): true while the user still has to replace the
--      temporary password. Login routes a flagged user to the change-password page; changing the password clears it.
--      An alta may insert straight into ACTIVO with password_hash + this flag (the estado trigger only watches
--      UPDATE OF estado), so no backfill is needed: every existing usuario keeps false.
--   2. fsj_app: UPDATE on the new column (the grants of this table are per column, migration 0013).
--   3. One-off data fix: revoke every LIVE credencial_activacion. The activation-link flow is gone, so no code reads
--      or writes the table any more; it is kept as history. Revoking the live rows stops a link emitted before the
--      deploy from activating anything in the meantime. Used and already revoked rows are left untouched, and the
--      INV-AU-002 trigger forbids touching them anyway.
--
-- Runs as the migration owner, so the data fix bypasses RLS across every tenant (as 0078 did for the PIN reset).
--
-- *** APPLY 0097 BEFORE DEPLOYING THE CODE THAT USES IT. The previous code ignores the column, so it keeps running
-- against the 0097 schema. ***
-- Rollback: prisma/rollbacks/0097_contrasena_temporal.down.sql (as a NEW forward migration;
-- docs/rollbacks/contrasena-temporal.md).

-- ============================================================================
-- 1. Column
-- ============================================================================
ALTER TABLE fsj.usuario ADD COLUMN IF NOT EXISTS debe_cambiar_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fsj.usuario.debe_cambiar_password IS
  'True while the usuario logs in with an admin-chosen temporary password and must replace it (docs/specs/contrasena-temporal.md). Set by alta and "Restablecer contraseña"; cleared when the usuario changes their own password.';

-- ============================================================================
-- 2. Grant
-- ============================================================================
GRANT UPDATE (debe_cambiar_password) ON fsj.usuario TO fsj_app;

-- ============================================================================
-- 3. Revoke live activation credentials (history is kept; nothing reads or writes the table any more)
-- ============================================================================
UPDATE fsj.credencial_activacion SET revocada_en = now() WHERE usada_en IS NULL AND revocada_en IS NULL;

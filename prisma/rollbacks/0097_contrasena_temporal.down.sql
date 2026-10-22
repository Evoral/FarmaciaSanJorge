-- Rollback of 0097_contrasena_temporal. Apply as a NEW forward migration, AFTER deploying the code that no longer
-- reads or writes debe_cambiar_password (docs/rollbacks/contrasena-temporal.md has the full procedure).
--
-- DATA LOSS: the flag itself, i.e. which usuarios still had a temporary password pending to change. After the
-- rollback those usuarios keep the temporary password as an ordinary one.
-- NOT REVERSIBLE: the credencial_activacion rows revoked by 0097 cannot be un-revoked (INV-AU-002 forbids changing
-- revocada_en once set). A usuario who still needs an activation link gets a new one from the old code's
-- "Restablecer credencial".

REVOKE UPDATE (debe_cambiar_password) ON fsj.usuario FROM fsj_app;
ALTER TABLE fsj.usuario DROP COLUMN IF EXISTS debe_cambiar_password;

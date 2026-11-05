-- Rollback of 0118_medico_email (apply as a NEW forward migration). The code must be reverted too.
-- Drops the médico's email; the emails already loaded are lost.

REVOKE UPDATE (email) ON fsj.medico FROM fsj_app;
ALTER TABLE fsj.medico DROP COLUMN IF EXISTS email;

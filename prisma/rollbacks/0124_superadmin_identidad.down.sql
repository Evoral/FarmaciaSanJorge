-- Rollback of 0124_superadmin_identidad (apply as a NEW forward migration). Revert the stage-1 code FIRST
-- (docs/rollbacks/plataforma-superadmin.md): login() stops calling fsj.superadmin_resolve_login() before it is dropped.
-- Loses every superadmin, platform session and platform audit row. Export fsj.plataforma_auditoria first if it matters.
-- Requires 0125 and 0126 rolled back before (their functions and tables depend on these).

DROP TRIGGER IF EXISTS trg_usuario_email_login_unico ON fsj.usuario;

DROP FUNCTION IF EXISTS fsj.plataforma_cerrar_sesion(text, text, text);
DROP FUNCTION IF EXISTS fsj.plataforma_validar_sesion(text);
DROP FUNCTION IF EXISTS fsj.plataforma_actor(text);
DROP FUNCTION IF EXISTS fsj.plataforma_login_fallido(uuid, integer, timestamptz, text, text);
DROP FUNCTION IF EXISTS fsj.plataforma_iniciar_sesion(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS fsj.plataforma_auditar(uuid, text, text, uuid, uuid, jsonb, jsonb, text, text, text);
DROP FUNCTION IF EXISTS fsj.superadmin_resolve_login(text);

-- The forbid_* triggers fire on DML and TRUNCATE only, so DROP TABLE is not blocked.
DROP TABLE IF EXISTS fsj.plataforma_auditoria;
DROP TABLE IF EXISTS fsj.superadmin_sesion;
DROP TABLE IF EXISTS fsj.superadmin;

DROP FUNCTION IF EXISTS fsj.email_login_unico();
DROP TYPE IF EXISTS fsj.estado_superadmin;

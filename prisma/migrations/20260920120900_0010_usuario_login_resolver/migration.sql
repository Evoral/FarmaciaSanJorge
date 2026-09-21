-- 0010_usuario_login_resolver
--
-- FASE 2, points 2.2 (login) and 2.3 (activation): a narrow RLS bootstrap
-- function for looking a usuario up BY EMAIL, with no tenant known yet.
-- Depends on 0002 (fsj.usuario).
--
-- THE PROBLEM this solves (same shape as migration 0009's
-- fsj.sesion_resolve_tenant, for the same reason): `fsj.usuario` is
-- tenant-scoped with RLS (`fsj.setup_tenant_table`, policy
-- `tenant_id = fsj.current_tenant_id()`), same as every business table
-- (INV-T01). `email` is GLOBALLY unique (DP-40 RESUELTA: login is email +
-- password, no tenant selector -- migration 0002's `usuario_email_key`
-- constraint), by design. But `fsj_app` cannot resolve `app.tenant_id`
-- from an email without already knowing the tenant -- and without that
-- setting, RLS hides every `fsj.usuario` row (`fsj.current_tenant_id()`
-- returns NULL ⇒ zero rows). `fsj_app` cannot be granted BYPASSRLS to work
-- around this (that would defeat INV-T01 for every other table too).
--
-- THE FIX: a SECURITY DEFINER function, owned by the migration owner
-- (`postgres`, which has BYPASSRLS), pinned to `search_path = fsj,
-- extensions`, with EXECUTE granted ONLY to `fsj_app`. Unlike
-- `sesion_resolve_tenant` (which returns ONLY `tenant_id`, forcing the
-- caller to re-read the full row through the normal RLS-protected path
-- afterwards), this function is allowed to return the small, NAMED set of
-- columns `login()`/`activarCuenta()` actually need in one round trip:
-- `tenant_id`, `usuario_id`, `password_hash`, `estado`, and the two
-- lockout fields (`intentos_fallidos`, `bloqueado_hasta`) -- nothing else
-- (no roles/permisos, no other usuario column, no other table). The
-- reason this one can't defer to a second read the way session validation
-- does: there IS no tenant-scoped re-read of "usuario by email" possible
-- before the tenant is known -- that would be circular. Every WRITE that
-- follows (incrementing intentos_fallidos, setting bloqueado_hasta,
-- consuming a credencial_activacion, flipping estado to ACTIVO) happens
-- afterwards, inside a normal `withTenantTransaction(tenant_id, ...)` with
-- the tenant_id this function returned -- so INV-T01 governs everything
-- past this single bootstrap read, exactly like migration 0009.
--
-- Returns ZERO ROWS for an unknown email (never a row of NULLs) --
-- `login()`/`activarCuenta()` MUST treat "no row" and "row found but
-- password/credential does not match" with the IDENTICAL generic error
-- message (FASE 2 point 2.2: no enumeration vector).
--
-- Reused for BOTH login (2.2) and activation (2.3): activation also only
-- has an email + one-use code, no tenant, and the credencial_activacion
-- row it needs to consume is looked up by (tenant_id, usuario_id,
-- token_hash) once this function has resolved those first two -- so a
-- second SECURITY DEFINER function is not needed for activation.
CREATE OR REPLACE FUNCTION fsj.usuario_resolve_login(p_email text)
RETURNS TABLE (
  tenant_id          uuid,
  usuario_id         uuid,
  password_hash      text,
  estado             fsj.estado_usuario,
  intentos_fallidos  integer,
  bloqueado_hasta    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
  SELECT tenant_id, id, password_hash, estado, intentos_fallidos, bloqueado_hasta
  FROM fsj.usuario
  WHERE email = p_email::extensions.citext;
$$;

COMMENT ON FUNCTION fsj.usuario_resolve_login(text) IS
  'M02 RLS bootstrap for login/activation lookup by email (see migration header). SECURITY DEFINER: runs with the owning role''s privileges (bypasses RLS) but returns ONLY the columns login()/activarCuenta() need for the matching usuario row -- no roles, no other usuario column, no other table. Callers (modules/auth/infrastructure) open a normal withTenantTransaction(tenant_id, ...) with the returned tenant_id for every subsequent write, so INV-T01 governs everything past this single bootstrap read. Returns zero rows (not a row of NULLs) for an unknown email.';

-- Defense in depth: explicit REVOKE FROM PUBLIC before the explicit GRANT
-- (mirrors migration 0009's sesion_resolve_tenant and migration 0003's
-- registro_auditoria REVOKE).
REVOKE ALL ON FUNCTION fsj.usuario_resolve_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.usuario_resolve_login(text) TO fsj_app;

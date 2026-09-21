-- 0009_sesion_tenant_resolver
--
-- FASE 2, point 2.1: a narrow RLS bootstrap function for session
-- validation. Depends on 0004 (fsj.sesion).
--
-- THE PROBLEM this solves: `fsj.sesion` is tenant-scoped with RLS
-- (`fsj.setup_tenant_table`, policy `tenant_id = fsj.current_tenant_id()`),
-- same as every business table (INV-T01). `token_hash` is GLOBALLY unique
-- (no tenant_id in its UNIQUE constraint -- migration 0004), by design:
-- the session cookie carries only the opaque token, not the tenant id, so
-- `validateSession()` does not know which tenant to `set_config
-- ('app.tenant_id', ...)` to BEFORE it has looked the row up -- and without
-- that setting, RLS hides every `fsj.sesion` row from `fsj_app`
-- (`fsj.current_tenant_id()` returns NULL ⇒ `tenant_id = NULL` is never
-- true ⇒ zero rows, see docs/architecture.md's RLS row). `fsj_app` cannot
-- be granted BYPASSRLS to work around this (that would defeat INV-T01 for
-- every other table too).
--
-- THE FIX: a SECURITY DEFINER function, owned by the migration owner
-- (`postgres`, which has BYPASSRLS), that accepts only a token_hash and
-- returns ONLY the matching tenant_id -- nothing else: no usuario_id, no
-- expiry, no revocation status, not even whether the token_hash is
-- otherwise valid. `validateSession()` calls this ONCE to bootstrap the
-- tenant, then opens a normal `withTenantTransaction(tenantId, ...)` and
-- re-reads the full row through the ordinary RLS-protected path to do
-- every real validity check (revoked? expired? usuario ACTIVO? tenant not
-- given de baja?). This keeps the RLS bypass surface to the single
-- smallest fact needed to bootstrap tenant context, and everything else
-- stays governed by INV-T01 as normal.
CREATE OR REPLACE FUNCTION fsj.sesion_resolve_tenant(p_token_hash text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
  SELECT tenant_id FROM fsj.sesion WHERE token_hash = p_token_hash;
$$;

COMMENT ON FUNCTION fsj.sesion_resolve_tenant(text) IS
  'M02 RLS bootstrap for session validation (see migration header). SECURITY DEFINER: runs with the owning role''s privileges (bypasses RLS) but returns ONLY tenant_id for a given token_hash -- no other column, no existence-beyond-tenant-id information. Callers (modules/auth/infrastructure) MUST still re-validate the full session row through a normal tenant-scoped (RLS-protected) query before trusting it.';

-- Defense in depth: explicit REVOKE FROM PUBLIC before the explicit GRANT,
-- even though nothing grants EXECUTE on new functions to PUBLIC by default
-- in this database (no such ALTER DEFAULT PRIVILEGES exists) -- documents
-- the intent the same way migration 0003's REVOKE does for
-- registro_auditoria.
REVOKE ALL ON FUNCTION fsj.sesion_resolve_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.sesion_resolve_tenant(text) TO fsj_app;

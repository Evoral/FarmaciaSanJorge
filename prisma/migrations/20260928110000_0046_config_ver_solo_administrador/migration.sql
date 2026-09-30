-- 0046_config_ver_solo_administrador
--
-- User decision (2026-09-28): the "Configuración" admin area
-- (/admin/configuracion/{farmacia,parametros,precios}) is ADMINISTRADOR-only,
-- with ONE deliberate exception: DIRECTOR_TECNICO keeps
-- `precios.reglas.editar` (untouched here), so a DT still sees
-- "Configuración" in the sidebar with only the "Reglas de precio" tab.
--
-- Migration 0002 seeded `config.ver` for ALL FIVE roles on the theory that
-- the tenant's institutional data and weighing parametros were harmless to
-- read and the real boundary was `config.editar`. The user now wants those
-- two screens hidden from every non-admin role, so this migration REVOKES
-- `config.ver` from DIRECTOR_TECNICO, FARMACEUTICO, ATENCION_PUBLICO and
-- SOLO_CONSULTA. ADMINISTRADOR keeps both `config.ver` and `config.editar`.
--
-- Blast radius (verified before writing this): `config.ver` is enforced
-- only by modules/farmacia/application/get-datos-tenant.ts and
-- modules/parametros/application/list-parametros.ts (used exclusively by
-- the two config pages) plus the UI gating in app/(app)/nav-sections.ts and
-- the farmacia/parametros layouts. Every other reader of fsj.tenant /
-- fsj.parametro (labels, jornada/time zone, preparaciones, stock) goes
-- straight through its own repository inside its own use case and never
-- checks `config.ver`, so no operational flow loses access.
--
-- Why a plain DELETE is acceptable here: fsj.rol_permiso is a GLOBAL
-- catalog (no tenant_id, no RLS) with NO forbid_delete /
-- forbid_update_delete trigger and no audit trigger -- unlike the
-- legal/business tables, a role->permiso row carries no history of its own
-- (grants are re-read from this table on every request, see
-- modules/auth/application/validate-session.ts). The app role is meant to
-- only read it (migration 0002 revokes INSERT from fsj_app); migrations run
-- as the owner, so the DELETE below needs no extra grant.
-- This is the first REVOCATION in the migration set, so there is no prior
-- pattern to follow beyond 0043's join-by-codigo shape.
--
-- Idempotent: joins by rol/permiso codigo, so a re-run (or a database where
-- the rows are already gone) deletes nothing. The `fsj.permiso` row for
-- `config.ver` itself stays -- ADMINISTRADOR still holds it, and
-- modules/auth/domain/permisos.ts#PERMISO_CODES must keep matching the
-- catalog (tests/db/auth-permisos.test.ts).
--
-- Mirrored in tests/db/auth-permisos.test.ts (EXPECTED_ROL_PERMISOS),
-- tests/unit/farmacia-authorization-matrix.test.ts and
-- tests/unit/parametros-authorization-matrix.test.ts (SEED_GRANTS).
--
-- Only touches seeded catalog rows -- no new tables/columns, so no
-- GRANT/REVOKE statements are needed (same as migrations 0040/0043).

DELETE FROM fsj.rol_permiso rp
USING fsj.rol r, fsj.permiso p
WHERE rp.rol_id = r.id
  AND rp.permiso_id = p.id
  AND p.codigo = 'config.ver'
  AND r.codigo IN ('DIRECTOR_TECNICO', 'FARMACEUTICO', 'ATENCION_PUBLICO', 'SOLO_CONSULTA');

# Rollback: Contraseña temporal

Spec: `docs/specs/contrasena-temporal.md`. The feature has a **schema change** (migration
`prisma/migrations/20261022100000_0097_contrasena_temporal`), so it is reverted as code + a new
forward migration built from `prisma/rollbacks/0097_contrasena_temporal.down.sql`.

## What the down migration loses

- `usuario.debe_cambiar_password`: which usuarios still had a temporary password pending to
  change. After the rollback they keep that password as an ordinary one.
- Not reversible: the `credencial_activacion` rows 0097 revoked. INV-AU-002 forbids changing
  `revocada_en` once set. A usuario that still needs an activation link gets a new one from the
  old code's "Restablecer credencial".

## Order

1. Deploy the reverted code **first**: it neither reads nor writes `debe_cambiar_password`, and
   the column has a default, so it runs fine against the 0097 schema.
2. Copy `prisma/rollbacks/0097_contrasena_temporal.down.sql` into a NEW migration folder (next
   free number, a timestamp later than every existing one) and apply it. Never edit or delete the
   applied 0097 migration.
3. Revert the code (below), `npm run db:generate`, then `npm run typecheck`, `npm run lint`,
   `npm test`.

## New files (delete on rollback)

- `prisma/rollbacks/0097_contrasena_temporal.down.sql` and this file (optional)
- `prisma/migrations/20261022100000_0097_contrasena_temporal/` (keep it once applied)
- `app/(pasos)/` (`layout.tsx`, `cambiar-password/`, `configurar-pin/`), `app/(app)/cuenta/cuenta-forms.tsx`
- `modules/auth/application/{cambiar-password-temporal,configurar-pin-obligatorio}.ts`,
  `modules/auth/domain/pasos-pendientes.ts`, `shared/auth/pasos.ts`
- `modules/usuarios/application/password-temporal.ts`, `shared/ui/brand-header.tsx`
- Tests: `tests/db/contrasena-temporal.test.ts`, `tests/unit/{activation-flow-removed,auth-cambiar-password-temporal,auth-configurar-pin-obligatorio,auth-pasos-pendientes,auth-pasos-registry,auth-pin-removed,auth-require-session-gate,contrasena-temporal-co-firma,contrasena-temporal-operadores,contrasena-temporal-restablecer,create-tenant-script}.test.ts`

## Edited files (revert the contraseña temporal hunks)

- `prisma/schema.prisma`: `debeCambiarPassword` in `model Usuario`.
- Pipeline and session: `shared/usecase.ts` (`permitirPasosPendientes`), `shared/auth/{policy,session}.ts`,
  `shared/errors/index.ts` (`PASOS_PENDIENTES`), `shared/ui/{action-error.ts,form-parts.tsx,toast.tsx}`,
  `shared/labels/field-labels.ts`, `shared/audit/request-context.ts`, `proxy.ts`, `next.config.ts`.
- Auth: `modules/auth/application/{cambiar-password,create-session,login,logout,reautenticar,require-session,validate-session,verificar-operador}.ts`,
  `modules/auth/domain/{operador-policy,session,token}.ts`,
  `modules/auth/infrastructure/{session-repository,usuario-repository}.ts`, `modules/auth/ui/new-password-fields.tsx`,
  `modules/operadores/infrastructure/operadores-repository.ts`.
- Co-firma (CT8): `modules/stock/domain/co-firma.ts`, `modules/{stock,libro}/infrastructure/co-firma-repository.ts`,
  `modules/{stock,libro}/application/verificar-co-firma-dt.ts`.
- Usuarios: `modules/usuarios/application/{crear-usuario,dar-de-baja-usuario,reactivar-usuario,restablecer-credencial,suspender-usuario}.ts`,
  `modules/usuarios/infrastructure/usuario-repository.ts`, `modules/usuarios/ui/{actions.ts,restablecer-credencial.tsx}`.
- Routes: `app/(app)/{layout,error}.tsx`, `app/(app)/cuenta/{actions.ts,page.tsx}`,
  `app/(app)/admin/accesos/usuarios/{[id]/page.tsx,nuevo/actions.ts,nuevo/nuevo-usuario-form.tsx}`,
  `app/(auth)/{layout.tsx,login/actions.ts,login/page.tsx}`, and the `PASOS_PENDIENTES: 403` entry in the
  error-code map of the `app/api/**/route.ts` handlers (cierres, entregas, fichas-tecnicas, libro,
  preparaciones, recetas, stock).
- `scripts/create-tenant.ts` (temporary password instead of the activation credential), `modules/README.md`.
- Docs: `docs/specs/cuentas-de-sector.md` (S7, Pantallas), `shared/auth/README.md`, `docs/deploy.md` §5.
- Tests: `tests/db/{inv-u07-actor-activo,usuarios-admin}.test.ts`,
  `tests/unit/{action-error,auth-login,auth-pin-never-for-login-or-cofirma,auth-policy,cuentas-de-sector-alta,cuentas-de-sector-verificar-operador,roles-personalizables-usecases,usecase,usuarios-authorization-matrix,usuarios-crear-usuario-audit,usuarios-m3-lock-order,stock-co-firma,usuarios-usecase-registry}.test.ts`.

## Deleted files (restore on rollback)

- `app/(auth)/activar/{actions.ts,page.tsx}`
- `modules/auth/application/{activar-cuenta,eliminar-pin}.ts`, `modules/auth/domain/activation-policy.ts`
- `modules/usuarios/ui/credencial-activacion.tsx`
- Tests: `tests/unit/auth-activation-policy.test.ts`; `tests/db/auth-login-activacion.test.ts` was
  renamed to `tests/db/auth-login.test.ts` (its activation cases were dropped).
- Helpers removed from the two `usuario-repository.ts` files (`consumeCredencialActivacion`,
  `activarUsuario`, `insertCredencialActivacion`, `revokeCredencialesActivas`) and
  `AUTH_POLICY.activationCredentialTtlHours`: they come back with the revert of those files.

## Nothing to undo

- No permiso, role, route or parameter is added by the migration itself.

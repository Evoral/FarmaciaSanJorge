# shared/auth

`policy.ts` (FASE 1.4): pure constants -- no I/O, see its header.

`session.ts` / `authorize.ts` (FASE 2, point 2.1/2.6): thin public facades.
The actual implementation -- opaque DB-backed sessions, `requireSession()`,
`authorize(permiso)`/`can(permiso)`, the typed `Permiso` union -- lives in
`modules/auth/{domain,application,infrastructure}` (M02/M03 are business
modules like any other, per `modules/README.md`'s layering). These two
files just re-export the stable entry points so callers (and
`shared/usecase.ts`, which must not import from `modules/*` -- that would
invert the shared -> modules dependency direction the rest of the codebase
relies on) have one place to import "sessions"/"authorization" from.

`requireRecentReauth()` (step-up re-authentication, INV-X02) is re-exported by
`session.ts` from `modules/auth/domain/step-up.ts`; commands declare it through
`defineCommand`'s `requireRecentReauth` option (only `reanclarLibro` uses it since
the 2026-10-21 decision).

`operador.ts` / `operador-context.ts` / `operador-campos.ts` (cuentas de sector,
`openspec/specs/cuentas-de-sector/spec.md`): on a session shared by the empleados of a
work area, WHO is acting. `operador-context.ts` carries the credential a Server
Action received (`conOperador(formData, ...)`) to the use-case pipeline for the
duration of the request; `operador.ts` is the facade over the verification in
`modules/auth`; `operador-campos.ts` holds the form field names (client-safe).

## Login

`modules/auth/application/login.ts` handles authentication against policies in
`shared/auth/policy.ts`:
- Every rejection returns the same generic error message, and argon2 verification
  always runs (using a dummy hash if the email does not exist) to prevent enumeration.
- Accounts are temporarily locked out after `maxFailedLoginAttempts` failures.
- Every rejection is padded to `loginFallidoMinimoMs` (P2-01) from the start, so
  response times cannot differentiate existing accounts from unknown ones; successful logins do not wait.

## Platform sessions (superadmin)

`openspec/specs/plataforma/spec.md`. A superadmin is not a usuario: no tenant, no permisos, no pending steps.
`login()` looks it up only when no usuario has the email (`fsj.superadmin_resolve_login`, same rejection floor). Its
session is `fsj.superadmin_sesion` and its cookie `fsj_plataforma` (`Path=/plataforma`); logging in as one kind clears
the cookie of the other kind. `plataforma.ts` re-exports `requireSuperAdmin()` (throws `AuthenticationError`) and
`superAdminActual()` (never throws, for the layout); both fail closed, and the lifecycle (15 min idle, 8 h absolute) is
checked only in SQL. Every `fsj.plataforma_*` function validates the token hash again.

## Pasos pendientes

`openspec/specs/contrasena-temporal/spec.md`. The session carries `pasosPendientes`
(`PasoPendiente[]`, `shared/auth/pasos.ts`): `"cambiar-password"` while
`usuario.debe_cambiar_password` is set, then `"configurar-pin"` for a usuario
that has no PIN and is not a cuenta de sector, the SISTEMA user, or a usuario
whose only role is Administrador (`esSoloAdministrador`; Administrador plus
another role still needs a PIN). The session also carries `soloAdministrador`
so `/cuenta` can hide the PIN panel. It is derived in `validateSession`
(`derivarPasosPendientes`) from columns `findSesionCompletaByTokenHash` loads,
never stored per session.

`requireSession()` throws `PasosPendientesError` (code `PASOS_PENDIENTES`)
while any step is pending, so every page and every use case is blocked by
default. Only the flows that resolve or leave the steps opt out: pages and
layouts call `requireSession({ permitirPasosPendientes: true })`, use cases set
`permitirPasosPendientes: true` in `defineCommand`/`defineQuery`. The allowlist
is pinned by `tests/unit/auth-pasos-registry.test.ts` (today: `auth.logout`,
`auth.password.cambiarTemporal`, `auth.pin.configurarObligatorio`); widening it
is a reviewed change to that test.

The step pages live in the `app/(pasos)` route group (`/cambiar-password`,
`/configurar-pin`), outside `app/(app)`: `app/(app)/layout.tsx` redirects a
session with a pending step to its page (`rutaDelPaso`).

The `proxy.ts` optimistic guard lives at the repo root (Next.js
convention), not here -- see that file's own header comment.

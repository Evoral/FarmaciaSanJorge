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

## Adding a verification method

`openspec/specs/cuentas-de-sector/spec.md`. How an empleado proves who they are on a shared session is a closed
catalog (`MetodoVerificacion`, today the PIN and the huella). Three registries are mapped types over it, so a method missing from any
of them fails `npm run typecheck`: the domain catalog (`modules/auth/domain/verificacion-identidad.ts`: proof
variant, label, proof keys, always-on flag, storage), the server registry
(`modules/auth/application/metodos-verificacion.ts`) and the client registry
(`modules/operadores/ui/metodos-en-dialogo.tsx`). The carrier (`operador-context.ts`), the form plumbing, the
rejection field marker, the logger redaction and the audit label derive from the catalog through `operador-campos.ts`
and never name a method.

1. Domain: add the proof variant to `PruebaDeIdentidad`, and its `METODOS` entry (label, keys,
   `almacen`); `METODOS_VERIFICACION` is derived from the `METODOS` keys.
2. Server: add the `REGISTRO` entry: the proof schema (only shape and a loose bound: a code shorter than the method's
   minimum must be a failed, audited identification, not a malformed proof; a malformed or unknown-method proof gets
   the generic rejection and is NOT audited, only a disabled method or a failed identification is), the `identificador`, the two `rechazo`
   texts and `rechazoGenerico` (what the terminal is told for every other rejection of the method: disabled, malformed,
   identified but not eligible; the PIN's is the historical text). A code method uses `identificadorPorCodigo(metodo,
   clave, fuente, { longitudMinima })`; for `almacen: "CREDENCIAL_OPERADOR"` the source is `fuenteDeCredencial(metodo)`
   (`identificador-credencial.ts`, over `fsj.credencial_operador`: no migration, no repository code) and the entry also
   carries `enrolamiento` (proof key, the zod rules of an enrolled code, the source, the "not available" text). Any
   other method writes its own `IdentificadorDeEmpleado`.
3. Client: add the `METODOS_EN_DIALOGO` entry (`Campo` + `prioridad` + `ayuda`, optionally `notaDeConfiguracion`, shown under
   the method's switch in the farmacia configuration). `Campo` receives `invalido` (mark the control after a rejection).
   A keyboard-wedge reader method sets `lector: true`: after answering, the dialog stays mounted for a moment and its form
   swallows further submits, so a reader's second Enter cannot reach the page behind it. A typed method (the PIN) omits
   the flag and its dialog closes immediately. A scanned secret uses `shared/ui/codigo-lector-input.tsx` (masked text, no password
   manager), not `<input type="password">` (browsers offer to save it).
4. Enrollment: a code method with `almacen: "CREDENCIAL_OPERADOR"` reuses the generic use cases
   (`auth.credencialOperador.registrar` / `.eliminar`, `usuarios.credencialOperador.eliminar`), which read the
   method's `enrolamiento` and are keyed by `METODOS_CON_CREDENCIAL_PROPIA` (derived from the catalog). The code travels
   in the input under the proof key (`huella`), which the logger redacts. The «Mi cuenta» panel (`app/(app)/cuenta`), its
   Server Actions and the Usuarios › detalle section are per method (the field names differ): the page learns whether
   the method is on and enrolled from `auth.credencialOperador.estado` (generic over `METODOS_CON_CREDENCIAL_PROPIA`),
   the Administrador's view from `UsuarioDetalle.credencialesOperador`. Any other method writes its own use cases.
5. A two-step method (WebAuthn) implements `iniciar`. Add one `iniciarVerificacionAction(metodo)` in
   `modules/operadores/ui/actions.ts` that calls it and stores the challenge server-side, single-use. Its `Campo` fetches
   the challenge on mount and puts the signed assertion into its proof keys; the verifier checks it inside `identificar`.
6. Run `npm run typecheck`: it lists every registry still missing the method. Nothing else changes: not the carrier,
   the `conOperador` sites, `resolverActor`, the logger, the audit writer or the field markers.

What the typecheck does NOT tell you (found adding the huella): a test that treats a method name as "unknown" (the guard
rows of `cuentas-de-sector-verificar-operador.test.ts` used `HUELLA` before it existed); a test that extends the catalog
in memory with a fake optional method (`operadores-metodos-verificacion.test.ts`) once a real one exists; the sentence of
the audit label (`auditoria-diff.tsx` lowercases a word label: «identificado con huella», the acronym PIN stays); the
panel copy in «Mi cuenta» and Usuarios › detalle (no registry carries it); the
`ayuda-permisos.ts` text of `auth.password.cambiar` and `usuarios.credencial.restablecer`; and the stored `metodo` must
match `^[A-Z][A-Z_]{1,29}` (the CHECK of 0136 and 0137).

Per-farmacia enablement needs no step: a method with `siempreHabilitado: false` is off until an Administrador switches
it on in `/admin/configuracion/pin` (`fsj.metodo_verificacion_habilitado`, migration 0136), the section lists it by
itself, and `verificarOperadorEnTx` rejects it (audited `DESHABILITADO`) while it is off. The set travels with the
session (`session.sector.metodosHabilitados`, `loadMetodosHabilitados`; absent means only the always-on methods) and
the layout hands it to the dialog. A method that is on by default would need a seed in `fsj.crear_tenant_interno`.

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

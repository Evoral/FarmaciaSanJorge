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
`defineCommand`'s `requireRecentReauth` option.

`operador.ts` / `operador-context.ts` / `operador-campos.ts` (cuentas de sector,
`docs/specs/cuentas-de-sector.md`): on a session shared by the empleados of a
work area, WHO is acting. `operador-context.ts` carries the credential a Server
Action received (`conOperador(formData, ...)`) to the use-case pipeline for the
duration of the request; `operador.ts` is the facade over the verification in
`modules/auth`; `operador-campos.ts` holds the form field names (client-safe).

The `proxy.ts` optimistic guard lives at the repo root (Next.js
convention), not here -- see that file's own header comment.

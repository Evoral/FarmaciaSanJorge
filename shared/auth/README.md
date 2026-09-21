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

`requireRecentReauth()` (step-up re-authentication, INV-X02) is still a
placeholder -- lands with FASE 2 point 2.5, out of scope for 2.1/2.6/2.7.

The `proxy.ts` optimistic guard lives at the repo root (Next.js
convention), not here -- see that file's own header comment.

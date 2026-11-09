# Proposal — Plataforma: superadmin y consola de farmacias

> **Status:** draft for review. User decision (2026-11-09): "armá el spec y comentame tus decisiones" -- every decision
> below marked *(Claude)* is a default the user has not confirmed yet. Resolves DP-37 (operador de plataforma) and
> plan point 3.12 (`docs/plan-implementacion.md`).

## Why

Today a pharmacy (tenant) is created only by `scripts/create-tenant.ts`, run by hand with the owner credential
(`DIRECT_URL`). There is no way to suspend a pharmacy, and no record of what each pharmacy owes for the service. To
operate FSJ for several pharmacies we need a platform operator (the **superadmin**) with a panel at `/plataforma`.

The starting point is the EvoralStock superadmin module. Its idea is kept: **the superadmin is not a role inside a
tenant, it is a separate identity outside the tenant model and RLS.** Its mechanics are not portable as they are,
because EvoralStock relies on Supabase Auth, a service-role key and JWT claims, and FSJ has none of them (own opaque
DB sessions, runtime role `fsj_app` without BYPASSRLS). `design.md` maps every piece.

## What

From `/plataforma` the superadmin can:

1. List the pharmacies with pagination and search, with estado and saldo (cargos minus pagos) of each.
2. See a pharmacy's detail: its datos, contacto, estado, cuenta corriente and the platform's history for it.
3. Dar de alta a pharmacy: tenant + SISTEMA + first Administrador with a temporary password + every default seed, in
   **one database transaction** (nothing to compensate if a step fails).
4. Suspend (with motivo) or reactivate a pharmacy. A suspended pharmacy cannot log in and its open sessions stop
   working on the next request. Its data is untouched.
5. Edit the pharmacy's contacto (the platform's own data about the client).
6. Register a cargo (período, monto, concepto) and a pago (fecha not in the future, monto, medio, nota).
7. Anular a cargo or a pago with motivo. Nothing is deleted: it is marked anulado, with who and when.

The superadmin logs in on the same `/login` as everybody else.

## Decisions *(Claude, pending the user's review)*

| # | Decision | Why |
|---|---|---|
| D1 | Superadmin = its own tables (`fsj.superadmin`, `fsj.superadmin_sesion`), never a `fsj.usuario`. | `usuario.tenant_id` is NOT NULL; without a tenant, no tenant RLS policy ever reaches it, and no policy "or is superadmin" is ever written. |
| D2 | Alta / reset / deactivation of a superadmin only by a CLI script with the owner credential (`scripts/superadmin.ts`). No UI. | Same as EvoralStock's "insert by hand": a UI alta would be an escalation path. The password must be argon2id-hashed, so it is a script, not raw SQL. |
| D3 | The runtime never touches platform tables directly: `fsj_app` has no grant on them. Every platform read and write is a `SECURITY DEFINER` function that receives the **hash of the session token** and derives the actor inside the DB. | FSJ's equivalent of "service-role only after the guard". Stronger than EvoralStock's `p_actor uuid`: knowing a superadmin's id is useless; a forgotten guard in TS still fails in the DB. |
| D4 | Platform audit in its own immutable table `fsj.plataforma_auditoria`, written by the same function, in the same transaction. | `fsj.registro_auditoria` requires a tenant and a `fsj.usuario`. |
| D5 | One `/login` for everybody; an email is unique across `usuario` and `superadmin`. Same generic error and the same work (one argon2 verification, one resolver round trip) for every outcome. | Keeps the panel invisible and keeps the login's anti-enumeration rule. |
| D6 | Separate cookie `fsj_plataforma` with `Path=/plataforma`; logging in as one kind clears the other's cookie. | The platform token never travels to tenant routes; a browser never holds both kinds at once. |
| D7 | `/plataforma` without a valid platform session redirects to `/login` (like any other path); with a tenant session but no platform session -> `notFound()`. | An anonymous visitor or a pharmacy user cannot tell the panel exists. |
| D8 | Platform session: 15 min idle, 8 h absolute, same lockout as the login (5 tries / 15 min). No PIN, no step-up re-auth, no 2FA in this change. | Short sessions keep it simple. **2FA (TOTP) is the recommended follow-up** (out of scope). |
| D9 | `fsj.tenant` gains `estado` (`ACTIVO` / `SUSPENDIDO`). `fecha_baja` (definitive baja) is unchanged and NOT offered in the panel. | Legal records (libro recetario, archivo) must be kept; a definitive baja stays a deliberate manual operation. |
| D10 | A suspended pharmacy: login and existing sessions rejected with the existing generic messages; the daily jobs (archivo plazos, retiros vencidos) keep running for it. | Login's uniform-error rule is deliberate (`modules/auth/application/login.ts`). Legal timelines do not stop while the client is suspended. |
| D11 | The superadmin never reads a tenant-scoped table (no usuarios, recetas, stock). The panel shows only `fsj.tenant` and the platform tables. Contact data lives in new `contacto_*` columns of `fsj.tenant`, set at alta and editable from the panel. | Plan §122: the operator "no accede a datos de negocio". |
| D12 | Seeds of a new tenant move from `scripts/create-tenant.ts` into one SQL function `fsj.crear_tenant_interno(...)` (not executable by `fsj_app`). The script and the panel's function both call it. | One list of seeds instead of two that drift apart. |
| D13 | The superadmin types the first Administrador's temporary password (>= 6 characters), exactly like an Administrador does in "Alta de usuario". It is never shown, logged or audited. | Same rule as `contrasena-temporal`. |
| D14 | Cuenta corriente in ARS only, `numeric(14,2)`, decimal.js in TS. Saldo = sum of non-anulados cargos minus sum of non-anulados pagos, computed in SQL on read (no stored balance). Positive = the pharmacy owes. | No balance to keep in sync. |
| D15 | Cargo: período = a month (stored as its first day), unique per (tenant, período, concepto) among non-anulados. Pago: `envio_id` per form instance like `alta-receta-idempotente`. Medios: TRANSFERENCIA, EFECTIVO, MERCADO_PAGO, OTRO. "Not in the future" is checked against today in `America/Argentina/Buenos_Aires`. | Double-submit cannot create a second cargo or pago. |
| D16 | **Paquetes opcionales are out of scope.** EvoralStock's (revendedoras, consignación) do not exist in FSJ, and FSJ has no per-tenant module switch today. | Building the mechanism without a first paquete is premature. Candidates when the user decides: libros contralor, envíos/repartidores, importación PDF/QR, costos de proveedor. |
| D17 | ~~RLS on `fsj.tenant`~~ already shipped by migration 0119 (security audit P1-02) before this change started. The jobs list tenants through `fsj.listar_tenants_activos()` (`fecha_baja IS NULL`, so SUSPENDIDO included, as D10 wants). | Nothing left to do here. |
| D18 | Unused permisos `tenants.crear/editar/baja` are removed (migration + `permisos.ts`). | The superadmin model does not use tenant permisos; leaving them suggests a role could get them. |

## Scope

- Migrations 0124-0126 (identity and sessions, tenant estado + alta, cuenta corriente), each with its
  `prisma/rollbacks/<migration>.down.sql`; `docs/rollbacks/plataforma-superadmin.md`.
- `modules/auth` (superadmin login, sessions, `requireSuperAdmin`), new `modules/plataforma` (panel use cases and UI),
  `app/(plataforma)/plataforma/**`, `app/(auth)/login/actions.ts`, `proxy.ts`, `shared/auth` facade,
  `scripts/superadmin.ts`, `scripts/create-tenant.ts`.
- New spec `openspec/specs/plataforma/spec.md`; `contrasena-temporal` "Bootstrap del Administrador inicial de tenant"
  modified.

## Out of scope

- Paquetes opcionales (D16), 2FA (D8), automatic suspension for debt, invoices / AFIP, interest, currencies other than ARS.
- Superadmin access to any pharmacy data, impersonation ("entrar como"), support sessions.
- Definitive baja of a pharmacy from the panel (D9).
- Superadmin self-service password change (the script resets it).
- Notifying the pharmacy (email/WhatsApp) of suspensions or charges.

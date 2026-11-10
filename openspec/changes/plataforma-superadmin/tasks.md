# Tasks — plataforma-superadmin

Proposal: `proposal.md`. Rules: `specs/plataforma/spec.md`. Technical approach: `design.md`.

## How this change is executed

- **Implementer:** Claude, one stage at a time (User decision 2026-11-09: no other agent takes part). Each stage
  closes with its review gate checked by the implementer and a `/code-review` of the stage's diff; the user approves
  the stage before the next one starts.
- Read only what each task names, plus `AGENTS.md` and this folder (`docs/plan-implementacion.md`: search only).
- One branch `feat/plataforma-superadmin`, **one commit per stage** (message `feat(plataforma): stage N -- ...`), so a
  review reads one diff.
- Migrations are never applied by the implementer. The user applies each one by hand (`docs/deploy.md`), in the same
  deploy as its code. Never run `prisma migrate reset`, `db push` or any destructive command.
- Each stage ends with `npm run typecheck`, `npm run lint`, `npm test` green, and a short hand-off note in the PR
  (or in this file under the stage): what was done, what was NOT verified, any deviation from `design.md` and why.
- A deviation from `design.md` is allowed only when the code proves the design wrong; it is written in the hand-off
  note, never silent.

## Stage 1 — Superadmin identity, sessions and login (migration 0124)

- [x] 1.1 `prisma/migrations/<ts>_0124_superadmin_identidad/migration.sql`: types, `fsj.superadmin`,
  `fsj.superadmin_sesion`, `fsj.plataforma_auditoria`, RLS + revokes, immutability and truncate triggers,
  `fsj.email_login_unico()` on both tables, `fsj.superadmin_resolve_login`, `fsj.plataforma_iniciar_sesion`,
  `fsj.plataforma_login_fallido`, `fsj.plataforma_actor` (no EXECUTE for `fsj_app`), `fsj.plataforma_validar_sesion`,
  `fsj.plataforma_cerrar_sesion` (`design.md` §2 0124).
- [x] 1.2 `prisma/schema.prisma` only if Prisma needs to know the tables (it should not: all access is `$queryRaw` over
  functions). Write the reason in the hand-off note either way.
- [x] 1.3 `prisma/rollbacks/0124_superadmin_identidad.down.sql`.
- [x] 1.4 `modules/auth`: `domain/session-plataforma.ts`, cookie name and options, `infrastructure/superadmin-repository.ts`,
  `application/login.ts` with the superadmin branch, `application/require-superadmin.ts`
  (`requireSuperAdmin`, `superAdminActual`, `logoutPlataforma`), `shared/auth/plataforma.ts` facade.
- [x] 1.5 `app/(auth)/login/actions.ts`: cookie by `tipo`, clear the other one, redirect.
- [x] 1.6 `scripts/superadmin.ts` (crear, restablecer-password, desactivar, reactivar).
- [x] 1.7 Unit tests: login branches (one argon2 call each, same message), `requireSuperAdmin` fails closed.

**Review gate 1:** no grant of any platform table to `fsj_app`; every function has `SET search_path =
fsj, extensions` and `REVOKE ... FROM PUBLIC`; `plataforma_actor` not executable by `fsj_app`; login timing paths still
uniform (P3); token stored only as hash; no password or hash in any log, audit or error; cookie `Path=/plataforma`.

**Hand-off stage 1 (2026-11-09):** done; gate checked. Deviations: the proxy change of 3.3 moved here (without it the
superadmin login bounces to `/login`); `fsj.superadmin_resolve_login` is called after `usuario_resolve_login` misses
instead of one combined resolver (the 1 s rejection floor of P2-01 hides the extra round trip). 1.2: no Prisma model,
all access is `$queryRaw` over functions. `INV-PLAT-AUTH` added to `shared/errors/mensajes-invariantes.ts`.
Open from the review: switching session kind clears the other cookie but leaves its DB session alive until expiry;
`logoutPlataforma` does not reset the per-request memo; no timing test for the superadmin rejection path; the
hidden prompt is duplicated from `create-tenant.ts`. NOT verified: 0124 not applied, no DB test, no browser check.

## Stage 2 — Tenant estado, alta function, suspension in auth (migration 0125)

- [x] 2.1 Migration 0125: `estado`, `contacto_*`, `fsj.crear_tenant_interno` (REVOKE from `fsj_app`),
  `fsj.plataforma_crear_tenant`, `fsj.plataforma_cambiar_estado_tenant`, `fsj.plataforma_editar_contacto_tenant`,
  `fsj.plataforma_listar_tenants`, `fsj.plataforma_ver_tenant`, `fsj.plataforma_auditoria_tenant`; removal of the
  `tenants.*` permisos (D18).
- [x] 2.2 Rollback `.down.sql`. `prisma/schema.prisma` gains `Tenant.estado` and `contacto*` + `npm run db:generate`.
- [x] 2.3 `modules/auth/domain/permisos.ts`: remove `tenants.crear/editar/baja`; fix `tests/unit/auth-authorize.test.ts`.
- [x] 2.4 `validateSession` rejects a non-ACTIVO tenant; `login()` refuses (generic message, no session) when the
  tenant is not ACTIVO, read only on the correct-password path (`design.md` §2 0125).
- [x] 2.5 `scripts/create-tenant.ts` calls `fsj.crear_tenant_interno` (same flags + optional `--contacto-*`).
- [x] 2.6 Tests: unit for 2.4; DB test that `crear_tenant_interno` creates the same rows as the old script did and
  rolls back fully on a duplicate admin email.

**Review gate 2:** the seed list in `crear_tenant_interno` matches the old script line by line (diff both); jobs still
process SUSPENDIDO tenants; a SUSPENDIDO tenant cannot log in or use an open session; the rejected login path did not
gain a read.

**Hand-off stage 2 (2026-11-09):** done; gate checked (parámetros diffed line by line against the old script: equal).
Also: `INV-PLAT-*` messages; `AGENTS.md` records that `fsj.plataforma_*` skip the `p_tenant_id` refusal; list search
escapes % / _ and compares CUIT by digits. `login()` now also refuses a dado-de-baja tenant before creating the session
(it used to create one that validateSession rejected). **For stage 3:** unique violations raised inside
`crear_tenant_interno` arrive through `$queryRaw` and mapDbError makes them INTERNAL_ERROR; `crearFarmacia` must
check CUIT / admin email first (field errors) and map the race. Open: the tenant-usable rule lives in two places
(login, validateSession); 0125 down reactivates suspended pharmacies. NOT verified: 0124/0125 not applied, the new DB
test `tests/db/plataforma-alta-tenant.test.ts` not run.

## Stage 3 — The panel: list, detail, alta, suspend, contacto

- [x] 3.1 `modules/plataforma/application/define-plataforma.ts` + ESLint ignore entry + registry decision (`design.md` §3).
- [x] 3.2 Use cases `listarFarmacias`, `verFarmacia`, `auditoriaFarmacia`, `crearFarmacia`, `suspenderFarmacia`,
  `reactivarFarmacia`, `editarContacto`, with their infrastructure wrappers and zod schemas (CUIT with the existing
  validator).
- [x] 3.3 `proxy.ts`: platform cookie on `/plataforma` paths.
- [x] 3.4 `app/(plataforma)/layout.tsx` (redirect / `notFound()`, P5) and shell with Cerrar sesión.
- [x] 3.5 Pages: list (search + pagination, saldo column shows 0 until stage 4), detail (datos, contacto, estado,
  history), alta form, suspend / reactivate dialogs with motivo, edit contacto.
- [x] 3.6 Forms keep input on error and mark the field (`use-form-submit.ts`, `field-errors.ts`); the password field is
  never re-filled.
- [x] 3.7 Unit tests: proxy cookie selection; use cases call `requireSuperAdmin` first (mock it to throw -> nothing else
  runs).

**Review gate 3:** every Server Action reaches a use case that calls `requireSuperAdmin` before anything; no page
reads a tenant-scoped table; a pharmacy user on `/plataforma` gets the plain not-found page; UI copy in Spanish, reuses
`shared/ui`.

**Hand-off stage 3 (2026-11-09):** done; gate checked. Deviations: `definePlataforma` (one helper for commands and
queries, no `audit` option: SQL audits); `parseInput` exported from `shared/usecase.ts` to reuse it; 0125 gained
`fsj.plataforma_alta_conflictos` (pre-check for field errors; 0125 not applied anywhere yet); 3.3 was done in stage 1 and
changed here so a pharmacy session also passes `/plataforma` (the layout answers `notFound()`, P5); the alta keeps the
typed password on error (it never leaves the browser again; spec P10 updated) instead of clearing it. No platform
registry for the use-case registry tests. NOT verified: no browser check (0124/0125 not applied, the pages call
their functions), no DB test run.

## Stage 4 — Cuenta corriente (migration 0126)

- [ ] 4.1 Migration 0126: `fsj.medio_pago_plataforma`, `fsj.plataforma_cargo`, `fsj.plataforma_pago`, unique index,
  anulación-only update trigger, delete / truncate triggers, functions (registrar, anular, cuenta corriente, saldo),
  `plataforma_listar_tenants` replaced to return the real saldo.
- [ ] 4.2 Rollback `.down.sql`.
- [ ] 4.3 `mapDbError`: friendly message for `plataforma_cargo_unico`; `INV-PLAT-FECHA-FUTURA` mapped to the fecha field.
- [ ] 4.4 Use cases `cuentaCorriente`, `registrarCargo`, `registrarPago` (`envio_id` per form instance), `anularCargo`,
  `anularPago`; money only through `shared/decimal` and `decimalString`.
- [ ] 4.5 UI in the detail: saldo, movements list (anulados struck through with who / when / motivo), cargo form, pago
  form, anular dialog with motivo.
- [ ] 4.6 Tests: zod (fecha futura in AR timezone at 23:30 local, monto with 3 decimals refused); DB: anular twice
  refused, DELETE refused, UPDATE of monto refused, saldo with anulados.

**Review gate 4:** no JS `number` arithmetic on money; saldo never stored; a repeated `envio_id` writes nothing and
audits nothing; anulación audited.

## Stage 5 — Docs, specs, archive

- [ ] 5.1 `docs/rollbacks/plataforma-superadmin.md` (order, data loss of 0126's down, login revert with 0124's down).
- [ ] 5.2 `modules/README.md`, `docs/architecture.md`, `shared/auth/README.md`, `AGENTS.md` (one line on seeds),
  DP-37 / 3.12 in `docs/plan-implementacion.md` marked resolved.
- [ ] 5.3 `npm run specs:validate`.
- [ ] 5.4 User's manual check (`design.md` §4 "Manual").
- [ ] 5.5 Archive: merge `specs/plataforma` into `openspec/specs/plataforma/spec.md` and the `contrasena-temporal`
  delta into its spec; move to `changes/archive/YYYY-MM-DD-plataforma-superadmin/`.

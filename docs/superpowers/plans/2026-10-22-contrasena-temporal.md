# Contraseña temporal, cambio obligatorio y PIN obligatorio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Administrador assigns a temporary password when creating or resetting a usuario; after a normal login the person must change it and (unless they are a cuenta de sector) set a PIN before anything else in the system works.

**Architecture:** A new `usuario.debe_cambiar_password` column plus a derived "pending steps" list (`cambiar-password`, then `configurar-pin` when `pin_hash IS NULL` and the usuario is neither a cuenta de sector nor the SISTEMA user) is loaded with the session. `requireSession()` throws a typed `PasosPendientesError` unless the caller opts out explicitly; `defineCommand`/`defineQuery` expose that opt-out as a definition flag used only by the flow's own use cases. The two step pages live in a new route group `app/(pasos)` outside `app/(app)`. The activation-by-code flow is removed; the `credencial_activacion` table stays but is no longer read or written.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 + Postgres (schema `fsj`), zod 4, `@node-rs/argon2`, vitest (`unit` and `db` projects).

**Spec:** `docs/specs/contrasena-temporal.md` (approved; items marked **[decisión técnica]** are approved too). Also read `AGENTS.md` and `node_modules/next/dist/docs/` before touching Next APIs.

## Global Constraints

- Work directly on `master`, no branch. Conventional commits only; **never** add `Co-Authored-By` or any AI attribution. Commit per task, **push only after Task 15** (intermediate states would deploy half a flow).
- Dev and tests share the ONE real Supabase project. Never run `prisma migrate reset` or any destructive DB command. **Applying migration 0097 (`npm run db:migrate`) touches that shared DB and revokes live activation credentials: ask the user before running it** (Task 1, step 6).
- Language: business identifiers and UI copy in Spanish (voseo, as the rest of the app); code comments, docs and test descriptions in English. Spec values verbatim: temporal password min 12 chars + 1 uppercase (`validatePassword`), PIN = `AUTH_POLICY.pinLength` (4) digits non-trivial (`validatePin`), argon2id via `hashPassword`.
- The temporary password never appears in plaintext in the DB, the audit (`valorAnterior`/`valorNuevo`/`motivo`/`contexto`), logs, use-case outputs or any form state returned to the client (CT1).
- Business logic in `modules/<m>/{domain,application,infrastructure,ui}`; `app/**` only through `application/` use cases; every use case via `defineCommand`/`defineQuery`; no tenant transaction opened by hand outside `modules/auth`.
- Every Server Action form uses `shared/ui/use-form-submit.ts`; reset only on success; mark offending fields (`shared/ui/field-errors.ts`). Reuse `NewPasswordFields` (`modules/auth/ui/new-password-fields.tsx`).
- Schema change = migration in `prisma/migrations/` + `prisma/rollbacks/0097_contrasena_temporal.down.sql` + `docs/rollbacks/contrasena-temporal.md`.
- Test commands: unit `npm test -- tests/unit/<file>.test.ts` (whole suite: `npm test`); DB `FSJ_DB_TESTS=yes npm run test:db -- tests/db/<file>.test.ts` (PowerShell: `$env:FSJ_DB_TESTS="yes"; npm run test:db -- ...`).
- `auth.activar` stays in the permission catalog. `modules/auth/domain/token.ts` stays. `ACTIVAR_CUENTA` stays in the `tipo_accion` enum and audit presentation tables (history).

## Review Focus

Failure modes the spec implies; each has a pinned test in the owning task.

1. A logged-in user with **no** pending step calls the "change temp password" use case (no current password asked): it must reject, otherwise anyone with a session could change a password without knowing it. (Task 4)
2. Restablecer on a `SUSPENDIDO` user: state stays `SUSPENDIDO`, no `cambiarEstadoUsuario` call (it would clear the PIN and add a history row); on `ACTIVO` the PIN is untouched. (Task 9)
3. A cuenta de sector with the flag set does step 1 but never gets step 2; the PIN step use case also rejects a sector session. (Tasks 2, 5)
4. A user mid-form when the gate starts firing (typical: no PIN at deploy time): the Server Action returns a form error naming the step, with a link where the shared form message is used, and typed input survives; a stale soft-navigation page error offers a hard reload. (Tasks 6, 3)
5. Double submit / race on step 2 when the PIN already exists: reject, never silently overwrite; double submit of step 1 after the flag cleared rejects (Review Focus 1). (Tasks 4, 5)

## File Structure

New:
- `prisma/migrations/20261022100000_0097_contrasena_temporal/migration.sql`, `prisma/rollbacks/0097_contrasena_temporal.down.sql`, `docs/rollbacks/contrasena-temporal.md`
- `shared/auth/pasos.ts` — `PasoPendiente`, `rutaDelPaso` (pure; importable by `shared/errors` and `shared/ui`)
- `modules/auth/domain/pasos-pendientes.ts` — `derivarPasosPendientes` (pure)
- `modules/auth/application/cambiar-password-temporal.ts`, `modules/auth/application/configurar-pin-obligatorio.ts`
- `app/(pasos)/layout.tsx`, `app/(pasos)/cambiar-password/{page.tsx,cambiar-password-form.tsx,actions.ts}`, `app/(pasos)/configurar-pin/{page.tsx,configurar-pin-form.tsx,actions.ts}`
- `shared/ui/brand-header.tsx` — logo/name block extracted from `app/(auth)/layout.tsx`, reused by `(pasos)`
- `app/(app)/cuenta/cuenta-forms.tsx` — the client forms moved out of `page.tsx`
- Tests: `tests/unit/auth-pasos-pendientes.test.ts`, `auth-require-session-gate.test.ts`, `auth-cambiar-password-temporal.test.ts`, `auth-configurar-pin-obligatorio.test.ts`, `auth-pasos-registry.test.ts`, `contrasena-temporal-operadores.test.ts`, `contrasena-temporal-restablecer.test.ts`, `tests/db/contrasena-temporal.test.ts`

Modified / removed: listed per task.

---

### Task 1: Migration 0097, Prisma schema, rollback

**Files:**
- Create: `prisma/migrations/20261022100000_0097_contrasena_temporal/migration.sql`, `prisma/rollbacks/0097_contrasena_temporal.down.sql`, `docs/rollbacks/contrasena-temporal.md`, `tests/db/contrasena-temporal.test.ts`
- Modify: `prisma/schema.prisma` (`model Usuario`, next to `pinHash`)
- Commit also: `docs/specs/contrasena-temporal.md` (currently untracked) and this plan.

**Interfaces:**
- Produces: Prisma field `Usuario.debeCambiarPassword: boolean` (`@map("debe_cambiar_password")`, `@default(false)`), used by Tasks 2–12.

- [ ] **Step 1: Write the failing DB test** `tests/db/contrasena-temporal.test.ts` (same `asOwner`/`inRollbackTx`/`withTenant` harness and `fixtures.ts` helpers as `tests/db/auth-pin.test.ts`):
  - `defaults debe_cambiar_password to false for a new usuario`.
  - `accepts an ACTIVO insert with password_hash and debe_cambiar_password = true` (spec: insert straight into ACTIVO is allowed; the state trigger only watches `UPDATE OF estado`).
  - `fsj_app can UPDATE debe_cambiar_password` (inside `withTenant`, after `SET LOCAL ROLE fsj_app` like the other grant tests).
  - `0097 revokes only live credencial_activacion rows`: read the migration file, extract the `UPDATE fsj.credencial_activacion ...;` statement with a regex, seed four credenciales for one usuario (live, live-but-expired, used, already revoked; `vence_en > emitida_en` CHECK and the one-active partial unique index `uq_credencial_activacion_activa` mean seed them for four different usuarios), run the statement, assert the two live ones have `revocada_en IS NOT NULL` and the used one keeps `usada_en` with `revocada_en IS NULL`, the revoked one keeps its original `revocada_en`.
- [ ] **Step 2: Run to verify it fails** — `FSJ_DB_TESTS=yes npm run test:db -- tests/db/contrasena-temporal.test.ts`. Expected: FAIL (column does not exist / migration file missing).
- [ ] **Step 3: Write `migration.sql`**, header comment in the style of 0096 (number, spec, "APPLY 0097 BEFORE DEPLOYING THE CODE; the previous code ignores the column", rollback pointer, runs as migration owner so it bypasses RLS like 0078):
  1. `ALTER TABLE fsj.usuario ADD COLUMN IF NOT EXISTS debe_cambiar_password boolean NOT NULL DEFAULT false;` + `COMMENT ON COLUMN`.
  2. `GRANT UPDATE (debe_cambiar_password) ON fsj.usuario TO fsj_app;`
  3. `UPDATE fsj.credencial_activacion SET revocada_en = now() WHERE usada_en IS NULL AND revocada_en IS NULL;` (a single statement the test can extract; explain in a comment that the table is kept as history and nothing reads or writes it any more).
- [ ] **Step 4: Schema + rollback.** Add to `model Usuario`: `/// Migration 0097 (docs/specs/contrasena-temporal.md): ...` `debeCambiarPassword Boolean @default(false) @map("debe_cambiar_password")`. `0097_contrasena_temporal.down.sql`: `REVOKE UPDATE (debe_cambiar_password) ON fsj.usuario FROM fsj_app; ALTER TABLE fsj.usuario DROP COLUMN IF EXISTS debe_cambiar_password;` with a header stating DATA LOSS (which users still had a pending change) and that the credentials revoked by 0097 cannot be un-revoked (INV-AU-002; reissue with the old code's "Restablecer credencial"). `docs/rollbacks/contrasena-temporal.md`: copy the structure of `docs/rollbacks/tipo-vencimiento-preparado.md` (what is lost, order: revert code first, then apply the down SQL as a NEW forward migration, new files, edited files list filled in at Task 15).
- [ ] **Step 5:** `npm run db:generate`.
- [ ] **Step 6: GATE — ask the user to confirm**, then `npm run db:migrate` (shared real DB). Then rerun the Step 2 command. Expected: PASS.
- [ ] **Step 7: Commit**
```bash
git add prisma docs/specs/contrasena-temporal.md docs/superpowers/plans/2026-10-22-contrasena-temporal.md docs/rollbacks/contrasena-temporal.md tests/db/contrasena-temporal.test.ts
git commit -m "feat(auth): migration 0097 adds debe_cambiar_password and revokes live activation credentials"
```

---

### Task 2: Pending steps on the session (domain, error type, session load)

**Files:**
- Create: `shared/auth/pasos.ts`, `modules/auth/domain/pasos-pendientes.ts`, `tests/unit/auth-pasos-pendientes.test.ts`
- Modify: `shared/errors/index.ts` (new class + code), `modules/auth/domain/session.ts`, `modules/auth/infrastructure/session-repository.ts` (`USUARIO_CON_PERMISOS_SELECT`, `UsuarioConPermisos`, `toUsuarioConPermisos`), `modules/auth/application/validate-session.ts`, the 13 `app/api/**/route.ts` files that declare `STATUS_BY_CODE: Record<AppErrorCode, number>` (find with `git grep -l "Record<AppErrorCode"`)

**Interfaces:**
- Produces:
  - `shared/auth/pasos.ts`: `type PasoPendiente = "cambiar-password" | "configurar-pin"`; `rutaDelPaso(paso: PasoPendiente): "/cambiar-password" | "/configurar-pin"`.
  - `shared/errors`: `class PasosPendientesError extends AppError { readonly paso: PasoPendiente; constructor(paso: PasoPendiente) }`, code `"PASOS_PENDIENTES"` added to `AppErrorCode` and to `MENSAJES_SEGUROS`. Messages (Spanish, via `userMessageFor` default branch): `cambiar-password` → "Antes de seguir tenés que cambiar tu contraseña temporal."; `configurar-pin` → "Antes de seguir tenés que configurar tu PIN.".
  - `derivarPasosPendientes(f: { debeCambiarPassword: boolean; tienePin: boolean; esSector: boolean; esTecnico: boolean }): readonly PasoPendiente[]` — returns `[]`, `["cambiar-password"]` or `["configurar-pin"]` (never both: the PIN is asked only after step 1; first element = current step).
  - `AuthenticatedSession.pasosPendientes?: readonly PasoPendiente[]` (optional so the ~70 test fixtures keep compiling; absent = none; only `validateSession` builds real sessions).
  - `UsuarioConPermisos.debeCambiarPassword: boolean`, `UsuarioConPermisos.tienePin: boolean` (never expose the hash).

- [ ] **Step 1: Write failing tests** in `tests/unit/auth-pasos-pendientes.test.ts`:
  - `derivarPasosPendientes`: `{debe:true, tienePin:false}` → `["cambiar-password"]`; `{debe:true, tienePin:true}` → `["cambiar-password"]` (restablecer keeps the PIN); `{debe:false, tienePin:false, esSector:false, esTecnico:false}` → `["configurar-pin"]`; `{debe:false, tienePin:true}` → `[]`; **CT6** `{debe:false, tienePin:false, esSector:true}` → `[]` and `{debe:true, esSector:true}` → `["cambiar-password"]`; `esTecnico:true` with no PIN → `[]`.
  - `rutaDelPaso` maps both values; `new PasosPendientesError("configurar-pin")` has `.code === "PASOS_PENDIENTES"`, `.paso`, and `userMessageFor(err, "x")` returns the Spanish message.
  - `validateSession` (mock `session-repository` and `@/shared/db/transaction` like `tests/unit/auth-login.test.ts`): with a usuario `{estado:"ACTIVO", debeCambiarPassword:false, tienePin:false, esSector:true, esTecnico:false}` the returned session has `pasosPendientes: []` (CT6); with `esSector:false` it has `["configurar-pin"]`.
- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/unit/auth-pasos-pendientes.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the files above. Select `debeCambiarPassword: true, pinHash: true` in `USUARIO_CON_PERMISOS_SELECT` and map `tienePin: usuario.pinHash !== null` in `toUsuarioConPermisos`. In `validateSession` add `pasosPendientes: derivarPasosPendientes({...})` to the returned object. Add `PASOS_PENDIENTES: 403` to every `STATUS_BY_CODE` (typecheck lists any file missed).
- [ ] **Step 4: Run** `npm test -- tests/unit/auth-pasos-pendientes.test.ts` (PASS), then `npm run typecheck` (the 13 route maps and any exhaustive `Record<AppErrorCode, …>` must compile).
- [ ] **Step 5: Commit** — `feat(auth): derive pending steps on the session and add PasosPendientesError`.

---

### Task 3: The gate in `requireSession` and the use-case opt-out flag

**Files:**
- Modify: `modules/auth/application/require-session.ts`, `shared/auth/session.ts`, `shared/usecase.ts`, `app/(app)/error.tsx`
- Test: `tests/unit/auth-require-session-gate.test.ts` (new), `tests/unit/usecase.test.ts` (extend)

**Interfaces:**
- Consumes: `PasosPendientesError`, `AuthenticatedSession.pasosPendientes` (Task 2).
- Produces:
  - `requireSession(options?: { permitirPasosPendientes?: boolean }): Promise<AuthenticatedSession>` — still memoized per request: move the cookie+validate work into an inner `cache()`d no-arg loader; the exported function is a thin non-cached wrapper that calls it and then applies the gate (`React.cache` keys on argument identity, so an options object must not reach the cached function). Throws `new PasosPendientesError(pasosPendientes[0])` when the list is non-empty and the option is not set. `shared/auth/session.ts` re-exports the new options type.
  - `DefineCommandConfig.permitirPasosPendientes?: true` and `DefineQueryConfig.permitirPasosPendientes?: true`: when set, `resolveSession` calls `requireSession({ permitirPasosPendientes: true })`, otherwise `requireSession()` with no argument. Injected sessions (`NODE_ENV=test` only) are never gated, as today. The internal registry entry gains `permitirPasosPendientes: boolean` (tests-only list `listRegisteredUseCasesForTests`; the public `RegisteredUseCase` shape is unchanged so `listRegisteredUseCases` assertions keep passing).

- [ ] **Step 1: Write failing tests.**
  - `auth-require-session-gate.test.ts` (mock `../infrastructure/cookie-store` `readSessionCookie` and `./validate-session`, plus `react`'s `cache` as identity if needed): **CT2** `debeCambiarPassword` session (`pasosPendientes: ["cambiar-password"]`) → `requireSession()` rejects with `PasosPendientesError` whose `paso` is `"cambiar-password"`; **CT3** `["configurar-pin"]` → rejects with paso `"configurar-pin"`; `requireSession({ permitirPasosPendientes: true })` resolves for both; `pasosPendientes: []` and `undefined` resolve without the option; no cookie → still `AuthenticationError` (not the new error).
  - `usecase.test.ts`: change the `@/shared/auth/session` mock to forward arguments (`requireSession: (...args) => requireSessionMock(...args)`); add `defineCommand`/`defineQuery` cases asserting `requireSessionMock` is called with `{ permitirPasosPendientes: true }` when the config sets the flag and with **no argument** when it does not.
- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/unit/auth-require-session-gate.test.ts tests/unit/usecase.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above. In `app/(app)/error.tsx` replace the `Link` to `/` with a button that does `window.location.assign("/")` (a hard load re-runs `app/(app)/layout.tsx`, which redirects to the pending step; a soft navigation would hit the same server-component error again — Review Focus 4). Keep the copy.
- [ ] **Step 4: Run** the two test files (PASS), then `npm test` (whole unit suite; nothing else may regress) and `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(auth): block every use case behind pending steps unless the flow opts out`.

---

### Task 4: Step 1 use case — change the temporary password

**Files:**
- Create: `modules/auth/application/cambiar-password-temporal.ts`, `tests/unit/auth-cambiar-password-temporal.test.ts`
- Modify: `modules/auth/infrastructure/usuario-repository.ts` (`UsuarioEmailRow` gains `debeCambiarPassword: boolean`, `esSector: boolean`, selected in `loadUsuarioParaPassword`; new `completarCambioPasswordTemporal`)

**Interfaces:**
- Produces:
  - `cambiarPasswordTemporalCommand = defineCommand({ name: "auth.password.cambiarTemporal", permiso: "auth.password.cambiar", permitirPasosPendientes: true, audit: { entidad: "usuario", accion: "MODIFICAR" }, input: { nueva: string, nuevaRepeat: string } })` — zod input identical in shape to `cambiarPassword` minus `actual` (same field names `nueva`/`nuevaRepeat`, so labels already exist; same `validatePassword` + match `superRefine`).
  - `cambiarPasswordTemporal(nueva: string, nuevaRepeat: string): Promise<{ sesionesRevocadas: number }>`.
  - Repo: `completarCambioPasswordTemporal(tx, usuarioId: string, passwordHash: string): Promise<void>` — one UPDATE setting `passwordHash` and `debeCambiarPassword: false` (the only code path that clears the flag — CT4).
- Behavior of the handler, in order: `loadUsuarioParaPassword`; row missing → `DomainError("No se pudo actualizar la contraseña.")`; `!debeCambiarPassword` → `DomainError("No tenés un cambio de contraseña pendiente. Si querés cambiarla, hacelo desde «Mi cuenta».")` (the authoritative check reads the DB row inside the tx, not the session snapshot); `verifyPassword(usuario.passwordHash, input.nueva)` true → `DomainError("La nueva contraseña tiene que ser distinta de la temporal.", { fields: ["nueva"] })`; else hash, `completarCambioPasswordTemporal`, `revokeOtherSesionesForUsuario(... session.sesionId ...)`; output `{ sesionesRevocadas }`; audit `{ entidadId: session.usuario.id, motivo: "Cambio de contraseña temporal por el propio usuario." }` (no hash, no password).

- [ ] **Step 1: Write failing tests** (mock `usuario-repository`, `session-repository`, `domain/password`, `@/shared/db/transaction`, `@/shared/audit` like `tests/unit/auth-reauth-pin.test.ts`; run via `execute(input, { session })`, session with `permisos: ["auth.password.cambiar"]`):
  - `changes the password, clears the flag, revokes other sessions and audits MODIFICAR with the exact motivo` — assert `completarCambioPasswordTemporal` called once with a hash that is not the plaintext, `revokeOtherSesionesForUsuario` called with `session.sesionId`, audit row has no key containing the password or hash (`JSON.stringify(auditArgs)` does not contain the new password), output `{ sesionesRevocadas }`.
  - **Review Focus 1**: `rejects when the usuario has no pending change` (`debeCambiarPassword:false`) — rejects with `DomainError`, `completarCambioPasswordTemporal` not called, no revoke.
  - `rejects a new password equal to the temporary one` (mock `verifyPassword` → true) with `fields` `["nueva"]`.
  - `rejects mismatched repeats and policy violations` (field `nuevaRepeat` / `nueva`).
  - **CT4** (source guard): `git grep`-style test reading `modules/**` source files and asserting that the string `debeCambiarPassword: false` appears only in `modules/auth/infrastructure/usuario-repository.ts` (inside `completarCambioPasswordTemporal`).
- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/unit/auth-cambiar-password-temporal.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** repo function and command. Reuse `hashPassword`/`verifyPassword` from `../domain/password`.
- [ ] **Step 4: Run** the test file (PASS) and `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(auth): use case to replace the temporary password without asking the current one`.

---

### Task 5: Step 2 use case — mandatory PIN; flag `auth.logout`; registry allowlist

**Files:**
- Create: `modules/auth/application/configurar-pin-obligatorio.ts`, `tests/unit/auth-configurar-pin-obligatorio.test.ts`, `tests/unit/auth-pasos-registry.test.ts`
- Modify: `modules/auth/application/logout.ts` (add `permitirPasosPendientes: true`)

**Interfaces:**
- Consumes: `loadUsuarioParaPassword` (now with `debeCambiarPassword`, `esSector`), `setPinHash`, `validatePin`, `hashPassword`.
- Produces: `configurarPinObligatorioCommand = defineCommand({ name: "auth.pin.configurarObligatorio", permiso: "auth.password.cambiar", permitirPasosPendientes: true, audit: { entidad: "usuario", accion: "MODIFICAR" }, input: { pin, pinRepeat } })` (same zod/`validatePin` rules as `configurarPin`, no `passwordActual`); `configurarPinObligatorio(pin: string, pinRepeat: string): Promise<void>`.
- Handler rejections (all `DomainError`, before any write): usuario missing; `session.sector` or `usuario.esSector` → "Las cuentas de sector no usan PIN."; `usuario.debeCambiarPassword` → "Primero tenés que cambiar tu contraseña temporal."; `usuario.pinHash !== null` → "Ya tenés un PIN configurado. Podés cambiarlo desde «Mi cuenta»." (Review Focus 5). Success: `setPinHash`, audit motivo exactly `"Configuración de PIN de reautenticación rápida por el propio usuario."` (same as `configurarPin` for a first PIN; no PIN/hash).

- [ ] **Step 1: Write failing tests.**
  - `auth-configurar-pin-obligatorio.test.ts`: success path (hash stored is not the PIN, audit motivo exact, no PIN in audit JSON); `rejects when the PIN already exists`; `rejects while the password change is pending`; `rejects a cuenta de sector` (**CT6**); `rejects trivial or mismatched PINs` (fields `pin` / `pinRepeat`).
  - `auth-pasos-registry.test.ts` (same glob-import approach and mocks as `tests/unit/usecase-registry-all-modules.test.ts`): the names of registered use cases with `permitirPasosPendientes === true` equal exactly `["auth.logout", "auth.password.cambiarTemporal", "auth.pin.configurarObligatorio"]` (sorted). This is the allowlist that keeps CT2/CT3 true for every other present or future use case.
- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/unit/auth-configurar-pin-obligatorio.test.ts tests/unit/auth-pasos-registry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both (PASS) and `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(auth): mandatory PIN use case and allowlist of use cases allowed with pending steps`.

---

### Task 6: Step pages, layout redirect, form error link

**Files:**
- Create: `shared/ui/brand-header.tsx`, `app/(pasos)/layout.tsx`, `app/(pasos)/cambiar-password/{page.tsx,cambiar-password-form.tsx,actions.ts}`, `app/(pasos)/configurar-pin/{page.tsx,configurar-pin-form.tsx,actions.ts}`
- Modify: `app/(auth)/layout.tsx` (use `BrandHeader`), `app/(app)/layout.tsx`, `shared/ui/action-error.ts`, `shared/ui/form-parts.tsx`, `tests/unit/action-error.test.ts`

**Interfaces:**
- Consumes: `requireSession({ permitirPasosPendientes: true })`, `PasosPendientesError`, `rutaDelPaso`, `cambiarPasswordTemporal`, `configurarPinObligatorio`, `logout`, `clearSessionCookie`.
- Produces: routes `/cambiar-password` and `/configurar-pin`; `ActionErrorState.href?: string` and `FormActionState` error variant `href?: string`.

- [ ] **Step 1: Write the failing test** in `tests/unit/action-error.test.ts`: `actionError(new PasosPendientesError("configurar-pin"), "x")` returns `{ status: "error", message: "Antes de seguir tenés que configurar tu PIN.", href: "/configurar-pin" }`; an ordinary `DomainError` result has no `href` key (serialized state unchanged for every other form).
- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/unit/action-error.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the shared bits.** `actionError` adds `href: rutaDelPaso(error.paso)` for `PasosPendientesError`. `FormFeedback` in `form-parts.tsx` renders `<Link href={current.href}>` after the message when `href` is present (forms with their own custom alert still show the text — acceptable, documented in a comment). Extract the logo/name block of `app/(auth)/layout.tsx` into `BrandHeader` and use it from both layouts.
- [ ] **Step 4: Implement `app/(app)/layout.tsx` change:** in the existing `catch`, `if (error instanceof PasosPendientesError) redirect(rutaDelPaso(error.paso));` before rethrowing.
- [ ] **Step 5: Implement `app/(pasos)/layout.tsx`:** `export const dynamic = "force-dynamic"`; calls `requireSession({ permitirPasosPendientes: true })` (`AuthenticationError` → `redirect("/login")`); renders `BrandHeader`, the usuario's name and a "Cerrar sesión" `<form>` whose inline server action is `await logout(); await clearSessionCookie(); redirect("/login")` (same as `app/(app)/layout.tsx`); no sidebar. Each `page.tsx` is a server component: read the session with the opt-out; `const [paso] = session.pasosPendientes ?? []`; no pending step → `redirect("/")`; pending but different step → `redirect(rutaDelPaso(paso))`; else render the client form. Forms (`"use client"`, `useActionState` + `useFormSubmit`, `NewPasswordFields name="nueva" repeatName="nuevaRepeat"` / PIN pair copied from `/cuenta`'s inputs without the password field, error alert + `useFieldErrors`). Actions: `try { await cambiarPasswordTemporal(...) } catch (e) { return actionError(e, "No se pudo cambiar la contraseña.") }` then `redirect("/")` **outside** the try (the layout of `(app)` then sends the user to step 2 if needed); same for the PIN with `"/"`.
- [ ] **Step 6: Run** `npm test -- tests/unit/action-error.test.ts` (PASS), `npm run typecheck`, `npm run lint` (the boundary rules must accept `app/(pasos)` importing `modules/auth/application/*` and `modules/auth/ui/new-password-fields`).
- [ ] **Step 7: Commit** — `feat(auth): step pages for the temporary password and the mandatory PIN`.

---

### Task 7: Login redirects to the first pending step

**Files:**
- Modify: `modules/auth/application/login.ts`, `modules/auth/infrastructure/usuario-repository.ts` (new `loadPasosPendientes`), `app/(auth)/login/actions.ts`, `tests/unit/auth-login.test.ts`

**Interfaces:**
- Consumes: `derivarPasosPendientes`, `rutaDelPaso`.
- Produces: `loadPasosPendientes(tx, usuarioId: string): Promise<readonly PasoPendiente[]>` (selects `debeCambiarPassword`, `pinHash`, `esSector`, `esTecnico`, calls `derivarPasosPendientes`); `LoginResult` ok variant becomes `{ ok: true; rawToken: string; expiraEn: Date; pasoPendiente: PasoPendiente | null }`.

- [ ] **Step 1: Write failing tests** in `auth-login.test.ts` (add `loadPasosPendientes` to the mocked `usuario-repository`): successful login returns `pasoPendiente: "cambiar-password"` when the mock returns `["cambiar-password"]`, `"configurar-pin"` for `["configurar-pin"]`, `null` for `[]`; the existing uniformity tests are unchanged (a rejected login still returns only the generic message, no `pasoPendiente`).
- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/unit/auth-login.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Call `loadPasosPendientes` inside the existing login transaction, after `insertSesionInTx`. In `loginAction`: `redirect(result.pasoPendiente ? rutaDelPaso(result.pasoPendiente) : "/")`. Update the doc comment that mentions `ACTIVAR_CUENTA`.
- [ ] **Step 4: Run** the test file (PASS), `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(auth): send the user to the first pending step after login`.

---

### Task 8: `crearUsuario` with a temporary password

**Files:**
- Modify: `modules/usuarios/application/crear-usuario.ts`, `modules/usuarios/infrastructure/usuario-repository.ts` (`NuevoUsuarioInput`, `insertUsuario`), `app/(app)/admin/accesos/usuarios/nuevo/{actions.ts,nuevo-usuario-form.tsx,page.tsx}`, `app/(app)/admin/accesos/usuarios/[id]/page.tsx` (toast), `shared/ui/toast.tsx` (`ToastOnMount`), `shared/labels/field-labels.ts`
- Tests to update: `tests/unit/usuarios-crear-usuario-audit.test.ts`, `tests/unit/cuentas-de-sector-alta.test.ts`, `tests/unit/roles-personalizables-usecases.test.ts`, `tests/unit/usuarios-usecase-registry.test.ts`, `tests/unit/usuarios-authorization-matrix.test.ts`

**Interfaces:**
- Consumes: `hashPassword` (`@/modules/auth/domain/password`), `validatePassword`.
- Produces:
  - `crearUsuarioInput` gains `passwordTemporal: string` and `passwordTemporalRepeat: string`; `superRefine` (applied to persons and sectors alike, restructured so the sector early-return does not skip it): mismatch → issue on `passwordTemporalRepeat` "Las contraseñas no coinciden."; each `validatePassword` error → issue on `passwordTemporal`.
  - `CrearUsuarioResult = { usuarioId: string }` (no `credencial`, no `credencialVenceEn`).
  - `NuevoUsuarioInput` gains `passwordHash: string`; `insertUsuario` writes `passwordHash`, `estado: "ACTIVO"`, `debeCambiarPassword: true`. Remove `insertCredencialActivacion` use (the repo function itself is deleted in Task 13).
  - field labels: `passwordTemporal: "Contraseña temporal"`, `passwordTemporalRepeat: "Repetir contraseña temporal"`.

- [ ] **Step 1: Write/adjust failing tests.** In `usuarios-crear-usuario-audit.test.ts` (and add the new inputs to every `crearUsuarioCommand.execute` call in the other files; drop their `insertCredencialActivacion` mocks):
  - **CT1** `stores only an argon2id hash`: `insertUsuario` receives `passwordHash` matching `/^\$argon2id\$/`, not equal to the typed password, `estado` ACTIVO semantic via the repo mock arguments (`debeCambiarPassword` is set inside the repo; assert the repo is called with `passwordHash`), and `JSON.stringify` of all `auditRecord` calls and of the command output contains neither the plaintext nor the hash.
  - `output equals { usuarioId }` (no credential keys).
  - Audit shape unchanged: one `CREAR` + one `ASIGNAR_ROL` per role.
  - `rejects mismatched passwords with fields ["passwordTemporalRepeat"]` and `rejects a policy-violating password with fields ["passwordTemporal"]`, for a person and for `esSector: true`.
- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/unit/usuarios-crear-usuario-audit.test.ts tests/unit/cuentas-de-sector-alta.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the module doc comment (no activation credential any more; INV-U07 note per spec). UI: the form adds `<NewPasswordFields name="passwordTemporal" repeatName="passwordTemporalRepeat" label="Contraseña temporal" repeatLabel="Repetir contraseña temporal" .../>`; remount it with a `key` after success is unnecessary (the action redirects). `crearUsuarioAction` forwards both fields and, **after** the try/catch, `redirect(\`/admin/accesos/usuarios/${result.usuarioId}?creado=1\`)`; remove the "Usuario creado" credential view, `CredencialActivacion` import, `credencial*` state fields; new description: "Queda activo con la contraseña temporal que elijas; tendrá que cambiarla y configurar su PIN al ingresar. Entregásela en mano: no hay envío automático." The detail page renders `<Toaster />` and, when `searchParams.creado === "1"`, `<ToastOnMount message="Usuario creado. Entregale la contraseña temporal en mano." />` (new tiny client component in `shared/ui/toast.tsx` that calls `toast()` once in an effect).
- [ ] **Step 4: Run** `npm test -- tests/unit/usuarios-crear-usuario-audit.test.ts tests/unit/cuentas-de-sector-alta.test.ts tests/unit/roles-personalizables-usecases.test.ts tests/unit/usuarios-usecase-registry.test.ts tests/unit/usuarios-authorization-matrix.test.ts tests/unit/usecase-registry-all-modules.test.ts` (PASS — the last one proves the new field names have labels), `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(usuarios): create usuarios with a temporary password`.

---

### Task 9: `restablecerCredencial` with a temporary password; drop credential revocation on suspend/baja

**Files:**
- Modify: `modules/usuarios/application/restablecer-credencial.ts`, `modules/usuarios/application/suspender-usuario.ts`, `modules/usuarios/application/dar-de-baja-usuario.ts`, `modules/usuarios/infrastructure/usuario-repository.ts`, `modules/usuarios/ui/restablecer-credencial.tsx`, `modules/usuarios/ui/actions.ts`, `app/(app)/admin/accesos/usuarios/[id]/page.tsx` (copy of the "Credencial" panel)
- Tests: `tests/unit/contrasena-temporal-restablecer.test.ts` (new), `tests/unit/usuarios-m3-lock-order.test.ts` (update), `tests/unit/usuarios-authorization-matrix.test.ts` (input of the restablecer row), `tests/db/usuarios-admin.test.ts` (lifecycle test, see Step 6)

**Interfaces:**
- Produces:
  - `restablecerCredencialInput = { usuarioId: uuid, passwordTemporal, passwordTemporalRepeat }` with the same refinement/labels as Task 8 (extract the shared `passwordTemporalFields` zod helper into `modules/usuarios/application/password-temporal.ts` and use it from both commands).
  - `restablecerCredencial(input: RestablecerCredencialInput): Promise<void>`; the command output is `{ estado: EstadoUsuario }`.
  - Repo: `restablecerPasswordTemporal(tx, usuarioId: string, passwordHash: string): Promise<void>` — one UPDATE: `passwordHash`, `debeCambiarPassword: true`, `intentosFallidos: 0`, `bloqueadoHasta: null`; **never touches pin columns** (CT5).
- Handler order (keep the self-check and `lockUsuarioYAdministradoresActivos` first): self → `DomainError`; lock; `loadUsuarioParaAccion`; `BAJA` → same `DomainError` as today; hash; `restablecerPasswordTemporal`; if `actual.estado === "PENDIENTE_ACTIVACION"` call `cambiarEstadoUsuario(... estadoNuevo: "ACTIVO", motivo: "Contraseña temporal asignada: el usuario pasa a Activo." ...)` (it does not clear the PIN when the new state is ACTIVO); for `ACTIVO` and `SUSPENDIDO` do **not** call it; `revokeAllSesionesForUsuarioInTx`. Audit `RESTABLECER_CREDENCIAL`: `valorAnterior: { estado: actual.estado }`, `valorNuevo: { estado: <resulting> }`, no password.
- `suspender-usuario.ts` / `dar-de-baja-usuario.ts`: remove the `revokeCredencialesActivas` call and the `credencialesRevocadas` output field and return type (nothing issues credentials any more; `git grep credencialesRevocadas` showed no other consumer).

- [ ] **Step 1: Write failing tests** in `contrasena-temporal-restablecer.test.ts` (mocks as in `usuarios-m3-lock-order.test.ts`): 
  - **CT5** `ACTIVO: sets hash + flag, resets lock counters, revokes all sessions, never calls cambiarEstadoUsuario, and passes no pin fields` (assert `restablecerPasswordTemporal` args and that no repo/mocked function receives `pinHash`/`clearPin`).
  - `PENDIENTE_ACTIVACION becomes ACTIVO` (`cambiarEstadoUsuario` once with `estadoNuevo: "ACTIVO"`).
  - Review Focus 2 `SUSPENDIDO stays SUSPENDIDO` (`cambiarEstadoUsuario` not called; audit `valorNuevo.estado === "SUSPENDIDO"`).
  - `BAJA is rejected` and `acting on yourself is rejected`, both before any hash/write.
  - **CT1** audit and output contain neither password nor hash; stored hash matches `/^\$argon2id\$/`.
  - `rejects mismatched / weak temporary passwords` with the Task 8 field names.
- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/unit/contrasena-temporal-restablecer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** handler, repo fn, suspend/baja cleanup. Update `usuarios-m3-lock-order.test.ts` (new input, `restablecerPasswordTemporal` mock replaces the credential mocks, assertion about `estadoAnterior` read from the locked snapshot kept) and the authorization-matrix input.
- [ ] **Step 4: UI.** `RestablecerCredencial` becomes a form: `NewPasswordFields name="passwordTemporal" repeatName="passwordTemporalRepeat"` + hidden `usuarioId` + submit "Asignar contraseña temporal", via `useFormSubmit`, no reauth prompt (not needed since 2026-10-21); the state union simplifies to `idle | error(message, fields) | success(message)`; on success show "Contraseña temporal asignada. Se cerraron sus sesiones y tendrá que cambiarla al ingresar." and `router.refresh()` (the estado badge updates), remount the fields via `key`. Detail page panel text: "Asigná una contraseña temporal nueva. Cierra las sesiones abiertas y la persona tendrá que cambiarla al ingresar; su PIN se conserva." Delete `fromError`'s dependence on restablecer's old state type (`RestablecerCredencialState` replaced).
- [ ] **Step 5: Run** `npm test -- tests/unit/contrasena-temporal-restablecer.test.ts tests/unit/usuarios-m3-lock-order.test.ts tests/unit/usuarios-authorization-matrix.test.ts` (PASS), `npm test` and `npm run typecheck`.
- [ ] **Step 6: Update `tests/db/usuarios-admin.test.ts`** lifecycle test (around line 89): the "crearUsuario-shaped" insert becomes `ACTIVO` + `password_hash` + `debe_cambiar_password = true` (no credential row), the "restablecer-shaped" step sets the flag, resets `intentos_fallidos`, leaves `pin_hash` untouched (seed a PIN, assert it survives), and no `credencial_activacion` assertions remain; fix the helper comment mentioning `activarCuenta`. Run `FSJ_DB_TESTS=yes npm run test:db -- tests/db/usuarios-admin.test.ts` (PASS).
- [ ] **Step 7: Commit** — `feat(usuarios): reset credentials by assigning a temporary password`.

---

### Task 10: Operators — users with a pending password change cannot identify themselves

**Files:**
- Modify: `modules/auth/domain/operador-policy.ts`, `modules/auth/application/verificar-operador.ts`, `modules/operadores/infrastructure/operadores-repository.ts`, `tests/unit/cuentas-de-sector-verificar-operador.test.ts` (the `decideCandidatoOperador` calls gain the new field)
- Test: `tests/unit/contrasena-temporal-operadores.test.ts` (new)

**Interfaces:**
- Produces: `CandidatoOperadorInput.debeCambiarPassword: boolean` (required); `CandidatoOperadorDecision` gains `"DEBE_CAMBIAR_PASSWORD"`, decided after `INACTIVO` and before `OK`; `verificarOperadorEnTx` passes `encontrado ? candidato.debeCambiarPassword : false`; `listOperadores` where-clause adds `debeCambiarPassword: false`.

- [ ] **Step 1: Write failing tests.**
  - `decideCandidatoOperador`: `{…ok, debeCambiarPassword:true}` → `"DEBE_CAMBIAR_PASSWORD"`; precedence: not found / sector / inactive still win.
  - **CT7** `verificarOperadorEnTx rejects a usuario with debeCambiarPassword even with the correct PIN` (extend the mocks of `cuentas-de-sector-verificar-operador.test.ts` in the new file): result `{ ok: false, message: MENSAJE_OPERADOR_RECHAZADO }`, `recordPinFailure` **not** called (no failed attempt counted), `verifyPassword` still called once (constant work), one `AUTORIZAR` audit whose `motivo` contains `DEBE_CAMBIAR_PASSWORD`.
  - `listOperadores` (fake `tx.usuario.findMany`): the `where` equals `{ tenantId, estado: "ACTIVO", esSector: false, esTecnico: false, pinHash: { not: null }, debeCambiarPassword: false }`.
- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/unit/contrasena-temporal-operadores.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; update the doc comments of both files and the `OperadorOpcion` JSDoc ("have a PIN configured and no pending password change").
- [ ] **Step 4: Run** `npm test -- tests/unit/contrasena-temporal-operadores.test.ts tests/unit/cuentas-de-sector-verificar-operador.test.ts tests/unit/cuentas-de-sector-pipeline.test.ts` (PASS), `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(auth): a usuario with a pending password change cannot act as operador`.

---

### Task 11: `/cuenta` — remove "Eliminar PIN", hide the PIN panel for cuentas de sector

**Files:**
- Create: `app/(app)/cuenta/cuenta-forms.tsx` (client; the current `page.tsx` body minus the delete form)
- Modify: `app/(app)/cuenta/page.tsx` (becomes a server component), `app/(app)/cuenta/actions.ts` (remove `eliminarPinAction`)
- Delete: `modules/auth/application/eliminar-pin.ts`; remove `clearPin` from `modules/auth/infrastructure/usuario-repository.ts` if `git grep clearPin` shows no other user (it did not at planning time)
- Test: `tests/unit/auth-pin-removed.test.ts` (new); update any test importing `eliminar-pin` (`git grep eliminar-pin -- tests`)

**Interfaces:**
- Produces: `CuentaForms({ mostrarPin }: { mostrarPin: boolean })` client component; `page.tsx` calls `requireSession()` and passes `mostrarPin={!session.sector}`.

- [ ] **Step 1: Write the failing test** `auth-pin-removed.test.ts`: the registry glob (as in Task 5) contains no use case named `auth.pin.eliminar`; `app/(app)/cuenta/actions.ts` source does not contain `eliminarPin` (file-read assertion); the PIN panel text copy is covered by Step 3 only (UI).
- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/unit/auth-pin-removed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `configurarPinAction` (changing the PIN with the current password stays as is). `PinSection` loses the delete form and its text; PIN panel description: "Un PIN de 4 dígitos para identificarte en las cuentas de sector…" (use `AUTH_POLICY.pinLength`). `page.description` for sector: "Tu contraseña para confirmar acciones.".
- [ ] **Step 4: Run** the test (PASS), `npm run typecheck`, `npm run lint`.
- [ ] **Step 5: Commit** — `feat(auth): remove Eliminar PIN and hide the PIN panel for cuentas de sector`.

---

### Task 12: `scripts/create-tenant.ts` with a temporary password

**Files:**
- Modify: `scripts/create-tenant.ts`, `tests/db/inv-u07-actor-activo.test.ts` (mirrored bootstrap INSERT). `docs/deploy.md` §5 is updated in Task 14.
- Test: `tests/unit/create-tenant-script.test.ts` (new)

**Interfaces:**
- Consumes: `hashPassword`, `validatePassword`.
- Produces: optional flag `--admin-password-temporal=...`; when absent the script prompts twice on stdin with echo disabled (`readline` + muted output) and aborts on mismatch or policy violation (prints `validatePassword` errors). The first admin is inserted `estado = 'ACTIVO'`, `password_hash = <argon2id>`, `debe_cambiar_password = true`; no `credencial_activacion` insert, no `randomBytes/createHash`, no `AUTH_POLICY.activationCredentialTtlHours`. Output prints tenant id, admin id, admin email and "On first login the admin must change this temporary password and set a PIN." — never the password.

- [ ] **Step 1: Write the failing test** `create-tenant-script.test.ts` (source-level guard, since the script runs `main()` on import and talks to the owner DB): the file contains `debe_cambiar_password`, `hashPassword(` and `'ACTIVO'` in the admin INSERT, and does **not** contain `credencial_activacion`, `activationCredentialTtlHours`, `createHash` or `console.log` of the password variable. **CT1**.
- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/unit/create-tenant-script.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the header comment, `printUsageAndExit`, and the bootstrap comment "PENDIENTE_ACTIVACION". Update the mirrored INSERT in `tests/db/inv-u07-actor-activo.test.ts` ("scripts/create-tenant.ts bootstrap sequence", line ~336) to the new admin shape (ACTIVO + `password_hash` placeholder + `debe_cambiar_password = true`).
- [ ] **Step 4: Run** `npm test -- tests/unit/create-tenant-script.test.ts`, `FSJ_DB_TESTS=yes npm run test:db -- tests/db/inv-u07-actor-activo.test.ts` (PASS), `npm run typecheck`. Do **not** run the script against the shared DB.
- [ ] **Step 5: Commit** — `feat(scripts): create the first admin with a temporary password`.

---

### Task 13: Remove the activation-by-code flow

**Files:**
- Delete: `app/(auth)/activar/` (page, actions), `modules/auth/application/activar-cuenta.ts`, `modules/auth/domain/activation-policy.ts`, `modules/usuarios/ui/credencial-activacion.tsx`, `tests/unit/auth-activation-policy.test.ts`
- Modify: `proxy.ts` (`PUBLIC_PATHS = ["/login"]`, matcher comment), `app/(auth)/login/page.tsx` (remove the «Primera vez o te dieron un código de activación» paragraph; keep the "contactá al administrador" note), `app/(auth)/layout.tsx` comment, `next.config.ts` comment (`/activar` mention), `modules/auth/infrastructure/usuario-repository.ts` (delete `consumeCredencialActivacion`, `activarUsuario`; fix header/`resolveLoginByEmail` comments), `modules/usuarios/infrastructure/usuario-repository.ts` (delete `insertCredencialActivacion`, `revokeCredencialesActivas`, `EmitirCredencialInput`; fix header), `shared/auth/policy.ts` (delete `activationCredentialTtlHours` and fix the header comment), `modules/auth/application/{cambiar-password,logout,create-session,login}.ts` and `modules/auth/ui/new-password-fields.tsx` (comments that cite `/activar`/`activarCuenta`), `modules/usuarios/application/reactivar-usuario.ts` (comment)
- Tests: `tests/unit/auth-policy.test.ts` (drop the 72h assertion), `tests/db/auth-login-activacion.test.ts` → `git mv tests/db/auth-login.test.ts`, keeping the `usuario_resolve_login`, lockout and `cambiarPassword` describes and deleting the "activation credential atomic consumption" describe and its `consume` mirror helper; `tests/db/usuarios-admin.test.ts`, `tests/db/auth-sessions.test.ts` comments only if they cite removed code

**Interfaces:** none produced. Nothing may import the removed symbols.

- [ ] **Step 1: Write the failing guard test** `tests/unit/activation-flow-removed.test.ts`: none of the removed paths exist (`fs.existsSync` false); `proxy.ts` `PUBLIC_PATHS` does not include `/activar` (import via a source-text assertion since `proxy.ts` does not export it); `AUTH_POLICY` has no `activationCredentialTtlHours`; `rg`-style scan of `app/`, `modules/`, `shared/`, `scripts/` source finds no `activarCuenta`, `consumeCredencialActivacion`, `insertCredencialActivacion`, `revokeCredencialesActivas`, `credencial-activacion`. (`prisma/schema.prisma`, `prisma/migrations`, `tests/db` raw SQL and the `ACTIVAR_CUENTA` enum/presentation entries are excluded from the scan.)
- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/unit/activation-flow-removed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Delete and edit** per the list.
- [ ] **Step 4: Run** `npm test` (whole unit suite), `npm run typecheck`, `npm run lint`, `FSJ_DB_TESTS=yes npm run test:db -- tests/db/auth-login.test.ts tests/db/credenciales-sesiones.test.ts` (the table and its triggers still exist, so the latter must stay green untouched).
- [ ] **Step 5: Commit** — `refactor(auth): remove the activation-by-code flow`.

---

### Task 14: Docs

**Files:**
- Modify: `docs/specs/cuentas-de-sector.md`, `shared/auth/README.md`, `docs/deploy.md` (§5), `docs/specs/contrasena-temporal.md` (status line), `docs/rollbacks/contrasena-temporal.md` (fill the "edited / deleted files" lists from `git diff --stat`)

- [ ] **Step 1:** `cuentas-de-sector.md`: rule S7 now reads "…tenga PIN **y no tenga pendiente el cambio de su contraseña temporal**" with the enforcement point `operador-policy.ts` (`DEBE_CAMBIAR_PASSWORD`) and `operadores-repository.ts`; add one line under "Pantallas" that «Mi cuenta» has no PIN panel for a cuenta de sector and no «Eliminar PIN»; the «Nuevo usuario» bullet mentions the temporary password. Tests list gains `contrasena-temporal-operadores.test.ts`.
- [ ] **Step 2:** `shared/auth/README.md`: add a short "Pasos pendientes" section (what `pasosPendientes` is, `requireSession({ permitirPasosPendientes: true })`, the `permitirPasosPendientes` flag on `defineCommand`/`defineQuery` and the allowlist test `auth-pasos-registry.test.ts`, the `(pasos)` route group). `deploy.md` §5: the first ADM gets a temporary password (flag or prompt), no activation credential; deliver it in person; the first login forces the password change and the PIN.
- [ ] **Step 3:** `contrasena-temporal.md`: replace the heading note with "Estado: implementado 2026-10-22 (migración 0097). Reversión: `docs/rollbacks/contrasena-temporal.md`." and add a "Desviaciones" bullet for anything decided differently in Tasks 3, 6, 8, 9 (listed in the final report).
- [ ] **Step 4: Commit** — `docs: temporary password flow in specs, auth README, deploy and rollback`.

---

### Task 15: Final verification and push

**Files:** none (fixes only if a check fails).

- [ ] **Step 1:** `npm run typecheck` — expected: exit 0.
- [ ] **Step 2:** `npm run lint` — expected: 0 errors (architecture-boundary rules included).
- [ ] **Step 3:** `npm test` — expected: all unit tests pass; confirm the invariant tests exist and pass: CT1 (`usuarios-crear-usuario-audit`, `contrasena-temporal-restablecer`, `create-tenant-script`), CT2/CT3 (`auth-require-session-gate`, `auth-pasos-registry`), CT4 (`auth-cambiar-password-temporal`), CT5 (`contrasena-temporal-restablecer`), CT6 (`auth-pasos-pendientes`, `auth-configurar-pin-obligatorio`), CT7 (`contrasena-temporal-operadores`).
- [ ] **Step 4:** `FSJ_DB_TESTS=yes npm run test:db` — expected: all pass (migration 0097 already applied in Task 1).
- [ ] **Step 5:** `npm run build` if the local env allows it (CI runs it); otherwise state it was not run.
- [ ] **Step 6: Manual smoke (only if the user asks for browser checks, per `AGENTS.md`):** with `npm run dev`, create a usuario with a temporary password, log in as them, confirm `/` redirects to `/cambiar-password`, then `/configurar-pin`, then the dashboard; confirm `/login` has no `/activar` link and `/activar` is a 404; confirm the new routes are not swallowed by the `(app)/@modal/[...catchAll]` slot (see the `looseRouteMatching` note in `next.config.ts`).
- [ ] **Step 7:** `git status` clean; `git push origin master`. State in the hand-off what was NOT verified (browser smoke, build).

---

## Self-review

- **Spec coverage:** column+grant+revocation (T1); derived steps/CT6 (T2); gate in `requireSession`, opt-out, CT2/CT3 (T3, T5 allowlist); step 1 (T4, CT4); step 2 (T5); step pages/outside `(app)`/logout/layout redirect/form error (T6); login redirect (T7); `crearUsuario` + UI + toast + labels (T8, CT1); `restablecerCredencial` with state matrix, PIN kept, locks, audit (T9, CT5); operators (T10, CT7); `/cuenta` + `eliminarPin` (T11); `create-tenant` (T12); activation removal incl. `PUBLIC_PATHS`, `AUTH_POLICY`, repo fns, login link (T13); docs + rollback (T1, T14); tests list from the spec's "Tests a actualizar" (T8, T9, T12, T13).
- **Type consistency:** `PasoPendiente`/`rutaDelPaso` (T2) used in T3, T6, T7; `permitirPasosPendientes` naming identical in `requireSession` options, config flag and registry entry; `passwordTemporal`/`passwordTemporalRepeat` identical in T8 and T9; `completarCambioPasswordTemporal` (T4) is the only flag-clearing writer (guard test).

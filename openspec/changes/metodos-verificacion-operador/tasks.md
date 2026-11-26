# Tasks

Design: `design.md`. Behavior: `specs/cuentas-de-sector/spec.md` (delta). Proposal: `proposal.md`.

`strict_tdd: false` (`openspec/config.yaml`), but the design asks for test-first on the new units: write the test in the
same work unit as the code it covers. CI is the gate; every slice states what was NOT verified locally.

## Delivery plan (auto-chain, feature-branch-chain)

- Tracker branch `feat/metodos-verificacion-operador` from `master`, with a draft/no-merge tracker PR. **Nothing merges to `master` until the whole change is verified (section 6).** Never push to `master`.
- Each slice is one PR; PR 1 targets the tracker, every later PR targets the immediately previous slice branch, so each diff shows only its own work unit. Each PR body carries the dependency diagram with the current PR marked.
- Each commit is a work unit (code + its tests + the docs it explains); Conventional Commits, no AI attribution.

```
master
  └─ feat/metodos-verificacion-operador   (tracker, draft, merges last)
       └─ PR 1  feat/mvo-0-registro-unico            slice 0 refactor
            └─ PR 2  feat/mvo-1-config-por-farmacia  slice 1 per-farmacia config
                 └─ PR 3  feat/mvo-2a-huella-servidor slice 2a huella server
                      └─ PR 4  feat/mvo-2b-huella-ui   slice 2b huella UI
```

Reviewers read `design.md` once; each PR states start state, end state, prior dependencies, follow-up, out of scope.

## Open points to resolve before PR 1 is applied

- [x] 0.1 (accepted by the user 2026-11-25) `design.md` "Open questions": confirm D7 (no seed, no backfill, no `crear_tenant_interno` replacement). The delta's "Valores iniciales" scenarios stay true because huella defaults to off and PIN is code-always-on; no PIN row is required.
- [x] 0.2 (accepted by the user 2026-11-25) Confirm S7 for huella (credential only, no PIN needed) and that registering while the method is disabled is rejected; removal always allowed. Both are assumed in the design.
- [x] 0.3 Strict TDD: resolved 2026-11-25 — `openspec/config.yaml` (`strict_tdd: false`) is authoritative; the earlier "active" report came from a stale memory. Tests are still written with the code as listed per slice.
- [ ] 0.4 Create the tracker branch and the draft tracker PR.

---

## Slice 0 — PR 1: one registry, PIN as an entry (no behavior or copy change)

Branch `feat/mvo-0-registro-unico` -> targets `feat/metodos-verificacion-operador`.
Start: `master`-equivalent. End: PIN flows through registries and a generic credential; output identical.
Must pass **unchanged** (do not edit): `tests/unit/cuentas-de-sector-{alta,auditoria,password-politica,pipeline,verificar-operador}.test.ts`, `auth-pin-disponible`, `auth-configurar-pin`, `auth-configurar-pin-obligatorio`, `auth-reauth-pin`, `auth-pin-removed`, `auth-pin-never-for-login-or-cofirma`, `contrasena-temporal-operadores`, `logger`, `tests/db/auth-pin.test.ts`, `tests/db/catalogo-guardas.test.ts`.

Commit A — `refactor(auth): derive operador carrier and field names from a method catalog`
- [x] 1.1 `modules/auth/domain/verificacion-identidad.ts`: `PruebaDeIdentidad` union (PIN only), `MetodoVerificacion`, `METODOS_VERIFICACION`, `METODO_POR_DEFECTO = "PIN"`, `METODOS` catalog (`etiqueta`, `claves`, `siempreHabilitado`, `almacen`). Pure: no zod, Prisma or Next (D1). Done: typechecks; `domain/` lint boundary green.
- [x] 1.2 `shared/auth/operador-campos.ts`: `campoDeOperador`, `camposDeOperador`, `esCampoDeOperador`, `CAMPOS_DE_PRUEBA_OPERADOR`; keep `CAMPO_OPERADOR_PIN = "operadorPin"` (D4, D5). Done: `{ operadorPin }` still yields `{ prueba: { metodo: "PIN", pin } }`.
- [x] 1.3 `shared/auth/operador-context.ts` / `operador.ts`: `credencialDesde` collects catalog fields generically, `operadorMetodo` defaults to PIN; carrier is `{ prueba }`. `shared/usecase.ts` `resolverActor`: rejection marker uses `camposDeOperador(credencial.prueba.metodo)` (D5), contract otherwise untouched.
- [x] 1.4 Tests (new files): `campoDeOperador`/`camposDeOperador`/`esCampoDeOperador`; carrier collects fields generically and defaults to PIN.

Commit B — `refactor(auth): add method registry and shared secret-code strategy`
- [x] 1.5 `modules/auth/infrastructure/operador-elegible.ts`: the S7 filter (`OPERADOR_ELEGIBLE`) as the single source; `loadPinHashesDeOperadores` spreads it so its `findMany` argument stays deep-equal (design "PIN wiring").
- [x] 1.6 `modules/auth/application/identificacion-por-codigo.ts`: `FuenteDeCodigos`, `identificadorPorCodigo`, `assertCodigoDisponible`.
- [x] 1.7 `modules/auth/application/metodos-verificacion.ts`: `REGISTRO` (PIN only; schema exactly today's `min(1).max(64)`, today's two rejection messages verbatim, optional `iniciar` with no caller). PIN source wraps `loadPinHashesDeOperadores` / `loadPinHashesDeOtros` in arrow functions (lock `'fsj.pin:'` unchanged) so partial vitest mocks stay valid.
- [x] 1.8 `modules/auth/application/{identificador-pin,verificar-operador,pin-disponible}.ts`: dispatch by method (D2); `pin-disponible.ts` keeps signature and messages and delegates.
- [x] 1.9 Tests (new): registry keys equal `METODOS_VERIFICACION` at runtime (guards against casts); strategy run against a fake `FuenteDeCodigos` (match, none, AMBIGUA, S7 filtering, uniqueness).

Commit C — `refactor(ui): consume the method registry in the dialog, form errors, logger and audit label`
- [x] 1.10 `modules/operadores/ui/metodos-en-dialogo.tsx`: client registry (PIN `Campo`, `prioridad`); `operador-provider.tsx` renders from it (a single method shows no switch: dialog identical to today) (D9).
- [x] 1.11 `shared/ui/use-form-submit.ts`, `shared/ui/form-parts.tsx:140`, `planilla-existencia-inicial.tsx:480`: use `esCampoDeOperador`; on success delete every `CAMPOS_DE_PRUEBA_OPERADOR` field.
- [x] 1.12 `shared/logging/logger.ts`: redaction from the catalog (`enTresNiveles([...existing, ...CLAVES_Y_CAMPOS_DE_PRUEBA])`); `modules/auditoria/ui/auditoria-diff.tsx`: label from `METODOS[verificacion]?.etiqueta ?? verificacion` ("identificado con PIN" unchanged).
- [x] 1.13 Tests: logger redacts every catalog key (per-method loop, PIN only today); audit label unchanged.

Commit D — `docs(auth): how to add a verification method`
- [x] 1.14 The 6-step guide goes in `shared/auth/README.md` (new section "Adding a verification method"; that is where auth/session/operador readers look per AGENTS.md). Add a one-line pointer in `modules/README.md` (auth and operadores entries). Copy the six steps from `design.md` "How to add a method".
- [x] 1.15 `docs/rollbacks/metodos-verificacion-operador.md`: create with the slice 0 section (revert the commits; no schema). Later slices append.

Done criteria PR 1: typecheck, lint, `npm test` green with the guard tests untouched; no copy or message diff; no schema.
Not verified locally (state in PR): `test:db`, browser dialog check. Manual: open the PIN dialog on a cuenta de sector, wrong PIN keeps the form and marks the PIN field.
Rollback: revert the PR (no schema).

---

## Slice 1 — PR 2: per-farmacia configuration

Branch `feat/mvo-1-config-por-farmacia` -> targets `feat/mvo-0-registro-unico`.
Start: PR 1. End: an Administrador can enable/disable optional methods; the server rejects disabled methods. No optional method exists yet (admin section renders only when one is optional), so production behavior is unchanged.

Commit E — `feat(auth): per-farmacia method enablement table and server gate`
- [ ] 2.1 Verify the next free migration number by listing `prisma/migrations/` (latest seen 0131; duplicates exist at 0124/0129/0130; recheck before creating). Create `prisma/migrations/<timestamp>_0132_metodo_verificacion_habilitado/migration.sql`: table `fsj.metodo_verificacion_habilitado (tenant_id, metodo text CHECK (metodo ~ '^[A-Z][A-Z_]{1,29}$' AND metodo <> 'PIN'), PK (tenant_id, metodo))`, `fsj.setup_tenant_table` (RLS ENABLE + FORCE + policy), `GRANT DELETE`, `REVOKE UPDATE`. No seed, no `crear_tenant_interno` replacement (D7). Prisma model + `npm run db:generate`.
- [ ] 2.2 `prisma/rollbacks/<timestamp>_0132_metodo_verificacion_habilitado.down.sql` (drop table; follow the newest rollback naming and mirror the migration folder name). Append the 0132 section to `docs/rollbacks/metodos-verificacion-operador.md` (code first, then down).
- [ ] 2.3 `loadMetodosHabilitados` in infrastructure, seeded with `siempreHabilitado` methods; `SesionDeSector.metodosHabilitados` (optional, absent = always-on only, fail-closed) filled where `loadPermisosConPin` is (D8).
- [ ] 2.4 `verificar-operador.ts`: gate before scanning; a disabled method is rejected with the generic message and audited with internal reason `DESHABILITADO` (S9).
- [ ] 2.5 Tests: unit gate with a mocked optional registry entry (no real optional method yet): disabled -> rejected + audited, enabled -> proceeds, absent set -> PIN only; DB: RLS/grants of the new table in `tests/db/` (opt-in `npm run test:db`), `tests/db/catalogo-guardas.test.ts` passes without adding an exception (PK leads with `tenant_id`).

Commit F — `feat(operadores): admin section to enable verification methods`
- [ ] 2.6 `modules/operadores/application`: `operadores.metodosVerificacion.configurar` (`config.editar`, audit `metodo_verificacion`/MODIFICAR, `entidadId` = tenant, before/after + activados/desactivados, delete+insert) and its list query (same permiso as `list-acciones-con-pin`). PIN cannot be disabled (rejected). Register both use cases wherever existing ones are (permiso catalog, `ayuda-permisos.ts`).
- [ ] 2.7 `app/(app)/admin/configuracion/pin/*`: «Métodos de verificación» section, rendered only when a non-always-on method exists; `layout.tsx` passes `metodos={[...session.sector.metodosHabilitados]}` to `OperadorProvider`.
- [ ] 2.8 `modules/auditoria/domain/presentacion.ts`: label for `metodo_verificacion`.
- [ ] 2.9 Tests: configure command (permission, PIN rejected, audit before/after, no-op), list query.

Commit G — `refactor(ui): method-neutral verification copy`
- [ ] 2.10 User-facing copy becomes «Verificación» (headings, help, dialog title text stays «¿Quién realiza esta acción?»). Route, `accion_con_pin`, `PERMISOS_CON_PIN_*`, `configurar-pin` keep their names. Update only strings; grep for tests asserting old copy and update them in this commit.

Done criteria PR 2: CI green; `catalogo-guardas` unchanged; PIN-only farmacia sees today's dialog and the admin section is hidden.
Not verified locally: `test:db` unless run (state it). Rollback: code revert, then 0132 down (docs).

---

## Slice 2a — PR 3: huella server

Branch `feat/mvo-2a-huella-servidor` -> targets `feat/mvo-1-config-por-farmacia`.
Start: PR 2. End: HUELLA exists in the catalog and server registry, credentials can be registered/removed through use cases, identification works end to end server side. No UI yet; HUELLA is off by default and has no UI to enable until 2b adds its client entry, so the typecheck-forced client entry lands here as a stub (see 3.6).

Commit H — `feat(auth): credencial_operador table and generic code-credential source`
- [ ] 3.1 Next free migration number (re-list `prisma/migrations/`; expected 0133, but 0132 may have been taken by another branch): `<timestamp>_0133_credencial_operador/migration.sql`: `(tenant_id, usuario_id, metodo CHECK (same, <> 'PIN'), hash NOT NULL, creado_en, actualizado_en, PK (tenant_id, usuario_id, metodo), FK (tenant_id, usuario_id) -> usuario (tenant_id, id))`, `setup_tenant_table`, `GRANT UPDATE (hash, actualizado_en), DELETE`. Prisma model; `.down.sql` in `prisma/rollbacks/`; append the 0133 section (revert code, then 0133.down, then 0132.down) to `docs/rollbacks/metodos-verificacion-operador.md`.
- [ ] 3.2 `modules/auth/infrastructure/credencial-operador-repository.ts`: `candidatos` (uses `OPERADOR_ELEGIBLE` + credential row), `hashesDeOtros` with advisory lock `hashtext('fsj.credencial:' || metodo || ':' || tenant)`; hash with `hashPassword` (argon2id, D3).
- [ ] 3.3 DB tests: table RLS/FORCE, grants (no UPDATE on other columns), cross-tenant isolation; `tests/db/catalogo-guardas.test.ts` unchanged and green.

Commit I — `feat(auth): HUELLA method in the catalog and server registry`
- [ ] 3.4 `verificacion-identidad.ts`: add `{ metodo: "HUELLA"; huella: string }`, `METODOS.HUELLA` (label "Huella", key `huella` per D6, `almacen: "CREDENCIAL_OPERADOR"`, not always-on). `metodos-verificacion.ts`: `REGISTRO.HUELLA` (min 6, rejection «La huella no corresponde a ningún empleado habilitado.», ambiguous message, uniqueness message «Ese código no se puede usar. Probá con otro.»).
- [ ] 3.5 `modules/auth/application` credential use cases, generic over `METODOS_CON_CREDENCIAL_PROPIA`: `auth.credencialOperador.registrar` `{metodo, passwordActual, huella}` (`auth.password.cambiar`; requires current password, rejects cuentas de sector, admin-only usuarios and disabled methods; `assertCodigoDisponible` before hashing; upsert; audit `usuario`/MODIFICAR `{ credencial: metodo }`) and `auth.credencialOperador.eliminar` (own).
- [ ] 3.6 `modules/usuarios/application`: `usuarios.credencialOperador.eliminar` `{usuarioId, metodo}` (`usuarios.credencial.restablecer`, lock order and not-on-self as `restablecer-pin`, audit `RESTABLECER_CREDENCIAL`). Catalog/permiso registration and `ayuda-permisos.ts` names the huella.
- [ ] 3.7 `modules/operadores/ui/metodos-en-dialogo.tsx`: minimal `HUELLA` entry required by the mapped type (text input, `prioridad` above PIN) so `typecheck` passes; final polish in 2b.
- [ ] 3.8 Tests (unit, test first): identification, AMBIGUA, S7 (suspended / `debeCambiarPassword` / cuenta de sector excluded); uniqueness with lock, per-method and cross-method (same text as PIN of another accepted; same as own PIN accepted); disabled method rejected and audited `DESHABILITADO`; short code rejected as failed identification; deshabilitar+rehabilitar keeps credentials; logger redacts `huella` / `operadorHuella` at three levels; audit never contains code or hash (registrar, eliminar, rejection); sector account rejected for register/remove; disabled method rejects registration but not removal; admin remove leaves PIN untouched and PIN reset leaves huella untouched.

Done criteria PR 3: CI green; guard tests from slice 0 still unchanged; typecheck forces no other file to change (proves the extension claim).
Not verified locally: `test:db` unless run. Rollback: code revert, 0133.down.

---

## Slice 2b — PR 4: huella UI

Branch `feat/mvo-2b-huella-ui` -> targets `feat/mvo-2a-huella-servidor`.
Start: PR 3. End: the full feature is usable.

Commit J — `feat(cuenta): huella panel in Mi cuenta`
- [ ] 4.1 `app/(app)/cuenta/*`: huella panel (enroll/replace/remove, wedge input + Enter, min-6 message, current password), hidden for cuentas de sector; uses `useFormSubmit`, `field-errors`, `@container` layout, works at 375px (AGENTS.md conventions). Server Actions stay thin and call the credential use cases.
- [ ] 4.2 Panel visible only when HUELLA is enabled in the farmacia (registering while disabled is rejected server-side).

Commit K — `feat(usuarios): remove a huella from Usuarios detalle`
- [ ] 4.3 `Usuarios › detalle`: huella section shows only enrolled yes/no and a remove button (confirm dialog; unmounted/`key`ed form per the `<dialog>` convention); no enroll, no code.

Commit L — `feat(operadores): huella in the verification dialog and enablement toggle`
- [ ] 4.4 Final `METODOS_EN_DIALOGO.HUELLA`: focus on open and on switch, Enter submits the native form, opens on huella when enabled, PIN one click away, method switch only with more than one method, reopens on the last method used after a rejection, rejected secret cleared, rest of the form kept (D5, "Client").
- [ ] 4.5 Admin section now renders the HUELLA toggle (already generic from slice 1; verify copy and the disabled-keeps-codes note). Update the reader note (suffix/prefix config, static-secret security note) in the admin section help.
- [ ] 4.6 `docs/rollbacks/metodos-verificacion-operador.md`: UI revert note; final ordering confirmed.

Done criteria PR 4: CI green. Manual (list in section 6): real wedge reader, dialog defaults and focus, 375px, `Enter` submit.
Not verified locally: everything browser/hardware-related unless done (state it). Rollback: revert PR 4 (UI only).

---

## 5. Spec prose (decision)

The delta is merged at archive, so the prose sections of `openspec/specs/cuentas-de-sector/spec.md` that a delta cannot express are updated **at archive (6.2), in the same commit as the merge**, not in a slice: editing prose earlier would leave the main spec's prose contradicting its still-unmerged normative requirements, and the main spec is what agents read. Each slice's PR description lists which prose sections its behavior affects.

- [ ] 5.1 At archive: rewrite «Alcance», «Modelo», «Verificación», «Cómo viaja la credencial» and «Pantallas» to be method-neutral and to describe the registry, per-farmacia enablement, huella enrollment/removal and the dialog; add the new test cases to «Casos de prueba».

## Review Workload Forecast

| PR | Slice | Estimated changed lines (additions + deletions) | 400-line risk |
|---|---|---|---|
| 1 | 0 registry refactor + guide + rollback doc | ~450 (incl. ~80 guide/docs, ~120 tests) | Medium |
| 2 | 1 config (migration, gate, use cases, admin, copy) | ~450 (incl. tests ~150) | Medium-High |
| 3 | 2a huella server (migration, repo, 3 use cases, tests) | ~420 | Medium-High |
| 4 | 2b huella UI | ~320 | Low |

- Chained PRs recommended: **Yes** (4 chained PRs, feature-branch-chain, already approved by the user).
- 400-line budget risk: **Medium-High** overall. PR 1 can be trimmed by moving Commit C (client registry + logger) into PR 2 if the real diff passes 400; PR 2 can move Commit G (copy-only) into PR 4. Decide on `git diff --stat` before opening each PR.
- Decision needed before apply: **Yes** (small): resolve the 0.x open points (D7 deviation, S7 for huella, strict TDD flag). The delivery strategy and chain strategy are already decided. If a PR still exceeds 400 after trimming, a maintainer must accept `size:exception` for that PR (migration SQL counts in the diff).

## 6. Integration and verification of the tracker (before merging to master)

Order: merge PR 4 into PR 3's branch, then PR 3 into PR 2's, PR 2 into PR 1's, PR 1 into the tracker (each after green CI), or retarget so the tracker accumulates all four. Only then:

- [ ] 6.1 `npm run typecheck`
- [ ] 6.2 `npm run lint` (architecture boundaries)
- [ ] 6.3 `npm test`
- [ ] 6.4 `npm run test:db` with `FSJ_DB_TESTS=yes` (local DB; never reset it). Includes `catalogo-guardas`, the 0132/0133 table tests and `auth-pin`.
- [ ] 6.5 `npm run specs:validate`
- [ ] 6.6 Migrations: re-list `prisma/migrations/` and confirm numbers are still free and ordered after any newer `master` migration; apply to the dev DB; the second DB (`.env.prod`) is migrated only via the exact `docs/deploy.md` §4 command, at release.
- [ ] 6.7 Manual: PIN-only farmacia sees today's dialog and no admin methods section (P-PIN parity); wrong PIN keeps the form and marks the PIN field; enable huella in admin and audit shows before/after; enroll in «Mi cuenta» (min 6, duplicate rejected without revealing the owner, replace, remove); cuenta de sector sees no panel; dialog opens on huella with focus, real wedge reader + Enter runs the action, audit shows `HUELLA` and no code; PIN one click away; disable huella then re-enable: same code works; disabled method rejected server-side; Admin removes a huella from Usuarios detalle, PIN intact; 375px, no horizontal scroll; check app logs for the code.
- [ ] 6.8 CI on the tracker PR green; take it out of draft; merge to `master` via PR (never a direct push).

## 7. Archive

- [ ] 7.1 Merge the delta into `openspec/specs/cuentas-de-sector/spec.md` and apply task 5.1 (prose) in the same commit.
- [ ] 7.2 Move the change to `openspec/changes/archive/YYYY-MM-DD-metodos-verificacion-operador/`.

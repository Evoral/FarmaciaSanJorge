# Tasks

Design: `design.md`. Behavior: `specs/libro-recetario-y-contralor/spec.md` and `specs/plataforma/spec.md` (deltas).

Strict TDD: in every unit, write the failing test first (RED), then the code (GREEN), then tidy. The four units below are
ordered work-unit commits on `master`; each one must leave CI green (typecheck, lint, test, build) on its own. The delta
specs are merged into `openspec/specs/` at archive (unit D), not before.

Parallelism: A -> B and A -> C are the only hard dependencies. B and C touch disjoint files and could run in parallel, but
there is a single writer, so run them sequentially (B first: it produces the data that C displays).

## Unit A. Migration 0128 + DB tests (commit `feat(libro): persist integrity incidents table and functions`)

Depends on: nothing. Verification for the unit: `npm run typecheck`, `npm run lint`, `npm test`, and `FSJ_DB_TESTS=yes npm run test:db`.

- [ ] A.1 (RED) `tests/db/libro-incidente-integridad.test.ts`: write the cases first. Each transition of `fsj.libro_incidente_registrar`
  (`ABIERTO`, `REPETIDO`, number moved = close + open, `CERRADO`, `SIN_CAMBIO`); a second open row for the same libro fails on the
  partial unique index; `fsj_app` cannot DELETE, cannot UPDATE `libro_id` or `primer_quiebre_numero`, cannot touch a resolved row
  (`INV-L27`); `detecciones` cannot decrease; INSERT with `resuelto_en` set is rejected; another tenant sees no rows (RLS); no tenant
  set raises `TN001`. Platform function: bad token and tenant-session token raise `INV-PLAT-AUTH`, output has only the 8 listed
  columns, `p_solo_abiertos` filters, unknown tenant id returns no rows, `cardinality > 100` is rejected, limit is clamped to 1..200,
  PUBLIC has no EXECUTE. Specs: libro "Primer quiebre", "Detección repetida", "El quiebre se corre", "Dos libros rotos", "Reanclaje
  exitoso", "Reanclaje y luego otro quiebre", "Otro tenant"; plataforma P18 scenarios. Files: `tests/db/libro-incidente-integridad.test.ts`.
  Note: true two-transaction concurrency ("Detecciones simultáneas") may not fit the rolled-back harness; if not, record it as
  covered by review of the advisory lock and the partial unique index, and say so in the apply report.
- [ ] A.2 Take the next free migration number and a timestamp later than every existing migration (design assumes `0128`, previous
  highest `0127`; `0124` is used twice, do not trust the count). Create
  `prisma/migrations/20261111120000_0128_libro_incidente_integridad/migration.sql`: table with FK `(tenant_id, libro_id)` to
  `fsj.libro_rubricado (tenant_id, id)` and the CHECKs; `SELECT fsj.setup_tenant_table(...)` (RLS ENABLE + FORCE, `tenant_isolation`,
  tenant_id trigger); indexes `uq_libro_incidente_integridad_abierto` (partial unique) and `libro_incidente_integridad_libro_idx`
  `(tenant_id, libro_id, detectado_en DESC)`; grants (defaults give SELECT/INSERT only per migration 0000) plus
  `GRANT UPDATE (ultima_deteccion_en, detecciones, resuelto_en)`, never DELETE; `fsj.forbid_delete()` trigger;
  `fsj.libro_incidente_validar()` BEFORE INSERT OR UPDATE raising `INV-L27`.
- [ ] A.3 Same migration: `fsj.libro_incidente_registrar(p_libro_id uuid, p_quiebre bigint)` returns `(transicion text, incidente_id uuid)`,
  plpgsql, SECURITY INVOKER, `SET search_path = fsj, extensions`, `pg_advisory_xact_lock(hashtextextended('libro_incidente:' || p_libro_id, 0))`
  first, tenant from `fsj.current_tenant_id()`; `REVOKE ALL FROM PUBLIC` (fsj_app reaches it through 0101 default privileges; confirm
  this is intended since INVOKER + RLS makes it safe).
- [ ] A.4 Same migration: `fsj.plataforma_incidentes_integridad(p_token_hash text, p_tenant_ids uuid[], p_solo_abiertos boolean, p_limit integer)`,
  SECURITY DEFINER, `SET search_path = fsj, extensions`, `fsj.plataforma_actor(p_token_hash)` as the first statement, joins
  `libro_rubricado` only for `tipo`, order open first then `detectado_en DESC`; `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO fsj_app`. It does NOT
  take a `p_tenant_id` single arg, so the AGENTS.md `p_tenant_id` rule (refuse when different from current tenant) does not apply; it follows the `fsj.plataforma_*` exception.
- [ ] A.5 `prisma/rollbacks/0128_libro_incidente_integridad.down.sql`: drop both functions (explicit signatures), `fsj.libro_incidente_validar()`,
  then the table.
- [ ] A.6 GOTCHA `INV-L27`: confirm the code is still free (`rg "INV-L27"`); add its Spanish message to `shared/errors/mensajes-invariantes.ts`
  in this same commit, otherwise `tests/unit/mensajes-invariantes-global.test.ts` fails. If a different code is taken, update design/spec references.
- [ ] A.7 Check `tests/db/catalogo-guardas.test.ts` passes unchanged (RLS FORCE + policy, FK index on `(tenant_id, fk)`); do not add exceptions.
- [ ] A.8 Apply the migration to the dev DB per `docs/deploy.md` (never `migrate reset`); re-run `npm run db:generate` only if Prisma schema changed (no Prisma model is added, so it should not).
- [ ] A.9 Verify: `FSJ_DB_TESTS=yes npm run test:db` green for the new file and `catalogo-guardas`; `npm test` green. Note the known dev-DB drift (teammate's migrations 0109/0121/0122) if db tests fail for unrelated reasons.

## Unit B. Libro side: verification payload, registration command, layout wiring (commit `feat(libro): register integrity incidents on verification miss`)

Depends on: A. Verification for the unit: `npm run typecheck`, `npm run lint`, `npm test`, `FSJ_DB_TESTS=yes npm run test:db` for any repository test.

- [ ] B.1 (RED) `tests/unit/resumen-integridad.test.ts`: on a miss `resumenIntegridadConVerificacion()` returns `verificacion` listing every open libro
  (OK ones with `quiebre: null`); on a hit `verificacion` is `null` and `quebrados` is identical; `resumenIntegridad()` keeps returning `LibroQuebrado[]`;
  invalidation forces a miss. Spec: libro "Resultado en memoria vigente", "Reanclaje exitoso".
- [ ] B.2 GREEN: `modules/libro/domain/integridad.ts` add `VerificacionLibro` (`libroId`, `tipo`, `quiebre: string | null`); `modules/libro/application/resumen-integridad.ts`
  returns `{ quebrados, verificacion }` from the query (D2) and exports `resumenIntegridadConVerificacion()`; the query stays read-only.
- [ ] B.3 (RED) `tests/unit/registrar-incidentes-integridad.test.ts`: use case declares `permiso: "libro.ver"` and `audit: { skip: true, reason }`; throws `AuthorizationError`
  without the permiso; one repository call per libro; output lists only `ABIERTO` transitions; wrapper logs `error` with exactly `{ tenantId, libroTipo, quiebre, incidenteId }`
  after commit; no `error` on `REPETIDO`; a thrown error becomes `warn` and resolves; a Next control-flow error is rethrown; a logger that throws does not propagate;
  input max 10 libros. Specs: libro "Detección repetida", "La base falla al registrar", "Usuario sin libro.ver", "Registro sin actor", "Se abre un incidente", "Detección repetida" (log).
- [ ] B.4 GREEN: `modules/libro/infrastructure/incidente-integridad-repository.ts` with `registrarVerificacionLibro(tx, libroId, quiebre)` calling `fsj.libro_incidente_registrar`
  (follow the raw-query style of `libro_reanclaje` repository); `modules/libro/application/registrar-incidentes-integridad.ts` with the `defineCommand`
  `libro.integridad.registrarIncidentes` and the fail-soft wrapper `registrarIncidentesIntegridad`.
  GOTCHA: `catch (e) { unstable_rethrow(e); ... }` first, because `requireSession()` reads `cookies()` (precedent: `require-superadmin.ts`, f7a2975).
  GOTCHA: every logger call, including `getLogger()` itself, sits inside its own `try` (`shared/usecase.ts:288` shows `getLogger()` can throw).
  Log `error` only after commit, from the command output; never pass asiento or patient data.
- [ ] B.5 GOTCHA labels: add `libros` and `quiebre` to `shared/labels/field-labels.ts` (`libroId` already exists) or `tests/unit/usecase-registry-all-modules.test.ts` fails.
  Confirm the registry test also sees the new use case (non-empty permiso, `AuthorizationError` without it).
- [ ] B.6 Wire `app/(app)/layout.tsx`: use `resumenIntegridadConVerificacion()`, assign the banner value first, then `if (verificacion) await registrarIncidentesIntegridad(verificacion)`;
  only for users with `libro.ver` (same gate as the banner). Do NOT use `after()` (it throws with `cookies()` in Server Components, design D1). Banner text, cache and behavior unchanged.
- [ ] B.7 DB test for the repository wrapper if not already covered by A.1 (call through `withTenantTransaction` with a test session); skip if A.1 exercises the same SQL path.
- [ ] B.8 Verify: `npm run typecheck && npm run lint && npm test`; `FSJ_DB_TESTS=yes npm run test:db`. Lint must pass the architecture boundaries (the app layout reaches the module only via `application/`).

## Unit C. Platform side: repository, use cases, badge, detail section (commit `feat(plataforma): show libro integrity incidents to the superadmin`)

Depends on: A (function exists). Independent of B at code level. Verification for the unit: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

- [ ] C.1 (RED) `tests/unit/plataforma-usecases.test.ts`: list maps open-incident counts to `FarmaciaListada.incidentesAbiertos` (0 when only resolved, a SUSPENDIDO farmacia keeps both estado and count);
  detail use case includes up to 50 incidents, open first; unknown tenant id still "not found"; the incidents call receives the session token hash. Specs: P8 scenarios, P17, P18 "Unknown tenant id", P19 "Suspended pharmacy".
- [ ] C.2 GREEN: `modules/plataforma/domain/farmacia.ts` add `IncidenteIntegridad` and `FarmaciaListada.incidentesAbiertos: number`;
  `modules/plataforma/infrastructure/plataforma-repository.ts` add `incidentesIntegridad(tx, tokenHash, tenantIds, soloAbiertos, limit)`;
  use cases `listar-farmacias` (one call per page with `p_solo_abiertos = true`, same transaction as the list) and `ver-farmacia` (limit 50) via `definePlataforma`, guarded by `requireSuperAdmin()`.
  No `plataforma_auditoria` row is written (P19). The function is not added to `plataforma_listar_tenants` (no return-type change).
- [ ] C.3 `modules/plataforma/ui/incidentes-integridad.tsx`: presentational section ("Integridad del libro"); `<ol>` list, not a table; each item shows libro tipo via `etiquetaLibro`,
  número, first and last detection, detecciones, estado (ABIERTO, or RESUELTO with date); empty state plus the `field-help` limitation note (incidents appear only when a pharmacy user with `libro.ver` navigates; absence is not proof of integrity). No write controls (P19).
  Layout rules: use `@container` + `@lg:`/`@3xl:` (not `md:`/`lg:`), no horizontal scroll at 375px.
- [ ] C.4 `app/(plataforma)/plataforma/page.tsx`: danger `ToneBadge` "Integridad" in the Estado cell (`flex-wrap`), linking to `/plataforma/farmacias/[id]#integridad`, shown only when `incidentesAbiertos > 0`.
  `app/(plataforma)/plataforma/farmacias/[id]/page.tsx`: render the section as the first panel of the main column with `id="integridad"`.
- [ ] C.5 GOTCHA `unstable_rethrow`: any catch in the new plataforma code path that can wrap `requireSuperAdmin()`/`cookies()` calls `unstable_rethrow(e)` first, so `/plataforma` is not prerendered/failed at build (f7a2975).
  A `INV-PLAT-AUTH` from the function redirects to `/login` as in the existing platform pages (P18 "Superadmin session dead").
- [ ] C.6 Verify: `npm run typecheck && npm run lint && npm test && npm run build`. Manual check (not automated, say so in the report): `/plataforma` at 375px and ~1366px with an open incident, a resolved-only farmacia, and a suspended farmacia.

## Unit D. Docs, spec merge readiness, archive (commit `docs(rollbacks): incidentes-integridad-plataforma`)

Depends on: A, B, C. Verification for the unit: `npm run specs:validate`, `npm run lint`.

- [ ] D.1 `docs/rollbacks/incidentes-integridad-plataforma.md`: order (1) deploy code without the layout call and without the plataforma UI (the banner never depended on the table),
  (2) apply `0128_libro_incidente_integridad.down.sql` as a new forward migration, (3) what is lost (incident history; export as owner first).
- [ ] D.2 Check `modules/README.md` (module map) and `shared/auth/README.md`/`shared/audit/README.md` for text that the new command or the P9 exception contradicts; update only where stale. Update the `libro` and `plataforma` code links in the specs' `## Code` sections at merge time.
- [ ] D.3 Resolve design open question: align spec P18 wording with the function's actual output (it also returns incident `id` and `tenant_id`; the spec text already lists them, confirm the proposal's "only tipo, número..." line is not copied anywhere normative).
- [ ] D.4 `npm run specs:validate` on the change deltas.
- [ ] D.5 Full gate: `npm run typecheck`, `npm run lint`, `npm test`, `FSJ_DB_TESTS=yes npm run test:db`, `npm run build`. State what was not verified (concurrency test, manual UI).

## Archive

- [ ] E.1 Merge the libro delta into `openspec/specs/libro-recetario-y-contralor/spec.md` and the plataforma delta into `openspec/specs/plataforma/spec.md` (P8 and P9 modified; P17, P18, P19 added); update their `## Code` sections.
- [ ] E.2 Move the change to `openspec/changes/archive/YYYY-MM-DD-incidentes-integridad-plataforma/`.

## Review Workload Forecast

| Unit | Estimated changed lines |
|---|---|
| A. migration + down + DB tests + INV-L27 | ~550 (SQL ~260, down ~20, DB test ~270) |
| B. libro command, repository, resumen, layout, labels, unit tests | ~420 |
| C. plataforma repository, use cases, UI, pages, tests | ~420 |
| D. rollback doc + README touch-ups | ~80 |
| Total | ~1,470 |

- 400-line budget risk: High (total), Medium per unit (A slightly over 400)
- Chained PRs recommended: Yes by the size rule, but the user commits straight to `master` with no PRs; the equivalent is the four ordered work-unit commits above, each CI-green.
- Decision needed before apply: Yes (the Review Workload Guard fires on `ask-on-risk`): confirm that the four-unit commit sequence on `master` replaces chained PRs, or record a `size:exception`. `chain_strategy` is not applicable without PRs.
- Suggested slice boundaries: A | B | C | D. Apply one unit per batch; A must land first; B before C so the data exists when the UI is checked manually.

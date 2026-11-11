# Design — Incidentes de integridad del libro visibles en la plataforma

Proposal: `proposal.md`. Behavior: `specs/libro-recetario-y-contralor/spec.md`, `specs/plataforma/spec.md` (deltas).

**In one line:** on a cache miss, `resumenIntegridad` also returns the raw per-libro result. The layout first builds the
banner from it, then awaits a fail-soft `defineCommand` that applies each libro's result through one SECURITY INVOKER
function. `/plataforma` reads incidents only through one SECURITY DEFINER function.

## Sequence (detection → registration)

```
layout.tsx            resumen-integridad.ts        registrar-incidentes-integridad.ts      Postgres
    │ resumenIntegridadConVerificacion()│                         │                            │
    │──────────────────────────────────>│ hit:  {quebrados, verificacion: null}               │
    │                                   │ miss: verificar_cadena per open libro ─────────────>│
    │<── {quebrados, verificacion[]} ───│                         │                            │
    │ librosQuebrados = quebrados   (banner fixed here; nothing below can change it)          │
    │ if verificacion: await registrarIncidentesIntegridad(verificacion)   (never throws)     │
    │────────────────────────────────────────────────────────────>│ command.execute ──────────>│
    │                                   │                         │ per libro:                 │
    │                                   │                         │ fsj.libro_incidente_registrar
    │                                   │                         │<── transicion, id ─────────│ COMMIT
    │                                   │                         │ ABIERTO → logger.error     │
    │                                   │                         │ throw   → logger.warn      │
    │<────────────────────────────────────────────────────────────│                            │
    │ render                                                                                   │
```

## Decisions

| # | Topic | Choice | Rejected | Why |
|---|---|---|---|---|
| D1 | Where the write runs | Synchronous `await` in `app/(app)/layout.tsx`, right after the banner value is assigned, only when `verificacion !== null` | `after()` from `next/server`; writing inside the query | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`: in Server Components, calling `cookies()` inside `after` **throws**. `defineCommand` → `requireSession()` reads cookies, and session injection is test-only (`shared/usecase.ts` `resolveSession`). The cost is paid only on a miss (one per tenant per process every 5 min), next to a full chain walk. Next 16 does not restrict DB writes during RSC render (only cookie mutation). Queries stay read-only (spec). |
| D2 | Cache-miss signal | `resumenIntegridadQuery` returns `{ quebrados, verificacion: VerificacionLibro[] \| null }`. `verificacion` lists every open libro (`libroId`, `tipo`, `quiebre: string \| null`) on a miss, and is `null` on a hit. `resumenIntegridad()` keeps returning `LibroQuebrado[]` (banner contract unchanged). The new `resumenIntegridadConVerificacion()` is for the layout only. | Module-level "pending registration" map consumed by the command | Explicit data flow, testable without process state. OK libros are included so incidents can close. |
| D3 | Write logic | `fsj.libro_incidente_registrar(p_libro_id uuid, p_quiebre bigint)` returns `(transicion text, incidente_id uuid)`. It is plpgsql, **SECURITY INVOKER**, `SET search_path = fsj, extensions`, `REVOKE ALL FROM PUBLIC`, and fsj_app gets it through 0101's default privileges. It first takes `pg_advisory_xact_lock(hashtextextended('libro_incidente:' \|\| p_libro_id, 0))`, then: open with same number → `detecciones+1, ultima_deteccion_en=now()` (`REPETIDO`). Open with a different number → close it, insert a new one (`ABIERTO`). Open and OK → close it (`CERRADO`). None and broken → insert (`ABIERTO`). None and OK → `SIN_CAMBIO`. | Three statements from TS; `ON CONFLICT` alone | One round trip, one place for the state machine. The lock serializes two instances on the same libro, so "the number moved" cannot race. The partial unique index stays as the DB backstop. INVOKER keeps RLS in force. `tenant_id` comes from `fsj.current_tenant_id()` (TN001 without a tenant). |
| D4 | Fail-soft wrapper | `registrarIncidentesIntegridad(verificacion)` in the same application file: `try { execute } catch (e) { unstable_rethrow(e); safeLog("warn") }`. Every logger call goes through its own `try` (`getLogger()` can throw, `shared/usecase.ts:288`). The `error` line is logged **after commit**, from the command output. | Catch in the layout | Same pattern as `require-superadmin.ts`. A swallowed Next control-flow error broke `/plataforma` before (f7a2975). |
| D5 | Audit and permiso | `name: "libro.integridad.registrarIncidentes"`, `permiso: "libro.ver"` (same audience as the query; it is not a PIN permiso, so `resolverActor` passes), `audit: { skip: true, reason: "System-detected integrity incident; the row itself is the record and the browsing user did not cause it" }`. Input: `{ libros: [{ libroId, quiebre }] }` (max 10). | A new permiso | The registry tests (`usecase-registry-all-modules.test.ts`) need a non-empty permiso and an `AuthorizationError` without it, both met. They also need labels for every input key: add `libros`, `quiebre` to `shared/labels/field-labels.ts` (`libroId` exists). |
| D6 | List badge | Same function as the detail, called for the page's tenant ids with `p_solo_abiertos = true`, inside `listarFarmaciasQuery`'s transaction. Adds `incidentesAbiertos: number` to `FarmaciaListada`. | Adding a column to `plataforma_listar_tenants` | Spec P8 says the badge comes from `fsj.plataforma_incidentes_integridad`. Changing the return type would also force a `DROP FUNCTION`. |
| D7 | Logging | `error` on `ABIERTO`, with `{ tenantId, libroTipo, quiebre, incidenteId }`. Failures are logged at `warn` with `{ err }`. No asiento content is ever passed, so no new redaction paths are needed. | | Spec "log estructurado al abrir". |

## Database — migration `20261111130000_0129_libro_incidente_integridad`

0129 was used (the proposal assumed 0128, but a teammate's `0128_consumo_linea_otra_magnitud` took it): 0127 was the highest in the repo, and 0124 is used twice. At implementation, take the next free number and a timestamp
later than every existing migration.

```sql
CREATE TABLE fsj.libro_incidente_integridad (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id uuid NOT NULL,
  libro_id uuid NOT NULL,
  primer_quiebre_numero bigint NOT NULL,
  detectado_en timestamptz NOT NULL DEFAULT now(),
  ultima_deteccion_en timestamptz NOT NULL DEFAULT now(),
  detecciones integer NOT NULL DEFAULT 1 CHECK (detecciones >= 1),
  resuelto_en timestamptz,
  CONSTRAINT libro_incidente_integridad_libro_fkey FOREIGN KEY (tenant_id, libro_id) REFERENCES fsj.libro_rubricado (tenant_id, id),
  CHECK (ultima_deteccion_en >= detectado_en AND (resuelto_en IS NULL OR resuelto_en >= detectado_en))
);
```

- `SELECT fsj.setup_tenant_table(...)` provides RLS ENABLE + FORCE, the `tenant_isolation` policy and the tenant_id trigger.
- Indexes:
  - `uq_libro_incidente_integridad_abierto` UNIQUE `(tenant_id, libro_id) WHERE resuelto_en IS NULL`. It also serves the badge query.
  - `libro_incidente_integridad_libro_idx` `(tenant_id, libro_id, detectado_en DESC)`. This is the non-partial FK index; the guard test would accept the partial one, but RI checks need full coverage.
- Grants: the defaults give SELECT and INSERT. Add `GRANT UPDATE (ultima_deteccion_en, detecciones, resuelto_en)`. Never grant DELETE; add the `fsj.forbid_delete()` trigger.
- Trigger `fsj.libro_incidente_validar()`, BEFORE INSERT OR UPDATE, raises `INV-L27` (next free; add its Spanish message to `shared/errors/mensajes-invariantes.ts`, as required by `mensajes-invariantes-global.test.ts`) when:
  - an INSERT has `resuelto_en` set;
  - an UPDATE touches a resolved row;
  - `detecciones` decreases.
- `fsj.plataforma_incidentes_integridad(p_token_hash text, p_tenant_ids uuid[], p_solo_abiertos boolean, p_limit integer)`:
  - SECURITY DEFINER, `SET search_path = fsj, extensions`; `v_actor := fsj.plataforma_actor(p_token_hash)` comes first (0125 pattern). The owner has BYPASSRLS (0119).
  - Returns `(id, tenant_id, libro_tipo, primer_quiebre_numero, detectado_en, ultima_deteccion_en, detecciones, resuelto_en)`, joined to `libro_rubricado` only for `tipo`.
  - Rows are ordered open first, then `detectado_en DESC`.
  - `cardinality(p_tenant_ids) <= 100` is enforced, and the limit is clamped to 1..200.
  - `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO fsj_app`.
- No Prisma model, following the precedent of `libro_reanclaje` and the platform tables, which are only reached through functions.

## File changes

| File | Action | Purpose |
|---|---|---|
| `prisma/migrations/20261111130000_0129_libro_incidente_integridad/migration.sql` | Create | Table, indexes, grants, triggers, both functions |
| `prisma/rollbacks/0129_libro_incidente_integridad.down.sql` | Create | Drop the two functions, the trigger function and the table |
| `modules/libro/domain/integridad.ts` | Modify | `VerificacionLibro` type |
| `modules/libro/application/resumen-integridad.ts` | Modify | D2 |
| `modules/libro/application/registrar-incidentes-integridad.ts` | Create | Command and fail-soft wrapper (D4, D5) |
| `modules/libro/infrastructure/incidente-integridad-repository.ts` | Create | `registrarVerificacionLibro(tx, libroId, quiebre)` |
| `app/(app)/layout.tsx` | Modify | Calls the wrapper after the banner value is set |
| `shared/labels/field-labels.ts` | Modify | `libros`, `quiebre` |
| `shared/errors/mensajes-invariantes.ts` | Modify | `INV-L27` |
| `modules/plataforma/domain/farmacia.ts` | Modify | `IncidenteIntegridad`, `FarmaciaListada.incidentesAbiertos` |
| `modules/plataforma/infrastructure/plataforma-repository.ts` | Modify | `incidentesIntegridad(tx, tokenHash, tenantIds, soloAbiertos, limit)` |
| `modules/plataforma/application/{listar,ver}-farmacia(s).ts` | Modify | Badge count and detail list (limit 50) |
| `modules/plataforma/ui/incidentes-integridad.tsx` | Create | Presentational section, uses `etiquetaLibro` |
| `app/(plataforma)/plataforma/page.tsx` | Modify | Danger `ToneBadge` "Integridad" in the Estado cell (`flex-wrap`), links to `#integridad` |
| `app/(plataforma)/plataforma/farmacias/[id]/page.tsx` | Modify | First panel of the main column, `id="integridad"`; an `<ol>` list (not a table) for 375px; a `field-help` note on the limitation |
| `docs/rollbacks/incidentes-integridad-plataforma.md` | Create | See Rollback |

## Testing (strict TDD for unit)

| Layer | What |
|---|---|
| Unit `tests/unit/resumen-integridad.test.ts` | Miss: `verificacion` lists all open libros, OK ones included. Hit: `verificacion` is `null` and `quebrados` is the same. `resumenIntegridad()` keeps its shape. Invalidation forces a miss. |
| Unit `tests/unit/registrar-incidentes-integridad.test.ts` | Permiso and audit-skip declaration. One repository call per libro. Output lists only `ABIERTO`. Wrapper: `error` with exactly the 4 keys. A throw becomes `warn` and resolves. A Next control-flow error is rethrown. A logger that throws does not propagate. |
| Unit `tests/unit/plataforma-usecases.test.ts` | Badge count mapping; detail includes incidents |
| DB `tests/db/libro-incidente-integridad.test.ts` | Each transition. A second open row fails on the partial unique index. fsj_app cannot DELETE, cannot UPDATE `libro_id`/number, cannot touch a resolved row. Another tenant sees nothing. The platform function raises `INV-PLAT-AUTH` on a bad token or a tenant token, returns only its columns, and filters `solo_abiertos`. PUBLIC has no EXECUTE. |
| DB `tests/db/catalogo-guardas.test.ts` | Passes unchanged |

## Rollback

1. Deploy code without the layout call and without the plataforma UI. The banner never depended on the table.
2. Apply the `.down.sql` as a new forward migration: `DROP FUNCTION fsj.plataforma_incidentes_integridad(...)`, `fsj.libro_incidente_registrar(...)`, `DROP TABLE fsj.libro_incidente_integridad` (policy, triggers, indexes go with it), `DROP FUNCTION fsj.libro_incidente_validar()`.
3. What is lost: the incident history. Export it as owner first if it is needed.

## Open questions

- [ ] Spec P18 lists the returned fields as "only libro tipo, número, dates, count, estado". The function also returns `id` and `tenant_id`: identifiers needed for row keys and for grouping the badge, not tenant content. Align the spec wording.
- [ ] `INV-L27`: confirm it is still free at implementation time.
- [ ] Testing true concurrency (two transactions) may not fit the rolled-back-transaction DB harness. If it does not, the advisory lock is covered by review only.

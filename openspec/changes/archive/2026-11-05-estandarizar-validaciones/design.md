# Design — Estandarizar validaciones de entrada

Proposal: `proposal.md`. Behavior: `specs/fechas-entrada/spec.md`, `specs/importacion-factura-compra/spec.md`
(deltas).

## Database

None: no migration, no `.down.sql`, no `docs/rollbacks/` entry. The factura's despacho / país de origen go into the
existing `partida.despacho_importacion` / `pais_origen` columns (migration 0062), which `importarFacturaCompra`
already writes.

## 1. One date validator (FE1)

The nearest existing pattern is `modules/stock/domain/ajustes-listado.ts#esFechaIso`: a pure calendar check that
pages use to drop a bad param and a use case wraps in zod. It is promoted to `shared/validation/index.ts`, next to
`uuid` and `nonEmptyString` (domain code may import `shared/validation`: the lint only bans `shared/db`,
Prisma, Next and `infrastructure/` from `domain/`):

- `esFechaIso(value: string): boolean`: `/^\d{4}-\d{2}-\d{2}$/` plus a UTC round trip (rejects `2026-02-30`,
  accepts `2028-02-29`).
- `fechaIso`: `z.string().trim()`, then shape (`"Debe ser una fecha en formato AAAA-MM-DD."`), then
  `.refine(esFechaIso, "Debe ser una fecha que exista en el calendario.")`. Output stays the `YYYY-MM-DD` string,
  so every query that casts `${x}::date` keeps working.
- `filtroFechaIso(value: string | undefined): string | undefined`: the FE2 page helper, `value` when
  `esFechaIso(value)`, else `undefined`.

**Replaced** (delete the local definition, import the shared one):

| Where | Today |
|---|---|
| `stock/domain/ajustes-listado.ts` `esFechaIso` | calendar check (moves to shared) |
| `stock/domain/partida.ts` `isoDate` (used by factura, existencia inicial, vencimiento) | shape only |
| `stock/application/list-ajustes.ts`, `list-partidas.ts` local `fechaIso` | calendar check, own message |
| `stock/application/kardex-movimientos.ts`, `reporte-kardex.ts` | bare regex, no message |
| `costos-proveedor/domain/costo-proveedor.ts` `esFechaIsoReal` (+ `importacion-lista.ts`) | calendar check |
| `recetas/application/crear-receta.ts` `isoDate` (+ `editar-receta.ts`, `importar-receta.ts`) | shape only |
| `recetas/application/list-recetas.ts`, `reporte-recetas.ts` | shape only |
| `directores-tecnicos/domain/designacion.ts` `isoDate` | shape only, on purpose (comment) |
| `entregas/application/imprimir-envios-pdf.ts`, `list-entregas-pendientes.ts` | calendar / shape |
| `auditoria/application/list-registro-auditoria.ts` | shape only |
| `preparaciones/application/list-preparaciones.ts`, `list-recetas-en-curso.ts`, `list-recetas-pendientes.ts` | shape only |
| `cierres/domain/filtros.ts`, `libro/domain/filtros.ts`, `archivo/domain/filtros.ts` `fechaIso` | shape only |
| `archivo/application/autorizar-destruccion.ts`, `registrar-destruccion.ts` | shape only |

`directores-tecnicos/domain/designacion.ts` says it relies on the `date` column to refuse an impossible date: that
reasoning is overridden by FE1 (the DB error is not a field error). Update that comment.

**Left alone**, on purpose:

- `shared/ui/date-input.tsx#isValidIso`: client component with its own year bounds; importing
  `shared/validation` would bundle zod and decimal.js into the client for one function.
- `auditoria/domain/presentacion.ts`, `recetas/domain/receta-rcta-json.ts`: they *parse* text (audit values, a
  QR's JSON), they do not validate input.
- `costos-proveedor/ui/costo-form.tsx`: a client-side comparison hint, not validation.

Messages change from "Debe tener el formato…" / "Ingresá una fecha…" to the two shared ones. No test asserts the
old texts today (checked with a search of `*.test.ts(x)`).

## 2. Listings drop an invalid date (FE2)

Every page that reads a date from `searchParams` passes it through `filtroFechaIso` **before** using it for the
query, the chips, the drawer's `defaultValue` and the pagination links. This is what `/partidas` and
`/stock/ajustes` already do; the rest differ:

| Page | Today with `?desde=2026-02-30` | Today with `?desde=abc` |
|---|---|---|
| `/auditoria`, `/reportes/kardex` (local `ISO_DATE_PATTERN`) | Postgres error | dropped |
| `/entregas` (`validIso`) | Postgres error | dropped |
| `/preparaciones` (`domain/listado.ts` `FECHA`) | Postgres error | dropped |
| `/cierres/historial`, `/cierres/reporte`, `/libro`, `/libro/contralor`, `/archivo`, `/archivo/nuevo`, `/reportes/recetas`, `/recetas` | raw param to the query | zod `ValidationError` (error page) |
| `/partidas`, `/stock/ajustes` | dropped | dropped |

The pages with their own parser (`preparaciones/domain/listado.ts`, `entregas`, `auditoria`, `kardex`) swap their
regex for `esFechaIso` / `filtroFechaIso`; the others wrap each date param in `filtroFechaIso`. The use cases still
validate with `fechaIso` (defense in depth: a caller that skips the page helper gets a `ValidationError`, never a
Postgres error). The "desde > hasta" handling of each page is untouched.

## 3. PDF receta import payload typed

`modules/recetas/ui/receta-form.tsx`: `function payloadImportacion(): ImportarRecetaWireInput | null`, with
`import type { ImportarRecetaWireInput } from "../application/importar-receta"` (type-only, erased from the client
bundle; `ui/` importing its own module's `application/` is allowed). A field that sends `null` where the schema
takes `string | undefined` becomes a typecheck error. `opcional()` stays: it is still how `string | null` from the
borrador becomes `undefined`. The action keeps `JSON.parse` (the value is re-validated by zod on the server).

## 4. One optional-text helper (médico, usuario)

`shared/validation/index.ts`:

```ts
/** Optional free text: trimmed; "", null and undefined all become null. */
export function textoOpcional(max?: number) { ... } // z.string().trim()(.max(max)).nullish().transform(v => v ? v : null)
```

- `medicos/application/crear-medico.ts`: `especialidad`, `telefono`, `direccionRegistrada` → `textoOpcional()`.
- `medicos/application/editar-medico.ts`: delete the local `optionalField`, use `textoOpcional()`.
- `usuarios/application/crear-usuario.ts`, `editar-usuario.ts`: `numeroMatricula: textoOpcional(100)`. The handlers'
  `input.numeroMatricula ?? null` keeps working (the value is already `string | null`). The actions'
  `.trim() || undefined` can stay; the schema no longer depends on it.

Side effect, intended: `crearMedicoInput` now accepts `null` (wire type `string | null | undefined`), so the PDF
import's médico no longer breaks on a stray `null`. Out of scope: the other modules' own `textoOpcional` copies
(pacientes, stock, recetas) — same behavior, migrate them when those modules are touched.

## 5. Factura manual: despacho and país (FC1, FC2)

Only `modules/stock/ui/importar-factura-form.tsx` changes. `loteManual()` already carries `despacho: null` /
`paisOrigen: null`, and the payload already sends `despachoImportacion: l.despacho` / `paisOrigen: l.paisOrigen`.

- In the manual branch of each lote (`manual ? (...)`), add two optional text inputs, "Despacho de importación" and
  "País de origen", `maxLength={200}`, named `lineas.<i>.despachoImportacion` / `lineas.<i>.paisOrigen` (the
  form's `lineas.<i>.<campo>` convention, so `importarFacturaCompra`'s field errors mark them), bound to
  `l.despacho` / `l.paisOrigen` (empty input → `null`).
- PDF branch unchanged: the values stay read-only text under the lote.
- `reiniciar()` after a successful manual import already rebuilds the lotes with `loteManual()`, so the fields
  reset; on error they keep what was typed (`use-form-submit`).

## 6. Clean Postgres (docs only)

`docs/deploy.md` §4, a new step 0 before `npm run db:migrate`, only for a Postgres that is NOT Supabase:

```sql
CREATE SCHEMA IF NOT EXISTS extensions;                                   -- migration 0000
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOLOGIN;                                    -- migration 0108
  END IF;
END $$;
```

With the reason: 0000 installs extensions `WITH SCHEMA extensions` and 0108 runs `ALTER ROLE authenticator`; both
exist only on Supabase. Applied migrations are not edited (Prisma checksums), and a new migration cannot help
because 0108 runs before it on a fresh database. Not verified against a real clean Postgres: say so in the doc.

## Tests

Unit (`npm test`), written with each piece:

- `shared/validation`: `esFechaIso` / `fechaIso` / `filtroFechaIso` with the FE1 scenarios (`2026-02-28`,
  `2028-02-29`, `2026-02-29`, `2026-02-30`, `2026-13-01`, `05/11/2026`, `undefined`); `textoOpcional` with `""`,
  `"  "`, `null`, `undefined`, text, over-max.
- `preparaciones/domain/listado.ts`: `?desde=2026-02-30&hasta=2026-03-10` keeps only `hasta` (FE2).
- Move the `esFechaIso` cases of `tests/unit/stock-ajustes-listado.test.ts` to the shared function's test and
  update its import; the rest of that file (parsing, ranges) stays.
- `crearMedicoInput` accepts `null` in the optional fields.

Not covered by unit tests: the pages' wiring (no page tests in this repo) and the factura form's new inputs; both
are checked by typecheck and in the browser if the task asks for it.

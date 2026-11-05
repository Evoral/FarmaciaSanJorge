# Tasks

Design: `design.md`. Behavior: `specs/fechas-entrada/spec.md`, `specs/importacion-factura-compra/spec.md` (deltas).

## Review Workload Forecast

- Estimated changed lines: ~350 (about 25 small edits in modules, 13 pages, ~60 lines of shared helpers, ~100 of
  tests, ~40 in the factura form, ~20 of docs).
- 400-line budget risk: Low–Medium (the table of replaced validators is wide but each edit is a few lines).
- Chained PRs recommended: No. Each section below is one work-unit commit, in this order.
- Decision needed before apply: No.

## 1. Shared validators (FE1)

- [x] 1.1 `shared/validation/index.ts`: add `esFechaIso`, `fechaIso` (shape message, then calendar message) and `filtroFechaIso`
- [x] 1.2 `shared/validation/index.ts`: add `textoOpcional(max?)` (`""` / `null` / `undefined` → `null`)
- [x] 1.3 Unit tests for the four helpers with the FE1 cases (`2026-02-28`, `2028-02-29`, `2026-02-29`, `2026-02-30`, `2026-13-01`, `05/11/2026`, `undefined`) and the `textoOpcional` cases (`""`, `"  "`, `null`, `undefined`, text, over-max)
- [x] 1.4 `tests/unit/stock-ajustes-listado.test.ts`: move its `esFechaIso` cases to the new test; keep parsing and range cases

## 2. Use cases use the shared date (FE1, FE3)

- [x] 2.1 `stock`: `domain/partida.ts` `isoDate`, `domain/ajustes-listado.ts` `esFechaIso`, `application/list-ajustes.ts`, `list-partidas.ts`, `kardex-movimientos.ts`, `reporte-kardex.ts`; fix their importers (`importar-factura-compra.ts`, `ingresar-existencia-inicial.ts`, `ingresar-partida.ts`, `domain/vencimiento-partida.ts`, `app/(app)/partidas/page.tsx`)
- [x] 2.2 `costos-proveedor`: replace `esFechaIsoReal` in `domain/costo-proveedor.ts` and `domain/importacion-lista.ts` (keep their own messages if they are field-specific)
- [x] 2.3 `recetas`: `application/crear-receta.ts` `isoDate` (+ `editar-receta.ts`, `importar-receta.ts`), `list-recetas.ts`, `reporte-recetas.ts`
- [x] 2.4 `directores-tecnicos/domain/designacion.ts`: use `fechaIso`; rewrite the "deliberately just a shape check" comment (FE1 decision, 2026-11-04)
- [x] 2.5 `entregas` (`imprimir-envios-pdf.ts`, `list-entregas-pendientes.ts`), `auditoria` (`list-registro-auditoria.ts`), `preparaciones` (`list-preparaciones.ts`, `list-recetas-en-curso.ts`, `list-recetas-pendientes.ts`)
- [x] 2.6 `cierres`, `libro`, `archivo` `domain/filtros.ts` `fechaIso`; `archivo/application/autorizar-destruccion.ts`, `registrar-destruccion.ts`
- [x] 2.7 Search check: no `\d{4}-\d{2}-\d{2}` regex left in `modules/**/application` or `modules/**/domain` except the parsers the design leaves alone (`auditoria/domain/presentacion.ts`, `recetas/domain/receta-rcta-json.ts`)

## 3. Listings drop an invalid date (FE2)

- [x] 3.1 Pages with their own parser: `preparaciones/domain/listado.ts` (`FECHA`), `app/(app)/entregas/page.tsx` (`validIso`), `app/(app)/auditoria/page.tsx` and `app/(app)/reportes/kardex/page.tsx` (`ISO_DATE_PATTERN`) → `filtroFechaIso`
- [x] 3.2 Pages passing the raw param: `cierres/historial`, `cierres/reporte`, `libro`, `libro/contralor`, `archivo`, `archivo/nuevo`, `reportes/recetas`, `recetas` → read each date once through `filtroFechaIso` and use that value for the query, chips, drawer `defaultValue` and pagination links
- [x] 3.3 Unit test: `parsearFiltrosPreparaciones({ desde: "2026-02-30", hasta: "2026-03-10" })` keeps only `hasta`
- [x] 3.4 Leave each page's "desde > hasta" handling as it is

## 4. Médico and usuario optional text

- [x] 4.1 `medicos/application/crear-medico.ts` and `editar-medico.ts` (drop the local `optionalField`) → `textoOpcional()`
- [x] 4.2 `usuarios/application/crear-usuario.ts` and `editar-usuario.ts`: `numeroMatricula: textoOpcional(100)`
- [x] 4.3 Unit test: `crearMedicoInput` accepts `null` and `""` in `especialidad`, `telefono`, `direccionRegistrada` and stores `null`

## 5. PDF receta import payload typed

- [x] 5.1 `modules/recetas/ui/receta-form.tsx`: `payloadImportacion(): ImportarRecetaWireInput | null` with a type-only import from `../application/importar-receta`; fix any typecheck error it reveals

## 6. Factura manual: despacho and país (FC1, FC2)

- [x] 6.1 `modules/stock/ui/importar-factura-form.tsx`, manual branch of each lote: "Despacho de importación" and "País de origen" inputs, optional, `maxLength={200}`, named `lineas.<i>.despachoImportacion` / `lineas.<i>.paisOrigen`, empty → `null`
- [x] 6.2 PDF branch unchanged (read-only text under the lote)

## 7. Docs

- [x] 7.1 `docs/deploy.md` §4: step 0 for a Postgres that is not Supabase (`CREATE SCHEMA IF NOT EXISTS extensions`, `authenticator NOLOGIN` if missing), with the reason (0000, 0108) and "not verified on a clean Postgres"

## 8. Verify

- [x] 8.1 `npm run typecheck`, `npm run lint`, `npm test` (CI is the gate; state what was not run)
- [x] 8.2 Manual (only if asked): `/preparaciones?desde=2026-02-30`, `/cierres/historial?fechaDesde=abc` show the listing without that filter; a factura manual stores despacho and país
  - Done 2026-11-05 on the dev server (test tenant), after the merge with origin. No error page, console or server error on `/preparaciones` (incl. `prescripcionDesde=2026-02-30`, `ingresoHasta=2026-13-01`), `/cierres/historial`, `/libro`, `/recetas`, `/auditoria`: the invalid date is dropped, the valid one keeps its chip. Factura manual B 9999-51105001 (Magel SA, lote `PRUEBA-DESPACHO-1`): the audit entry of the partida shows despacho `24001IC04123456X` and país `Alemania`; the form reset afterwards. Fields fit at 375 px. Not checked: the 201-character error (the input's `maxLength` stops it in the browser).

## 9. Archive

- [x] 9.1 Create `openspec/specs/fechas-entrada/spec.md` and `openspec/specs/importacion-factura-compra/spec.md` from the deltas, each with `## Purpose` and `## Code`
- [x] 9.2 Move the change to `openspec/changes/archive/YYYY-MM-DD-estandarizar-validaciones/`

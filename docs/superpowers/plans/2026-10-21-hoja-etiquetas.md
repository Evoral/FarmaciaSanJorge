# Etiquetas sobre hoja — implementation plan

**Goal:** the etiqueta PDF becomes the whole sheet, with the etiqueta drawn in a cell
(columna, fila) the user picks; the administrator configures one sheet per farmacia.

**Architecture:** new tenant table `fsj.etiqueta_hoja` (migration 0096) owned by
`modules/etiqueta-tamanos`; pure grid maths in `domain/etiqueta-hoja.ts` (tenths of a mm,
integers); the sheet<->size fit is enforced in the use cases; `buildEtiquetaPdf` takes
`(contenido, tamano, hoja, celda)`; a `PosicionEnHoja` radio-grid component is shared by
both print dialogs.

**Spec:** `docs/specs/hoja-etiquetas.md` (R1–R13).

## Task 1 — Data model + pure domain

- Files: `prisma/migrations/20261021120000_0096_etiqueta_hoja/migration.sql`,
  `prisma/rollbacks/0096_etiqueta_hoja.down.sql`, `docs/rollbacks/hoja-etiquetas.md`,
  `prisma/schema.prisma` (`EtiquetaHoja`), `modules/etiqueta-tamanos/domain/etiqueta-hoja.ts`,
  `shared/labels/field-labels.ts` (`margenMm`), `modules/auditoria/domain/presentacion.ts`
  (`etiqueta_hoja`), `tests/db/etiqueta-tamano.test.ts` (sheet table).
- Interfaces (domain): `HojaEtiqueta {anchoMm, altoMm, margenMm}`, `HOJA_PREDETERMINADA`,
  `grillaHoja(hoja, tamano): Grilla {columnas, filas}`, `entraEnHoja`, `camposQueNoEntran`,
  `posicionCelda(hoja, tamano, columna, fila): {xMm, yMm}`, `celdaValida(grilla, c, f)`,
  `siguienteCelda(grilla, c, f)`, `tamanosQueNoEntran(hoja, tamanos)`,
  `areaUtilSuficiente(hoja)`, `formatearHoja`, `formatearCapacidad`.
- Tests: `tests/unit/etiqueta-hoja.test.ts` (exact fits, near-misses, margin 0, landscape,
  bounds, limits, formatting).

## Task 2 — Sheet use cases + fit checks + admin

- Files: `infrastructure/etiqueta-hoja-repository.ts`, `application/get-etiqueta-hoja.ts`
  (`config.ver`), `get-hoja-para-imprimir.ts` (`etiquetas.imprimir`),
  `editar-etiqueta-hoja.ts` (command, audited), fit checks in `crear/editar/reactivar`,
  `list-tamanos-para-imprimir.ts` (only sizes that fit), `medida-mm.ts` (range factory),
  `ui/actions.ts` + `ui/etiqueta-hoja-form.tsx`, admin pages, `scripts/create-tenant.ts`.
- Interfaces: `getEtiquetaHoja(): Promise<HojaEtiqueta>`, `getHojaParaImprimir()`,
  `editarEtiquetaHoja({anchoMm, altoMm, margenMm})`, repo `getHoja(tx, tenantId)` (A4 / 5 mm
  fallback), `upsertHoja(tx, tenantId, hoja)`, `lockHoja`.
- Tests: validation schema + limits, fit rejection (crear/editar/reactivar/hoja edit with
  mocked repository), authorization matrix rows, DB test for the table.

## Task 3 — PDF placement, use case, route

- Files: `modules/preparaciones/infrastructure/etiqueta-pdf.ts`
  (`buildEtiquetaPdf(contenido, tamano, hoja, celda)`),
  `application/imprimir-etiqueta-pdf.ts` (`imprimirEtiquetaPdf(id, {tamanoId?, columna?, fila?})`),
  `domain/etiqueta.ts#hrefEtiquetaPdf(id, tamanoId, columna, fila)`, the route.
- Resolution order BEFORE `marcarEtiquetaImpresa`: sheet, size (explicit or first that fits),
  cell (`celdaValida` else `ValidationError`).
- Tests: extend `preparaciones-imprimir-etiqueta-pdf.test.ts` (page = sheet, cell lands where
  `posicionCelda` says, out-of-grid does not mark impresa, default size / cell),
  `preparaciones-etiqueta.test.ts` (href).

## Task 4 — Position picker + dialogs + pages

- Files: `modules/preparaciones/ui/posicion-en-hoja.tsx` (radio group, arrow keys),
  `imprimir-etiqueta-dialog.tsx` (both dialogs, R8–R11), `etiqueta-para-imprimir.tsx`,
  `reserva-acciones.tsx`, the three pages that render them.
- Interfaces: `PosicionEnHoja({hoja, tamano, columna, fila, onChange})`;
  dialogs get `hoja: HojaEtiqueta`; the R11 "next cell" rule is the pure
  `siguienteCelda` (unit-tested).

## Task 5 — Docs

- `docs/specs/etiqueta-preparado.md` (one line), `etiqueta-tamano.ts` header, admin copy,
  spec status line.

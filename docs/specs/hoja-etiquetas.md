# Etiquetas sobre hoja (posición en la hoja)

Status: implemented (2026-10-21), migration 0096 pending to apply (see Rollout). Plan: `docs/superpowers/plans/2026-10-21-hoja-etiquetas.md`.
Builds on `docs/specs/etiqueta-preparado.md` (the label layout, unchanged) and
migration 0066 (`fsj.etiqueta_tamano`, the configured label sizes).

## Why

The farmacia prints every etiqueta on plain A4 sheets and cuts them out by hand.
Today the PDF page IS the label (e.g. 100 × 42 mm), so the printer always drops it
at the sheet's origin: column 1, row 1. They print one etiqueta at a time but want
to fill a sheet over time, feeding the same sheet back and printing the next
etiqueta in the next free spot (e.g. column 3, row 2).

From now on the PDF is the whole sheet, with the etiqueta drawn in the cell the
user picks. How many etiquetas fit is computed from the sheet, its margin and the
chosen label size.

## Goals

- The administrator configures the sheet once per farmacia (size + margin).
- When printing, the user picks the label size and a cell (column, row) in a grid
  of the cells that fit; the PDF is the sheet with the etiqueta in that cell.
- Same picker in both print dialogs: "Imprimir etiqueta" / "Reimprimir"
  (Preparaciones, `?estado=CONFIRMADA` and the preparación screen) and the toma's
  "Imprimir etiquetas" (one row per confirmed ítem).

## Non-goals

- No memory of used cells. Nothing is persisted about positions; every print the
  user picks the cell (the farmacia confirmed this, 2026-10-21).
- No pre-cut (die-cut) label sheets: no factory gaps or offsets to configure.
- No roll / label-printer mode. The old "page = label size" output goes away
  entirely: every etiqueta prints on the sheet (confirmed 2026-10-21).
- No multi-etiqueta PDF (several etiquetas on one sheet in a single print).
- No change to WHAT is printed: the `etiqueta.contenido` snapshot, its parsing,
  "marcar impresa" and its (lack of) audit are untouched.

## Anti-goals

- The grid drifting from the printed result. A cell's position in the PDF must be
  exact in millimetres; anything that adds a silent offset is a bug.
- Losing the configured sizes: existing `etiqueta_tamano` rows keep working, now
  as the label size inside the sheet.

## Rules

| # | Rule | Code (planned) |
|---|---|---|
| R1 | Each farmacia has exactly ONE sheet configuration: `ancho_mm`, `alto_mm`, `margen_mm`. Default (seeded for every existing tenant and by `scripts/create-tenant.ts`): A4 portrait, 210 × 297 mm, margin 5 mm. Landscape is just ancho > alto. | `fsj.etiqueta_hoja` (migration 0096), `modules/etiqueta-tamanos` |
| R2 | Limits: ancho / alto 50–500 mm; margen 0–30 mm; one decimal each (es-AR comma input, same as the sizes' `medida-mm.ts`). The usable area must be at least the smallest possible size (10 mm) each way: `ancho − 2·margen ≥ 10` and `alto − 2·margen ≥ 10`, else a field error on `margen`. | `domain/etiqueta-hoja.ts`, DB `CHECK`s |
| R3 | Grid: `columnas = floor((ancho_hoja − 2·margen) / ancho_etiqueta)`, `filas = floor((alto_hoja − 2·margen) / alto_etiqueta)`. Computed in tenths of a millimetre as integers (measures are `numeric(…,1)`), never with float division, so an exact fit (200 / 100 = 2) never rounds down. | `grillaHoja(hoja, tamano)` |
| R4 | Cell (columna c, fila f), both 1-based, reading order left→right, top→bottom. Its top-left corner is `(margen + (c−1)·ancho_etiqueta, margen + (f−1)·alto_etiqueta)`. The grid is anchored at the top-left margin; leftover space goes to the right and bottom. Cells touch (no gap): the etiqueta's own rounded border is the cutting guide. | `posicionCelda` |
| R5 | A label size must fit the sheet at least once (`columnas ≥ 1` and `filas ≥ 1`). Creating, editing or reactivating a size that does not fit is rejected with a field error. Editing the sheet so that an ACTIVE size no longer fits is rejected, naming the sizes that would not fit. A size that already exists and does not fit (e.g. wider than 200 mm under the seeded A4 / 5 mm) is left as is by the migration: the admin list marks it "No entra en la hoja", the print dialogs do not offer it, and it can be edited to fit or deactivated. If no active size fits, the dialogs show the existing "no sizes" warning (`SinTamanos`). | `crear/editar/reactivar-etiqueta-tamano.ts`, `editar-etiqueta-hoja.ts` |
| R6 | The PDF page is the sheet (`ancho_mm × alto_mm`, margin 0 in pdfkit). The etiqueta is drawn inside its cell exactly as today inside its page: the fixed 100 × 42 mm design scaled uniformly and centered in the cell. The rest of the sheet is blank. Still exactly one page. | `buildEtiquetaPdf` |
| R7 | The PDF route takes `?tamano=<id>&columna=<n>&fila=<n>`. Missing `columna`/`fila` (old links) → 1/1. Missing `tamano` (old links) → the first active size that fits the sheet, in the admin list's order; none → `NOT_FOUND` (the hardcoded 100 × 42 fallback goes away, since it may not fit an edited sheet). A non-integer or out-of-grid cell is `VALIDATION_ERROR` (400) and, like an unknown size, is resolved BEFORE marking the etiqueta impresa. | `app/api/preparaciones/[id]/etiqueta/pdf/route.ts`, `imprimirEtiquetaPdf`, `hrefEtiquetaPdf` |
| R8 | Print dialog: the size select, then a clickable grid drawn in the sheet's proportions with one cell per position that fits, the summary "N columnas × M filas · K etiquetas por hoja" and the chosen position as text ("Columna 3, fila 2"). Default selection: column 1, row 1. Changing the size keeps the chosen cell if it still fits, else falls back to 1/1. | `modules/preparaciones/ui/` (new `PosicionEnHoja` component) |
| R9 | The grid is an accessible radio group: each cell is a radio labelled "Columna c, fila f", arrow keys move the selection, the selected cell is visibly filled. | same |
| R10 | Both dialogs warn: "Imprimí en tamaño real (100 %). Si la impresión se ajusta a la página, la etiqueta se corre." (a browser's "fit to page" shifts the grid). | same |
| R11 | Toma dialog ("Imprimir etiquetas"): each ítem row has its size and its position (same grid component). Inside the OPEN dialog only, once an ítem is printed (= its "Imprimir" was clicked; the browser can not report the real print), every row the user has not touched yet and that has the SAME size defaults to the next cell in reading order after the last printed one (wrapping to 1/1 after the last cell). A row with another size keeps 1/1: positions of different grids are not comparable. Closing the dialog forgets it (nothing persisted, see Non-goals). | `SeleccionarEtiquetasDialog` |
| R12 | Admin, Configuración → Etiquetas: a "Hoja de impresión" panel above the sizes list shows the sheet ("A4 vertical — 210 × 297 mm, margen 5 mm") and, with `config.editar`, edits it (form keeps input on error, `use-form-submit`). The sizes list shows, per size, how many fit: "2 × 6 = 12 por hoja". Page copy stops saying the design is scaled to the chosen page. | `app/(app)/admin/configuracion/etiquetas/page.tsx`, `modules/etiqueta-tamanos/ui/` |
| R13 | Editing the sheet is a `defineCommand` (`config.editar`), audited like the sizes (before / after values of the three measures). Two reads, mirroring the sizes: `get-etiqueta-hoja.ts` (`config.ver`, admin page) and `get-hoja-para-imprimir.ts` (`etiquetas.imprimir`, print dialogs and PDF). | `modules/etiqueta-tamanos/application/` |

## Data model (migration 0096 — re-check numbering before applying)

`fsj.etiqueta_hoja`, one row per tenant:

- `tenant_id uuid PRIMARY KEY` (also the tenancy key), `ancho_mm`, `alto_mm`,
  `margen_mm` as `numeric(4,1)`, `updated_at timestamptz`.
- `CHECK`s mirroring R2.
- `fsj.setup_tenant_table` (RLS + tenant isolation + forbid tenant_id change).
- Grants: SELECT/INSERT by default privileges; UPDATE only on
  `ancho_mm, alto_mm, margen_mm, updated_at`.
- Seed: one 210 / 297 / 5 row per existing tenant (`ON CONFLICT DO NOTHING`).
- Rollback: `prisma/rollbacks/0096_etiqueta_hoja.down.sql` + `docs/rollbacks/hoja-etiquetas.md`.

The sheet<->size fit (R5) is enforced in the use cases, not in SQL: it spans two
tables and both sides are edited only through those use cases.

Code fallback: if a tenant somehow has no row, reads return the default A4 / 5 mm
(same defensive discipline as `list-parametros.ts`), and the first edit inserts it.

Why a dedicated table and not `fsj.parametro`: parametros are single decimal keys
edited one at a time on the Parámetros screen; the sheet is three values validated
together and against the sizes, edited on the Etiquetas screen. (Implementer's call,
recorded here.)

## Code touched

- `modules/etiqueta-tamanos/domain/`: new `etiqueta-hoja.ts` (types, limits,
  `grillaHoja`, `posicionCelda`, `celdaValida`, `tamanosQueNoEntran`, formatting
  "A4 vertical" when 210 × 297 / "A4 horizontal" when 297 × 210, else the measures).
  Header comment of `etiqueta-tamano.ts` updated (a size is the label inside the sheet).
- `modules/etiqueta-tamanos/{application,infrastructure,ui}`: get/editar sheet,
  repository functions, the admin panel/form; fit checks added to crear / editar /
  reactivar size.
- `modules/preparaciones/infrastructure/etiqueta-pdf.ts`: page = sheet, translate
  to the cell (R6). Header comment updated.
- `modules/preparaciones/application/imprimir-etiqueta-pdf.ts`: resolves size,
  sheet and cell before `marcarEtiquetaImpresa`.
- `modules/preparaciones/domain/etiqueta.ts#hrefEtiquetaPdf`: adds columna / fila.
- `modules/preparaciones/ui/imprimir-etiqueta-dialog.tsx`: both dialogs get the
  sheet as a prop and the position picker; every page that renders them passes it
  (find with `rg ImprimirEtiquetaDialog|SeleccionarEtiquetasDialog`).
- `scripts/create-tenant.ts`: seeds the sheet row.
- `docs/specs/etiqueta-preparado.md`: one line pointing here for placement.

## Tests

- Unit (domain): `grillaHoja` exact fits and near-misses (200 / 100 = 2;
  3 × 66,7 = 200,1 > 200 → 2; margin 0; landscape), `posicionCelda`, `celdaValida`
  bounds, `tamanosQueNoEntran`, sheet limits.
- Unit (PDF): page size is the sheet; the etiqueta lands in the chosen cell
  (extend `tests/unit/preparaciones-imprimir-etiqueta-pdf.test.ts`).
- Unit (use case): an out-of-grid cell is rejected and does NOT mark impresa.
- DB (`FSJ_DB_TESTS=yes`): sheet row RLS / grants / seed; fit checks on size and
  sheet edits (extend `tests/db/etiqueta-tamano.test.ts`).
- Authorization matrix: the new query and command (extend
  `tests/unit/etiqueta-tamanos-authorization-matrix.test.ts`).

## Rollout

Apply migration 0096 before deploying the code. Existing tenants get A4 / 5 mm, so
the first print after deploy already lands on the sheet at column 1, row 1 —
the same physical spot as today. Before applying, list the active sizes wider than
200 mm or taller than 287 mm: those stop being offered until edited (R5).

The PDF page's width × height already declares the orientation; nothing else is
forced. One sheet per farmacia is enough (they only print etiquetas on A4).

## Calls made without explicit confirmation (veto any)

1. Default margin 5 mm (most printers cannot print the outer few mm).
2. Cells touch, no gap; the label's own border is the cutting guide.
3. Grid anchored top-left at the margin, not centered on the sheet.
4. No rotation of the etiqueta to fit more per sheet.
5. Dedicated `fsj.etiqueta_hoja` table instead of `fsj.parametro` keys.
6. R11: inside the open toma dialog, the next untouched ítem defaults to the next
   cell after the last printed one (not persisted).
7. Editing the sheet is rejected while an active size would stop fitting (instead
   of silently hiding that size from the print dialog).
8. Existing sizes that do not fit the seeded sheet are left alone, marked in admin
   and not offered when printing (R5).
9. R11 carries the next cell only between rows of the same size.
10. A link without `tamano` uses the first active size that fits, not a hardcoded
    100 × 42 (R7).

## Decisions taken while implementing

Not pinned by the rules above; veto any.

1. Editing the sheet is rejected only for the active sizes that fit the CURRENT sheet and would stop fitting (R5). A size that already does not fit (e.g. wider than 200 mm after migration 0096) does not block the edit, or the administrator could never enlarge the sheet while it exists.
2. Editing a size is checked against the sheet whether the size is active or not; reactivating one that does not fit is a plain domain error (the reactivation form has only the motivo, so there is no field to mark).
3. A link that names a size that exists but does not fit the sheet is a `VALIDATION_ERROR`, resolved before marking impresa (R7).
4. The size commands hold the sheet row `FOR SHARE` and the sheet edit holds it `FOR UPDATE` (see `etiqueta-hoja-repository.ts`), so a size created while the sheet is edited can not slip past the fit check.
5. `fsj.etiqueta_hoja` has no surrogate id: the audit row uses the tenant id as `entidadId` (same as `parametro`), entity `etiqueta_hoja`.
6. R11: a row counts as "touched" once the user picks a cell in it; printing freezes the printed cell on its row.

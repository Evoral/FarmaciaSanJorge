# Etiquetas sobre hoja (posición en la hoja)

## Purpose

The farmacia prints every etiqueta on plain A4 sheets and cuts them out by hand.
Today the PDF page IS the label (e.g. 100 × 42 mm), so the printer always drops it
at the sheet's origin: column 1, row 1. They print one etiqueta at a time but want
to fill a sheet over time, feeding the same sheet back and printing the next
etiqueta in the next free spot (e.g. column 3, row 2).

From now on the PDF is the whole sheet, with the etiqueta drawn in the cell the
user picks. How many etiquetas fit is computed from the sheet, its margin and the
chosen label size.

Implemented 2026-10-21 (migration 0096); the farmacia confirmed the no-memory and sheet-only choices on
2026-10-21. See `## Status`.

## Requirements

### Requirement: Same picker in both print dialogs

The same position picker SHALL be in both print dialogs: "Imprimir etiqueta" / "Reimprimir" (Preparaciones,
`?estado=CONFIRMADA` and the preparación screen) and the toma's "Imprimir etiquetas" (one row per confirmed ítem).

#### Scenario: Reimprimir from Preparaciones

- **WHEN** the user opens "Reimprimir" in Preparaciones `?estado=CONFIRMADA`
- **THEN** the dialog has the size select and the position picker

#### Scenario: Toma dialog

- **WHEN** the user opens the toma's "Imprimir etiquetas"
- **THEN** each row has the same position picker

### Requirement: No memory of used cells

Nothing SHALL be persisted about positions: no memory of used cells; every print the user picks the cell (the
farmacia confirmed this, 2026-10-21).

#### Scenario: Next print

- **GIVEN** an etiqueta printed in column 2, row 1
- **WHEN** the user opens a print dialog again
- **THEN** no used cell is remembered and the user picks the cell

### Requirement: No pre-cut sheets

The sheet configuration SHALL NOT have factory gaps or offsets to configure: no pre-cut (die-cut) label sheets.

#### Scenario: Sheet form

- **WHEN** the administrator edits the sheet
- **THEN** only ancho, alto and margen can be set

### Requirement: Every etiqueta prints on the sheet

There SHALL be no roll / label-printer mode. The old "page = label size" output goes away entirely: every etiqueta
prints on the sheet (confirmed 2026-10-21).

#### Scenario: Any print

- **WHEN** any etiqueta is printed
- **THEN** the PDF page is the sheet, not the label size

### Requirement: What is printed is unchanged

The sheet SHALL change no part of WHAT is printed: the `etiqueta.contenido` snapshot, its parsing, "marcar impresa"
and its (lack of) audit are untouched.

#### Scenario: Etiqueta printed in a cell

- **WHEN** an etiqueta is printed in a chosen cell
- **THEN** its content is the `etiqueta.contenido` snapshot as before, it is marked impresa as before and no audit is added

### Requirement: Exact cell position

A cell's position in the PDF MUST be exact in millimetres; anything that adds a silent offset is a bug (the grid
drifting from the printed result is an anti-goal).

#### Scenario: Cell printed

- **WHEN** an etiqueta is printed in a cell
- **THEN** it lands at the cell's R4 position in millimetres, with no added offset

### Requirement: Existing sizes keep working

Existing `etiqueta_tamano` rows SHALL keep working, now as the label size inside the sheet (losing the configured
sizes is an anti-goal).

#### Scenario: Size configured before the sheet

- **GIVEN** a 100 × 42 mm size configured before the sheet existed
- **WHEN** the user prints with it
- **THEN** it is the label size inside the sheet

### Requirement: R1 — One sheet per farmacia

Each farmacia SHALL have exactly ONE sheet configuration: `ancho_mm`, `alto_mm`, `margen_mm`. Default (seeded for
every existing tenant and by `scripts/create-tenant.ts`): A4 portrait, 210 × 297 mm, margin 5 mm (most printers
cannot print the outer few mm). Landscape is just ancho > alto.

#### Scenario: New tenant

- **WHEN** a tenant is created with `scripts/create-tenant.ts`
- **THEN** its sheet is 210 × 297 mm with margin 5 mm

#### Scenario: Landscape

- **WHEN** the administrator sets ancho 297 and alto 210
- **THEN** the sheet is landscape

### Requirement: Missing sheet row

If a tenant somehow has no sheet row, reads SHALL return the default A4 / 5 mm (same defensive discipline as
`list-parametros.ts`), and the first edit inserts it.

#### Scenario: Tenant without a row

- **GIVEN** a tenant without a `fsj.etiqueta_hoja` row
- **WHEN** the sheet is read
- **THEN** it is A4 210 × 297 mm, margin 5 mm

#### Scenario: First edit

- **GIVEN** a tenant without a `fsj.etiqueta_hoja` row
- **WHEN** the administrator saves the sheet
- **THEN** the row is inserted

### Requirement: R2 — Sheet limits

Limits SHALL be: ancho / alto 50–500 mm; margen 0–30 mm; one decimal each (es-AR comma input, same as the sizes'
`medida-mm.ts`). The usable area must be at least the smallest possible size (10 mm) each way: `ancho − 2·margen ≥
10` and `alto − 2·margen ≥ 10`, else a field error on `margen`.

#### Scenario: Ancho below the limit

- **WHEN** the administrator saves ancho 49,9 mm
- **THEN** it is refused

#### Scenario: Usable area exactly 10 mm

- **WHEN** the administrator saves ancho 50 mm, alto 297 mm and margen 20 mm
- **THEN** it is accepted (50 − 2·20 = 10)

#### Scenario: Usable area below 10 mm

- **WHEN** the administrator saves ancho 50 mm, alto 297 mm and margen 20,1 mm
- **THEN** it is refused with a field error on `margen` (50 − 2·20,1 = 9,8)

#### Scenario: Comma input

- **WHEN** the administrator types margen "5,5"
- **THEN** it is read as 5.5 mm

### Requirement: R3 — Grid

The grid SHALL be `columnas = floor((ancho_hoja − 2·margen) / ancho_etiqueta)`, `filas = floor((alto_hoja −
2·margen) / alto_etiqueta)`. Computed in tenths of a millimetre as integers (measures are `numeric(…,1)`), never
with float division, so an exact fit (200 / 100 = 2) never rounds down.

#### Scenario: Exact fit

- **GIVEN** a usable width of 200 mm
- **WHEN** the label is 100 mm wide
- **THEN** columnas = 2

#### Scenario: Near miss

- **GIVEN** a usable width of 200 mm
- **WHEN** the label is 66,7 mm wide
- **THEN** columnas = 2 (3 × 66,7 = 200,1 > 200)

#### Scenario: Seeded A4 with a 100 × 42 size

- **GIVEN** the sheet 210 × 297 mm, margin 5 mm
- **WHEN** the size is 100 × 42 mm
- **THEN** columnas = floor(200 / 100) = 2 and filas = floor(287 / 42) = 6

### Requirement: R4 — Cell position

A cell (columna c, fila f) SHALL be 1-based, reading order left→right, top→bottom. Its top-left corner is `(margen
+ (c−1)·ancho_etiqueta, margen + (f−1)·alto_etiqueta)`. The grid is anchored at the top-left margin, not centered on
the sheet; leftover space goes to the right and bottom. Cells touch (no gap): the etiqueta's own rounded border is
the cutting guide.

#### Scenario: Column 3, row 2

- **GIVEN** the sheet 210 × 297 mm, margin 5 mm, and a 60 × 40 mm size
- **WHEN** the user picks column 3, row 2
- **THEN** the etiqueta's top-left corner is at (5 + 2·60, 5 + 1·40) = (125, 45) mm
- **AND** the leftover 20 mm to the right and 7 mm at the bottom stay blank

#### Scenario: Adjacent cells

- **WHEN** etiquetas are printed in column 1 and column 2 of the same row
- **THEN** they touch, with no gap

### Requirement: No rotation of the etiqueta

The etiqueta SHALL NOT be rotated to fit more per sheet.

#### Scenario: Size that would fit more rotated

- **WHEN** a size would fit more cells rotated
- **THEN** the grid is computed without rotating it

### Requirement: R5 — A size must fit the sheet

A label size SHALL fit the sheet at least once (`columnas ≥ 1` and `filas ≥ 1`). Creating, editing or reactivating
a size that does not fit is rejected with a field error. Editing the sheet so that an ACTIVE size no longer fits is
rejected, naming the sizes that would not fit.

#### Scenario: New size too wide

- **GIVEN** the seeded A4 / 5 mm sheet
- **WHEN** the administrator creates a 205 mm wide size
- **THEN** it is rejected with a field error

#### Scenario: Sheet shrunk under an active size

- **GIVEN** an active 100 × 42 mm size
- **WHEN** the administrator edits the sheet to 100 × 297 mm with margin 5 mm
- **THEN** the edit is rejected, naming the 100 × 42 size

### Requirement: R5 — Existing sizes that do not fit

A size that already exists and does not fit the sheet (e.g. wider than 200 mm under the seeded A4 / 5 mm) SHALL be
left as is by the migration: the admin list marks it "No entra en la hoja", the print dialogs do not offer it, and
it can be edited to fit or deactivated.

#### Scenario: 210 mm wide size after the migration

- **GIVEN** an existing 210 mm wide size and the seeded A4 / 5 mm sheet
- **WHEN** the administrator opens the sizes list and a user opens a print dialog
- **THEN** the list marks it "No entra en la hoja" and the dialog does not offer it

#### Scenario: Size fixed

- **WHEN** the administrator edits that size to fit, or deactivates it
- **THEN** the change is accepted

### Requirement: R5 — No size fits

If no active size fits the sheet, the print dialogs SHALL show the existing "no sizes" warning (`SinTamanos`).

#### Scenario: Every active size too large

- **WHEN** no active size fits the sheet and a print dialog opens
- **THEN** it shows the `SinTamanos` warning

### Requirement: Sheet edit blocked only by sizes that fit now

Editing the sheet SHALL be rejected only for the active sizes that fit the CURRENT sheet and would stop fitting
(R5). A size that already does not fit (e.g. wider than 200 mm after migration 0096) does not block the edit, or the
administrator could never enlarge the sheet while it exists.

#### Scenario: Enlarging the sheet with a non-fitting size

- **GIVEN** an active 210 mm wide size that does not fit the A4 / 5 mm sheet
- **WHEN** the administrator edits the sheet to 297 × 210 mm
- **THEN** the edit is not blocked by that size

### Requirement: Size checks against the sheet

Editing a size SHALL be checked against the sheet whether the size is active or not; reactivating one that does not
fit is a plain domain error (the reactivation form has only the motivo, so there is no field to mark).

#### Scenario: Editing an inactive size

- **WHEN** the administrator edits an inactive size so that it does not fit
- **THEN** it is rejected

#### Scenario: Reactivating a size that does not fit

- **WHEN** the administrator reactivates a size that does not fit
- **THEN** it is rejected with a domain error not tied to a field

### Requirement: Sheet and size locks

The size commands SHALL hold the sheet row `FOR SHARE` and the sheet edit holds it `FOR UPDATE` (see
`etiqueta-hoja-repository.ts`), so a size created while the sheet is edited can not slip past the fit check.

#### Scenario: Size created during a sheet edit

- **WHEN** a size is created while the sheet is being edited
- **THEN** the size command waits for the sheet edit and checks the fit against its result

### Requirement: R6 — PDF page is the sheet

The PDF page SHALL be the sheet (`ancho_mm × alto_mm`, margin 0 in pdfkit). The etiqueta is drawn inside its cell
exactly as today inside its page: the fixed 100 × 42 mm design scaled uniformly and centered in the cell. The rest
of the sheet is blank. Still exactly one page.

#### Scenario: 60 × 40 size on A4

- **GIVEN** the sheet 210 × 297 mm and a 60 × 40 mm size
- **WHEN** an etiqueta is printed
- **THEN** the PDF is one 210 × 297 mm page with the 100 × 42 design scaled uniformly and centered in the chosen cell, the rest blank

### Requirement: Orientation from the page size

The PDF page's width × height SHALL already declare the orientation; nothing else is forced.

#### Scenario: Landscape sheet

- **GIVEN** a 297 × 210 mm sheet
- **WHEN** an etiqueta is printed
- **THEN** the page is 297 × 210 mm and no other orientation setting is forced

### Requirement: R7 — PDF route parameters

The PDF route SHALL take `?tamano=<id>&columna=<n>&fila=<n>`. Missing `columna`/`fila` (old links) → 1/1. Missing
`tamano` (old links) → the first active size that fits the sheet, in the admin list's order; none → `NOT_FOUND`
(the hardcoded 100 × 42 fallback goes away, since it may not fit an edited sheet).

#### Scenario: Old link without a cell

- **WHEN** the route is called without `columna` and `fila`
- **THEN** the etiqueta prints in column 1, row 1

#### Scenario: Old link without a size

- **WHEN** the route is called without `tamano`
- **THEN** it uses the first active size that fits the sheet, in the admin list's order

#### Scenario: No size fits

- **WHEN** the route is called without `tamano` and no active size fits the sheet
- **THEN** it answers `NOT_FOUND`

### Requirement: R7 — Invalid cell or size

On the R7 PDF route, a non-integer or out-of-grid cell SHALL be `VALIDATION_ERROR` (400) and, like an unknown size,
is resolved BEFORE marking the etiqueta impresa. A link that names a size that exists but does not fit the sheet is
a `VALIDATION_ERROR`, resolved before marking impresa.

#### Scenario: Out-of-grid cell

- **GIVEN** a 100 × 42 mm size on the seeded A4 / 5 mm sheet (2 columnas)
- **WHEN** the route is called with `columna=3`
- **THEN** it answers `VALIDATION_ERROR` (400) and the etiqueta is not marked impresa

#### Scenario: Non-integer cell

- **WHEN** the route is called with `fila=1.5`
- **THEN** it answers `VALIDATION_ERROR` (400) and the etiqueta is not marked impresa

#### Scenario: Size that does not fit

- **WHEN** the route names an existing size that does not fit the sheet
- **THEN** it answers `VALIDATION_ERROR` and the etiqueta is not marked impresa

### Requirement: R8 — Print dialog

The print dialog SHALL show the size select, then a clickable grid drawn in the sheet's proportions with one cell
per position that fits, the summary "N columnas × M filas · K etiquetas por hoja" and the chosen position as text
("Columna 3, fila 2"). Default selection: column 1, row 1. Changing the size keeps the chosen cell if it still
fits, else falls back to 1/1.

#### Scenario: Dialog opened

- **GIVEN** the seeded A4 / 5 mm sheet and a 100 × 42 mm size
- **WHEN** the print dialog opens
- **THEN** the grid has 2 × 6 cells, the summary reads "2 columnas × 6 filas · 12 etiquetas por hoja" and column 1, row 1 is selected

#### Scenario: Size changed, cell still fits

- **GIVEN** column 2, row 3 selected
- **WHEN** the user picks another size where that cell still fits
- **THEN** column 2, row 3 stays selected

#### Scenario: Size changed, cell no longer fits

- **GIVEN** column 3, row 2 selected
- **WHEN** the user picks a size with only 2 columns
- **THEN** the selection falls back to column 1, row 1

### Requirement: R9 — Accessible grid

The grid SHALL be an accessible radio group: each cell is a radio labelled "Columna c, fila f", arrow keys move the
selection, the selected cell is visibly filled.

#### Scenario: Keyboard

- **GIVEN** column 1, row 1 selected
- **WHEN** the user presses the right arrow
- **THEN** the selection moves to the radio labelled "Columna 2, fila 1", which is visibly filled

### Requirement: R10 — Real-size warning

Both dialogs SHALL warn: "Imprimí en tamaño real (100 %). Si la impresión se ajusta a la página, la etiqueta se
corre." (a browser's "fit to page" shifts the grid).

#### Scenario: Dialog opened

- **WHEN** either print dialog opens
- **THEN** it shows "Imprimí en tamaño real (100 %). Si la impresión se ajusta a la página, la etiqueta se corre."

### Requirement: R11 — Toma dialog rows

In the toma dialog ("Imprimir etiquetas"), each ítem row SHALL have its size and its position (same grid
component). Inside the OPEN dialog only, once an ítem is printed (= its "Imprimir" was clicked; the browser can not
report the real print), every row the user has not touched yet and that has the SAME size defaults to the next cell
in reading order after the last printed one (wrapping to 1/1 after the last cell).

#### Scenario: Next cell after a print

- **GIVEN** two untouched rows with the same size
- **WHEN** the first is printed in column 1, row 1
- **THEN** the second defaults to column 2, row 1

#### Scenario: Wrapping

- **WHEN** an ítem is printed in the last cell of its grid
- **THEN** the next untouched row with the same size defaults to column 1, row 1

### Requirement: R11 — Other sizes and closing the dialog

In the toma dialog, a row with another size than the last printed one SHALL keep 1/1: positions of different grids
are not comparable. Closing the dialog forgets the carried cells (nothing persisted, see Non-goals).

#### Scenario: Row with another size

- **GIVEN** an untouched row with another size
- **WHEN** an ítem is printed
- **THEN** the row keeps column 1, row 1

#### Scenario: Dialog reopened

- **GIVEN** an ítem printed in column 1, row 1
- **WHEN** the dialog is closed and opened again
- **THEN** every row starts at column 1, row 1

### Requirement: R11 — Touched rows

In the toma dialog, a row SHALL count as "touched" once the user picks a cell in it; printing freezes the printed
cell on its row.

#### Scenario: Touched row

- **GIVEN** a row where the user picked column 2, row 4
- **WHEN** another ítem with the same size is printed
- **THEN** the row keeps column 2, row 4

#### Scenario: Printed row

- **WHEN** a row is printed
- **THEN** its printed cell stays on that row

### Requirement: R12 — Admin sheet panel

In Admin, Configuración → Etiquetas, a "Hoja de impresión" panel above the sizes list SHALL show the sheet ("A4
vertical — 210 × 297 mm, margen 5 mm") and, with `config.editar`, edit it (form keeps input on error,
`use-form-submit`). The sizes list shows, per size, how many fit: "2 × 6 = 12 por hoja". Page copy stops saying the
design is scaled to the chosen page.

#### Scenario: Seeded sheet

- **WHEN** the administrator opens Configuración → Etiquetas
- **THEN** the panel reads "A4 vertical — 210 × 297 mm, margen 5 mm"
- **AND** a 100 × 42 mm size shows "2 × 6 = 12 por hoja"

#### Scenario: Sheet edit refused

- **GIVEN** a user with `config.editar`
- **WHEN** the sheet edit is refused
- **THEN** the form keeps what the user typed

#### Scenario: User without config.editar

- **GIVEN** a user with `config.ver` but without `config.editar`
- **WHEN** the user opens the panel
- **THEN** the sheet is shown but cannot be edited

### Requirement: R13 — Command and reads

Editing the sheet SHALL be a `defineCommand` (`config.editar`), audited like the sizes (before / after values of the
three measures). Two reads, mirroring the sizes: `get-etiqueta-hoja.ts` (`config.ver`, admin page) and
`get-hoja-para-imprimir.ts` (`etiquetas.imprimir`, print dialogs and PDF).

#### Scenario: Sheet edited

- **GIVEN** a user with `config.editar`
- **WHEN** the user changes the margin from 5 to 7 mm
- **THEN** the audit records the before and after values of the three measures

#### Scenario: Print dialog without config.ver

- **GIVEN** a user with `etiquetas.imprimir` but without `config.ver`
- **WHEN** the user opens a print dialog
- **THEN** the sheet is read through `get-hoja-para-imprimir.ts`

### Requirement: Audit entity of the sheet

The sheet's audit row SHALL use the tenant id as `entidadId` (same as `parametro`), entity `etiqueta_hoja`:
`fsj.etiqueta_hoja` has no surrogate id.

#### Scenario: Sheet edit audited

- **WHEN** the sheet is edited
- **THEN** the audit row has entity `etiqueta_hoja` and the tenant id as `entidadId`

### Requirement: R14 — Toma first print: one Imprimir, one PDF

In the toma dialog, first print (ítems still to confirm): ONE "Imprimir" SHALL confirm the receta and open every
etiqueta in ONE PDF, in ítem order, each in its own cell of the same sheet; an etiqueta that would overlap one
already on the page starts a new page (sheet). Before confirming, an untouched row defaults to the cell after the
previous row of the same size (1/1 for the first).

#### Scenario: Three ítems of the same size

- **GIVEN** three untouched rows with the same size
- **WHEN** the dialog opens
- **THEN** they default to column 1 row 1, column 2 row 1 and the next cell in reading order
- **AND** "Imprimir" opens one PDF with the three etiquetas in ítem order

#### Scenario: Two ítems in the same cell

- **GIVEN** two ítems of the same size set to the same cell
- **WHEN** "Imprimir" is clicked
- **THEN** the second etiqueta starts a new page

### Requirement: R14 — Opening the tab

On the toma's first print, the tab SHALL be opened during the click (user gesture) and pointed at the PDF once the
confirmation succeeds; if the browser blocks it, the dialog offers an "Abrir etiquetas" link.

#### Scenario: Popup blocked

- **GIVEN** a browser that blocks the tab
- **WHEN** the confirmation succeeds
- **THEN** the dialog offers an "Abrir etiquetas" link

### Requirement: R14 — All or nothing; reprint per ítem

The toma's first print SHALL be all or nothing: every size, cell and etiqueta is checked before any is marked
impresa. The reprint keeps one "Imprimir" per ítem (R11).

#### Scenario: One cell out of the grid

- **WHEN** one ítem's cell is out of its grid
- **THEN** no etiqueta is marked impresa

#### Scenario: Reprint

- **WHEN** the receta has nothing left to confirm and the user reprints
- **THEN** each ítem has its own "Imprimir"

## Status

Status: implemented (2026-10-21), migration 0096 pending to apply (see Rollout). Plan: `docs/superpowers/plans/2026-10-21-hoja-etiquetas.md`.
Builds on `openspec/specs/etiqueta-preparado/spec.md` (the label layout, unchanged) and
migration 0066 (`fsj.etiqueta_tamano`, the configured label sizes).

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

## Code (planned)

| # | Code (planned) |
|---|---|
| R1 | `fsj.etiqueta_hoja` (migration 0096), `modules/etiqueta-tamanos` |
| R2 | `domain/etiqueta-hoja.ts`, DB `CHECK`s |
| R3 | `grillaHoja(hoja, tamano)` |
| R4 | `posicionCelda` |
| R5 | `crear/editar/reactivar-etiqueta-tamano.ts`, `editar-etiqueta-hoja.ts` |
| R6 | `buildEtiquetaPdf` |
| R7 | `app/api/preparaciones/[id]/etiqueta/pdf/route.ts`, `imprimirEtiquetaPdf`, `hrefEtiquetaPdf` |
| R8 | `modules/preparaciones/ui/` (new `PosicionEnHoja` component) |
| R9 | same |
| R10 | same |
| R11 | `SeleccionarEtiquetasDialog` |
| R12 | `app/(app)/admin/configuracion/etiquetas/page.tsx`, `modules/etiqueta-tamanos/ui/` |
| R13 | `modules/etiqueta-tamanos/application/` |
| R14 | `SeleccionarEtiquetasDialog`; `GET /api/preparaciones/etiquetas/pdf`; `imprimirEtiquetasPdf`; `buildEtiquetasPdf` |

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
- `openspec/specs/etiqueta-preparado/spec.md`: one line pointing here for placement.

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

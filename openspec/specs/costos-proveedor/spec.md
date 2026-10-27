# Costos de proveedores (reference prices for cotizaciones)

## Purpose

Today a cotización costs each línea with the `costo_unitario` of the partidas
in stock (open partidas first, then FEFO, blended). The pharmacy wants to quote
with the **reference prices of its suppliers' price lists** instead, keeping
the real purchase cost of every partida untouched. Approved 2026-10-15 (see Status).

This feature adds:

1. a store of supplier reference prices (**costos de proveedor**), versioned,
   one vigente price per (droga, proveedor);
2. a section to consult them, edit them by hand and import a supplier price
   list from a file (preview, correct, confirm);
3. a new cost source for cotizaciones and presupuestos, with an explicit
   fallback to today's partida-based costing.

## Requirements

### Requirement: R1 — One vigente per (droga, proveedor)

A costo de proveedor SHALL belong to one (droga, proveedor) of the tenant. At most **one vigente** per pair.

#### Scenario: CP17 — Second vigente for the same pair

- **GIVEN** a vigente costo de proveedor for a (droga, proveedor)
- **WHEN** a second vigente is inserted for the same pair
- **THEN** the database refuses it

#### Scenario: CP17 — RLS isolates tenants

- **GIVEN** costos de proveedor stored by tenant A
- **WHEN** a session of tenant B reads costos de proveedor
- **THEN** none of tenant A's rows are visible

### Requirement: R2 — Every change is a new version

Each change SHALL insert a **new version** and close the previous one (`vigente_hasta` = the new one's
`vigente_desde`, same instant). Nothing is ever updated except `vigente_hasta` once, and nothing is deleted. The
previous version is the "valor anterior".

#### Scenario: CP4 — New price for a pair

- **GIVEN** a vigente costo for a pair
- **WHEN** a new price is registered for that pair
- **THEN** the previous vigente is closed at the same instant and one vigente is left

#### Scenario: CP17 — Only `vigente_hasta`, once; no DELETE

- **GIVEN** a stored costo de proveedor
- **WHEN** an UPDATE touches another column than `vigente_hasta`, or closes it a second time, or a DELETE runs
- **THEN** the database refuses it

### Requirement: R3 — Stored per version

Each version SHALL store: `precio_informado` (> 0, exact as typed), `unidad_precio_id`, `costo_unitario` (> 0, per
droga unidad base), `fecha_precio`, `descripcion_proveedor` (text on the list, nullable), `lista_precio_id` (NULL =
manual), `motivo` (nullable), `vigente_desde`, `vigente_hasta`, `creado_por_id`.

#### Scenario: Manual entry

- **WHEN** a costo is entered by hand
- **THEN** its version is stored with `lista_precio_id` NULL and the precio informado exactly as typed

### Requirement: R4 — Cost per unidad base

`costo_unitario` SHALL be `precio_informado / factor(1 unidad_precio → unidad base)`, using
`shared/decimal/convertir-unidad.ts` (same arithmetic as `fsj.convertir`), rounded to **10 decimals** half-up. The
precio informado is kept exact so the cost can always be recomputed.

#### Scenario: CP1 — Price per kg

- **GIVEN** a precio informado of 40.898 $/kg
- **WHEN** the droga's unidad base is mg
- **THEN** `costo_unitario` is 0,040898 $/mg
- **AND** when the droga's unidad base is g, it is 40,898 $/g

### Requirement: R5 — Same magnitud

The unidad de precio MUST have the **same magnitud** as the droga's unidad base and be vigente. No density
conversion.

#### Scenario: CP2 — Unidad of another magnitud

- **WHEN** the unidad de precio is of another magnitud than the droga's unidad base
- **THEN** it is rejected

### Requirement: R6 — Default unidad de precio

The default unidad de precio SHALL follow the droga's magnitud: masa → kg, volumen → L, unidad → u. Editable per
row.

#### Scenario: Droga measured by mass

- **GIVEN** a droga whose magnitud is masa
- **WHEN** a row or entry for it is shown
- **THEN** the unidad de precio defaults to kg and can be changed

### Requirement: R7 — Typed net of IVA, in pesos

The precio informado SHALL be typed and imported **net of IVA**, in pesos, as supplier lists write it (like
partidas). No currency column (the whole system is pesos-only; a column with a single possible value would be
misleading).

#### Scenario: Price input label

- **WHEN** the manual form asks for the price
- **THEN** its label says "sin IVA"

### Requirement: R7a — IVA from the start

Every costo SHALL carry its `alicuota_iva` (percent, 0–100) and both prices with it: `precio_informado_con_iva`
(precio informado × (1 + alícuota / 100), 6 decimals half-up) and `costo_unitario_con_iva` (costo unitario × the
same factor, 10 decimals half-up). The net figures are kept too: **both numbers are stored**.

The alícuota SHALL default to the tenant parametro `alicuota_iva_porcentaje` (21, Configuración › Parámetros) and be
**editable per costo** in the manual form. A row that does not choose one (a list import) keeps the pair's vigente
alícuota, else takes the parametro's. Changing the parametro never touches costos already stored.

The section SHALL show the price **with IVA** first and the net one, with its alícuota, under it.

#### Scenario: New costo at the default alícuota

- **GIVEN** the parametro at 21
- **WHEN** $ 40.898 / kg sin IVA is registered without changing the alícuota
- **THEN** it is stored with alícuota 21, $ 49.486,58 / kg con IVA and both costos por unidad base

#### Scenario: A product at 10,5 %

- **GIVEN** a costo whose alícuota was set to 10,5 by hand
- **WHEN** the proveedor's next list is imported
- **THEN** the new version keeps 10,5

### Requirement: R8 — No future fecha del precio

`fecha_precio` MUST NOT be after the jornada actual.

#### Scenario: Price dated tomorrow

- **WHEN** a costo is registered with a `fecha_precio` after the jornada actual
- **THEN** it is refused

### Requirement: R9 — An older list never overwrites a newer price

A new version for a pair whose vigente has a **later** `fecha_precio` SHALL be refused (an older list never
overwrites a newer price).

#### Scenario: CP5 — Older fecha del precio

- **GIVEN** a vigente with a later `fecha_precio`
- **WHEN** a price with an older `fecha_precio` is registered for that pair
- **THEN** it is refused (más antigua)

### Requirement: R10 — Sin cambios

Same precio informado, unidad, `fecha_precio` and alícuota de IVA (R7a) as the vigente SHALL be **sin cambios**, no
new version; changing only the alícuota is a new version. Same price with a later date → new version (the price is confirmed as of a newer date; it matters for R16 and for the
antigüedad shown).

#### Scenario: CP6 — Same price and date

- **WHEN** the same price and date as the vigente are registered
- **THEN** it is sin cambios and no version is created

#### Scenario: CP6 — Same price, later date

- **WHEN** the same price with a later date is registered
- **THEN** a new version is created

### Requirement: R11 — Dar de baja

**Dar de baja** a costo de proveedor SHALL close the vigente without replacement. Motivo required.

#### Scenario: Baja without motivo

- **WHEN** the user gives a costo de proveedor de baja without a motivo
- **THEN** it is refused

#### Scenario: Baja with motivo

- **WHEN** the user gives a costo de proveedor de baja with a motivo
- **THEN** the vigente is closed and no new vigente replaces it

### Requirement: R12 — No new costo for a droga or proveedor de baja

No new costo SHALL be accepted for a droga or proveedor de baja. Existing ones stay as history.

#### Scenario: Proveedor de baja

- **GIVEN** a proveedor de baja with stored costos
- **WHEN** a new costo is registered for it
- **THEN** it is refused
- **AND** its existing costos stay as history

### Requirement: R13 — Import flow

The import flow SHALL be: choose proveedor → fecha de la lista → file → **read** (validate, parse, match; writes
nothing) → editable preview → **confirm**. Nothing is saved before the user confirms.

#### Scenario: Reading a list

- **WHEN** the user reads a price list file
- **THEN** a preview is shown and nothing is written until the user confirms

### Requirement: R14 — Accepted formats, detected by signature

Accepted formats SHALL be **.xls** (Excel 97-2003, BIFF8) and **.xlsx**, both spreadsheets. The format is detected
from the file's **signature** (OLE2 `D0 CF 11 E0 A1 B1 1A E1` → XLS, zip `PK\x03\x04` → XLSX); name and MIME type
only have to say .xls or .xlsx, and a wrong extension is not an error (the content is what is read).

#### Scenario: OLE2 file named .xlsx

- **WHEN** the user uploads an OLE2 file named `.xlsx`
- **THEN** it is read as .xls

### Requirement: R14 — Readers

.xlsx SHALL be read with `exceljs` (already a dependency); .xls by an **in-repo BIFF8 reader with no dependency**
(the npm `xlsx`/SheetJS package is abandoned at 0.18.5 with known vulnerabilities): CFB container (FAT, DIFAT, mini
stream) + records `SST`/`CONTINUE`, `LABELSST`, `LABEL`, `NUMBER`, `RK`, `MULRK`, `FORMULA` (cached result) and
blanks. Both readers return the same `LibroHojas` (sheet names + raw rows), so the parser is format-agnostic.

#### Scenario: Same list as .xls and .xlsx

- **WHEN** the same list is read once as .xls and once as .xlsx
- **THEN** both readers return the same `LibroHojas` and the parser gives the same rows

### Requirement: R14 — Unsupported files

Unsupported files SHALL be refused with their own message: encrypted .xls ("protegido con contraseña") and BIFF5/7
or older ("anterior a Excel 97"); anything else unreadable is "no parece un .xls válido".

#### Scenario: Encrypted .xls

- **WHEN** the user uploads an encrypted .xls
- **THEN** the message says it is "protegido con contraseña"

#### Scenario: Unreadable file

- **WHEN** the user uploads a file with an OLE2 signature that is neither encrypted nor BIFF5/7 and can not be read
- **THEN** the message says "no parece un .xls válido"

### Requirement: R14 — Dates and PDF

Dates in a .xls are the plain number Excel stores (cell formats are not read); lists carry only text and numbers.
PDF SHALL NOT be read: the supplier sends Excel, so the PDF parser (E7) was dropped (`formato 'PDF'` stays allowed
in the DB, unused).

#### Scenario: PDF list

- **WHEN** the user uploads a PDF price list
- **THEN** it is not read as a price list

### Requirement: R15 — File validation before parsing

File validation SHALL run before parsing: is a `File`, not empty, ≤ **4 MiB** (its own limit `MAX_LISTA_BYTES`; the
real list is a 2.1 MB .xls, and the PDF imports keep their 1 MiB), `.xls`/`.xlsx` name or mime, then the signature
(R14); at most 5.000 data rows. The size is checked before `arrayBuffer()`. Errors are user-readable messages, never
a stack trace.

#### Scenario: File over 4 MiB

- **WHEN** the user uploads a list larger than 4 MiB
- **THEN** it is refused with a readable message before its bytes are read

#### Scenario: Too many rows

- **WHEN** the list has more than 5.000 data rows
- **THEN** it is refused with a readable message

### Requirement: R15 — Body limit and .xls bounds

`next.config.ts` `serverActions.bodySizeLimit` is one limit for every upload: it SHALL be the largest body (4 MiB +
32 KiB multipart margin) and a test asserts it covers both the PDF and the lista limits. The .xls reader
additionally bounds every sector index and chain (cycle detection, chain capped by the file's sector count).

#### Scenario: Cyclic sector chain

- **WHEN** a .xls has a sector chain that loops
- **THEN** the reader stops with a readable error

### Requirement: R16 — Base rows of the received layout

The parser of the received layout ("Lista de medicamentos", Crystal Reports export) SHALL read: header row
`DESCRIPCION`, `PRECIO`; one data row per product. Only **base rows** (no presentation suffix) are imported, as price
per kg/L/u. Rows with a presentation (`X <n>`, `Bidon X`, `Tambor X`, `Pet X`, `Cuñete X`, `Bolsa X`) are listed as
**omitida (presentación)**.

#### Scenario: CP11 — Parser rows

- **WHEN** the received list is parsed
- **THEN** presentation rows are omitted and header, footer and blank rows are ignored
- **AND** "Sicotrop L4" / "Sedronar L2" are kept in the description and numbers given as text are parsed

### Requirement: R16 — Ignored rows, columns and sheets

Blank rows, the header and page footers (`Page n of m`) SHALL be ignored. Other columns (`PRECIO mg`, `mg C/IVA`,
`COSTO`) are derived spreadsheet formulas and ignored. The workbook has one sheet per date (newest last): the
preview opens the **last sheet that has data** and shows a sheet selector that re-reads the same file with another
sheet; each import reads ONE sheet.

#### Scenario: Workbook with several sheets

- **GIVEN** a workbook with one sheet per date
- **WHEN** it is read
- **THEN** the preview opens the last sheet that has data and offers a sheet selector
- **AND** picking another sheet re-reads the same file with that sheet only

### Requirement: R17 — Matching rows to drogas

Each parsed row SHALL be matched to a droga with the same rules as the invoice import: remembered synonym
(`DrogaAlias`) first, then exact normalized name (`resolverDroga`, `normalizarTextoDroga` from
`modules/recetas/domain/importacion-receta.ts`). No fuzzy matching, no droga is created.

#### Scenario: Text with no match

- **WHEN** a row's text is neither a remembered synonym nor a droga's exact normalized name
- **THEN** the row is sin asociar and no droga is created

### Requirement: R18 — Row states

Row states in the preview SHALL be: **asociada** (will apply), **sin asociar** (no droga; omitted unless the user
picks one), **duplicada** (same droga twice in the file: both rows flagged, the user must omit one), **precio
inválido** (missing, ≤ 0 or not a number), **más antigua** (R9), **sin cambios** (R10), **omitida** (presentación
or by the user).

#### Scenario: CP3 — Invalid price

- **WHEN** a row's precio is 0, negative, empty or not a number
- **THEN** it is precio inválido

#### Scenario: CP7 — Same droga twice

- **WHEN** a file has the same droga twice
- **THEN** both rows are duplicada and confirm is refused until one is omitted

### Requirement: R18 — Variation shown

Each applicable row SHALL show the current vigente price, the new one and the variation %; a variation above ±50 %
is highlighted.

#### Scenario: Large variation

- **WHEN** an applicable row's new price differs from the vigente by more than 50 %
- **THEN** the variation is highlighted

### Requirement: R19 — Preview edits

In the preview the user SHALL be able to: pick/change the droga (Combobox), tick "recordar equivalencia" (creates a
`DrogaAlias` with the list text on confirm, exactly like the invoice import), change the unidad de precio, correct
the price, omit/include a row. Filters by state. "Recordar" is not offered when the row's text already is the
droga's name.

#### Scenario: Remembering an equivalence

- **WHEN** the user picks a droga for a row, ticks "recordar equivalencia" and confirms
- **THEN** a `DrogaAlias` with the list text is created for that droga

### Requirement: R19 — Nuevo insumo

A **sin asociar** row SHALL have "Nuevo insumo" (only with `drogas.crear`): a dialog with the SAME alta form as
`/catalogos/drogas?nueva=1` (`DrogaForm` in `modules/drogas/ui/nueva-droga-dialog.tsx`), its name prefilled with the
list's text; the created droga is chosen for that row at once.

#### Scenario: Creating the droga from the row

- **GIVEN** a user with `drogas.crear` and a sin asociar row
- **WHEN** the user clicks "Nuevo insumo" and saves the form
- **THEN** the droga is created with the name prefilled from the list's text and chosen for that row

#### Scenario: Without `drogas.crear`

- **GIVEN** a user without `drogas.crear`
- **WHEN** the preview shows a sin asociar row
- **THEN** it has no "Nuevo insumo"

### Requirement: R20 — Confirm is all or nothing

Confirm SHALL be **all or nothing**: one transaction inserts the `lista_precio_proveedor`, closes and inserts the
versions and creates the remembered synonyms; any invalid row rejects the whole confirmation with the row marked
(`fields: ["filas.<i>.<campo>"]`), keeping every edit (`shared/ui/use-form-submit.ts`).

#### Scenario: CP8 — One invalid row at confirm

- **WHEN** one row is invalid at confirm
- **THEN** nothing is written (no lista, no versions, no synonyms)

### Requirement: R21 — Same file only once

The same file (SHA-256 of its bytes) MUST NOT be imported twice for the same proveedor.

#### Scenario: CP9 — Same file twice

- **WHEN** the same file is imported twice for the same proveedor
- **THEN** it is refused

### Requirement: R22 — Drogas absent from a list

A droga **absent** from an imported list SHALL keep its vigente costo de proveedor (the list may be partial).
Removing it is an explicit baja (R11).

#### Scenario: Partial list

- **GIVEN** a droga with a vigente costo from the proveedor
- **WHEN** a list of that proveedor without the droga is imported
- **THEN** the droga keeps its vigente costo

### Requirement: R23 — Concurrency

The preview SHALL carry, per row, the id of the vigente it compared against. On confirm, after locking the pair's
vigente (`FOR UPDATE`), a different vigente rejects the confirmation ("El costo de X cambió mientras revisabas la
lista. Volvé a leer el archivo."). The partial unique index is the last guard.

#### Scenario: CP10 — Vigente changed between read and confirm

- **WHEN** the vigente of a row's pair changes between read and confirm
- **THEN** the confirm is refused

### Requirement: R24 — Manual entry

A manual entry (add or change one costo) SHALL go through the **same command and validation** as the import, with
`lista_precio_id = NULL`: droga, proveedor, precio informado, unidad de precio, fecha del precio (default today),
motivo (optional).

#### Scenario: Manual price with an older date

- **GIVEN** a vigente with a later `fecha_precio`
- **WHEN** the user enters a price by hand with an older fecha del precio
- **THEN** it is refused as in an import (R9)

### Requirement: R25 — Línea costed with a costo de proveedor

For each non-manual línea, if the droga has at least one **usable** costo de proveedor, the línea's fuente SHALL be
`PROVEEDOR`: subtotal = cantidad requerida (the ficha's `cantidadAPesar`, converted to the droga's unidad base) ×
`costo_unitario`, for the **whole** quantity, whether or not there is stock; its subtotal with IVA uses
`costo_unitario_con_iva` (R7a).

#### Scenario: CP12 — Cotización with costo de proveedor

- **GIVEN** a droga with a usable costo de proveedor
- **WHEN** a cotización is calculated
- **THEN** the línea costs the whole quantity × costo, with fuente PROVEEDOR

### Requirement: R26 — Usable costo and choice between proveedores

Usable SHALL mean vigente, proveedor not de baja. With several proveedores, the one with the **latest
`fecha_precio`** wins; tie → latest `vigente_desde`.

#### Scenario: CP14 — Two proveedores

- **GIVEN** two proveedores with a vigente costo for the droga
- **WHEN** a cotización is calculated
- **THEN** the latest `fecha_precio` is used
- **AND** a proveedor de baja is ignored

### Requirement: R27 — Fallback to partidas

A droga with no usable costo de proveedor SHALL be costed exactly as today (fuente `PARTIDAS`): open first, FEFO,
blend, faltante. This is an explicit, visible fallback, never a silent 0. Partidas are net of IVA, so the línea's
subtotal with IVA is its subtotal × (1 + `alicuota_iva_porcentaje` / 100) (R7a); the partida itself is not touched.

#### Scenario: CP13 — Cotización without costo de proveedor

- **GIVEN** a droga without a costo de proveedor and the parametro at 21
- **WHEN** a cotización is calculated
- **THEN** the partidas are split and costed as before, and the línea's subtotal con IVA is that cost × 1,21

### Requirement: R28 — Faltante of a PROVEEDOR línea is informational

Stock SHALL still be evaluated for every línea and its `faltante` still recorded. For a `PROVEEDOR` línea the
faltante is **informational** ("sin stock suficiente para prepararla") and does **not** set `esIncompleta`: the
cost is complete. `esIncompleta` keeps its meaning "some línea could not be fully costed", which now only happens on
`PARTIDAS` líneas.

#### Scenario: CP12 — Costo de proveedor without stock

- **GIVEN** a droga with a usable costo de proveedor and no stock
- **WHEN** a cotización is calculated
- **THEN** it is not `esIncompleta` and the faltante is informational

### Requirement: R29 — Manual enrase and unconvertible units

Manual-enrase líneas and líneas whose unit can not be converted (different magnitud) SHALL behave as today (0,
`esParcial`), whatever the fuente.

#### Scenario: Manual enrase with a costo de proveedor

- **GIVEN** a manual-enrase línea whose droga has a usable costo de proveedor
- **WHEN** a cotización is calculated
- **THEN** the línea costs 0 and the cotización is `esParcial`

### Requirement: R30 — Presupuesto

The presupuesto SHALL use the same per-línea rule; its cumulative stock simulation only affects faltantes and
`PARTIDAS` líneas.

#### Scenario: Two ítems with the same proveedor-costed droga

- **GIVEN** a receta with two ítems using the same droga with a usable costo de proveedor
- **WHEN** it is presupuestada
- **THEN** both líneas cost their whole quantity × costo, and the cumulative simulation only changes their faltantes

### Requirement: R31 — Tramo and precio mínimo on the costo de insumos

The tramo margin and precio mínimo SHALL apply to the costo de insumos **with IVA** (the sum of every línea's subtotal
con IVA, R7a; user decision 2026-10-26): the tramo is chosen and the margin applied on it, so the price the client
sees includes the IVA (`openspec/specs/reglas-precio/spec.md`). `cotizacion.costo_insumos` stays net and
`cotizacion.costo_insumos_con_iva` stores the base the price was calculated on (NULL = calculated before migration
0107, priced without IVA).

#### Scenario: CP15 — Receta with mixed fuentes

- **WHEN** a receta has líneas with mixed fuentes
- **THEN** the costo de insumos con IVA is the sum and the tramo is applied once per ítem

#### Scenario: Price includes IVA

- **GIVEN** a costo de insumos of $ 100 net at 21 % and a tramo of +100 %
- **WHEN** the cotización is calculated
- **THEN** the costo de insumos con IVA is $ 121 and the precio final $ 242

### Requirement: R32 — Snapshot of the fuente

Each línea in `cotizacion.detalle` SHALL get `fuente`, `alicuotaIva` and `subtotalConIva` (`subtotal` stays net) and,
for `PROVEEDOR`, `costoProveedor: { costoProveedorId, proveedorId, proveedorNombre, precioInformado,
unidadPrecioSimbolo, costoUnitario, alicuotaIva, precioInformadoConIva, costoUnitarioConIva, fechaPrecio }`; its
`partidas` list is empty. A detalle **without** `fuente` (every cotización calculated before this feature) is read as
`PARTIDAS`; one without `subtotalConIva` (before migration 0107) shows its net subtotal. No data migration.

#### Scenario: CP16 — Old detalle without fuente

- **WHEN** an old detalle without `fuente` is shown
- **THEN** it is rendered as PARTIDAS

### Requirement: R33 — Existing cotizaciones are never recalculated

Already generated cotizaciones SHALL **never** be recalculated by this feature: they are immutable snapshots. New
costs apply when a cotización is calculated (receta created/edited/imported, or "Recalcular").

#### Scenario: New list after a cotización

- **GIVEN** a cotización already generated
- **WHEN** a new price list is confirmed
- **THEN** that cotización is unchanged
- **AND** the new costs apply on the next "Recalcular"

### Requirement: R34 — No cross writes

Calculating a cotización SHALL never write to `costo_proveedor`, `lista_precio_proveedor` or `partida`. Changing a
costo de proveedor never writes to `partida`, `movimiento_stock` or `cotizacion`.

#### Scenario: CP18 — Writes stay apart

- **WHEN** costs are imported or edited, and a cotización is calculated
- **THEN** importing/editing costs leaves `partida` and `movimiento_stock` unchanged
- **AND** calculating a cotización writes nothing in the new tables

### Requirement: R35 — Read permiso

Consulting costos de proveedor and the imported lists SHALL require `stock.valorizado.ver` (the permiso that already
gates money: valorizado, costs in the proveedor history).

#### Scenario: CP19 — Reading

- **WHEN** a user consults the costos de proveedor
- **THEN** it is allowed with `stock.valorizado.ver` and denied otherwise

### Requirement: R36 — Write permiso

Importing, editing and dando de baja SHALL require the new permiso **`costos.proveedor.gestionar`** (categoría
`gestion`, so ADMINISTRADOR gets it automatically; other roles through the role editor). No existing permiso
changes.

#### Scenario: CP19 — Writing

- **WHEN** a user imports, edits or gives a costo de baja
- **THEN** it is allowed with `costos.proveedor.gestionar` and denied otherwise

### Requirement: R37 — Proveedor shown in the cotización detail

The cotización detail SHALL show the proveedor and price used to whoever can see the cotización (`cotizaciones.ver`),
consistent with `openspec/specs/reglas-precio/spec.md` ("no hay ocultamiento del costo según permiso").

#### Scenario: User without stock.valorizado.ver

- **GIVEN** a user with `cotizaciones.ver` and without `stock.valorizado.ver`
- **WHEN** the user opens a cotización with a `PROVEEDOR` línea
- **THEN** the proveedor and price used are shown

### Requirement: Section and tabs

The sidebar SHALL show "Gestión › Costos de proveedores" (right below "Proveedores"), route `/costos-proveedor`,
with the tabs **Vigentes**, **Importar lista**, **Listas importadas** and the **Historial** of a pair.

#### Scenario: Opening the section

- **WHEN** the user clicks "Gestión › Costos de proveedores"
- **THEN** `/costos-proveedor` opens on the Vigentes tab

### Requirement: Vigentes tab

**Vigentes** (`/costos-proveedor`) SHALL list: droga · proveedor · precio con IVA (+ unidad; the net one and the
alícuota under it, R7a) · costo por unidad base con IVA (the net one under it) · fecha del precio (with age) · origen (lista / manual) · actions (editar, historial, dar de baja). Filters:
proveedor and droga as Combobox (UI rollout rule), pagination. "Agregar costo" button.

#### Scenario: Filtering by proveedor

- **WHEN** the user picks a proveedor in its Combobox filter
- **THEN** only that proveedor's vigentes are listed, paginated

### Requirement: Importar lista and Listas importadas tabs

**Importar lista** (`/costos-proveedor/importar`) SHALL implement R13–R23. **Listas importadas**
(`/costos-proveedor/listas`) lists: proveedor, fecha de la lista, archivo, filas leídas / aplicadas, registered by
and when.

#### Scenario: After an import

- **WHEN** a list is confirmed
- **THEN** Listas importadas shows it with its proveedor, fecha, archivo, filas leídas / aplicadas, user and time

### Requirement: Historial tab

**Historial** of a pair (`/costos-proveedor/historial?droga=&proveedor=`) SHALL show every version, newest first,
with precio anterior → nuevo, fecha del precio, origen (list name or "manual" + motivo), user, vigencia.

#### Scenario: Pair with two versions

- **GIVEN** a pair with an imported version and a later manual one
- **WHEN** the user opens its Historial
- **THEN** the manual version is first, with "manual" + its motivo, then the imported one with the list name

### Requirement: Breadcrumbs and shared UI

Every PageHeader SHALL start with the Inicio breadcrumbs. Reuse `shared/ui` (`combobox`, `filter-form`,
`pagination`, `page-header`, `status-badge`, `use-form-submit`, `field-errors`, `toast`) and
`shared/format/monto.ts`.

#### Scenario: Any tab

- **WHEN** the user opens any tab of the section
- **THEN** its header starts with the Inicio breadcrumbs

### Requirement: Fuente in the cotización detail

In the cotización detail (`modules/precios/ui/cotizacion-detalle.tsx`), a `PROVEEDOR` línea SHALL read "Costo de
proveedor · <proveedor> · $<precio>/<unidad> · <fecha>"; a `PARTIDAS` línea keeps today's partida breakdown,
labeled "Costo de partidas (sin costo de proveedor)". A `PROVEEDOR` línea with faltante shows an informational "Sin
stock suficiente" note. The presupuesto panel shows the same fuente per línea.

#### Scenario: PROVEEDOR línea without stock

- **WHEN** the detail shows a `PROVEEDOR` línea with faltante
- **THEN** it reads "Costo de proveedor · <proveedor> · $<precio>/<unidad> · <fecha>" with an informational "Sin stock suficiente" note

#### Scenario: PARTIDAS línea

- **WHEN** the detail shows a `PARTIDAS` línea
- **THEN** it keeps the partida breakdown, labeled "Costo de partidas (sin costo de proveedor)"

## Status

Status: approved 2026-10-15. Implemented: store, section, .xls / .xlsx import (E1-E4) and
the cotización/presupuesto cost source (E5, R25-R34). Rollback:
`docs/rollbacks/costos-proveedor.md`. Module: `modules/costos-proveedor`
(new). Migrations: `0079_costos_proveedor` and `0080_lista_precio_formato_xls`
(the CHECK of `lista_precio_proveedor.formato` learns `'XLS'`). Stage E7 (PDF
parser) is dropped: the supplier sends Excel (user, 2026-10-15).

## Vocabulary

- **Costo de proveedor**: the reference price a supplier quotes for a droga.
  Used only to quote. Never a purchase.
- **Costo real (de adquisición)**: `partida.costo_unitario`, what the lot
  actually cost. Unchanged by this feature.
- **Precio informado**: the price as written on the supplier's list, in its
  **unidad de precio** (e.g. $ per kg).
- **Costo unitario**: the precio informado converted to the droga's unidad
  base (e.g. $ per mg), the same convention as `partida.costo_unitario`.
- **Fecha del precio**: the date the price corresponds to (the list's date for
  an import, the date typed for a manual entry).
- **Lista de precios**: one imported file of one proveedor.
- **Fuente** of a cotización línea: `PROVEEDOR` (priced with a costo de
  proveedor) or `PARTIDAS` (today's algorithm).

## Current behaviour (audited 2026-10-15)

Kept here because the new rules are defined against it.

- The only cost source is `fsj.partida.costo_unitario`, per droga unidad base,
  net of IVA, pesos implied (no currency anywhere). Written by
  `modules/stock/application/ingresar-partida.ts#registrarPartidaCompra`
  (rounded to 6 decimals), corrected in place by `corregir-costo-partida.ts`.
- Cotización: `modules/precios/application/calcular-cotizacion.ts` →
  `cotizar-lineas.ts#cotizarLineas` →
  `cotizacion-repository.ts#getPartidasElegiblesDeDroga` (the ONLY place a
  cotización reads a cost) → `modules/precios/domain/calcular-cotizacion.ts#costearLinea`
  → `modules/stock/domain/reparto.ts#proponerReparto`.
  - Order: open partidas (`fecha_apertura` not null) oldest opened first; then
    closed ones FEFO by `fecha_vencimiento_vigente`; no expiry last. Expired
    (vigente date < jornada) and zero-saldo partidas excluded.
  - Blend: Σ cantidad × costo_unitario per partida used.
  - Insufficient stock: costs what exists, records `faltante`, sets
    `esIncompleta`. No stock: subtotal 0.
  - Ignores `ReservaStock` and `potencia_declarada`; ties have no `orderBy`.
    Not changed by this feature (see Out of scope).
- `Cotizacion` is insert-only (migration 0031); vigente = latest
  `calculada_en`; never recomputed automatically.
- Presupuesto (`modules/recetas/application/presupuestar-receta.ts`) costs
  ítems cumulatively against stock, nothing persisted.

## Enforcement

| # | Enforced in |
|---|---|
| R1 | DB: partial unique index on `(tenant_id, droga_id, proveedor_id) WHERE vigente_hasta IS NULL`. |
| R2 | DB: `GRANT UPDATE (vigente_hasta)` only, validating trigger (no other column, no reopening, no second close), forbid DELETE. App: `registrarCostosProveedor`. |
| R3 | Migration 0079; zod in the domain. |
| R4 | Domain `calcularCostoUnidadBase`. |
| R5 | Domain validation per row. |
| R6 | Domain `unidadPrecioPorDefecto`; UI. |
| R7 | Spec; the manual form's price label says "sin IVA". |
| R7a | Domain `calcularConIva` / `alicuotaIvaSchema`; DB CHECKs (alícuota 0–100, both prices recomputed, migration 0107); `registrarCostosProveedor` resolves the alícuota (row → vigente → parametro). |
| R8 | Domain; DB CHECK not possible (jornada is tenant time) → app only. |
| R9 | Domain `planVersionar`; re-checked inside the command after the lock. |
| R10 | Domain `planVersionar`. |
| R11 | `darDeBajaCostoProveedor`. |
| R12 | Command validation. |
| R13 | `leerListaPrecios` (query) + `registrarCostosProveedor` (command). |
| R14 | `modules/costos-proveedor/infrastructure/leer-xls.server.ts`, `leer-xlsx.server.ts`, `libro-hojas.ts`; domain parsers. |
| R15 | Domain `validarArchivoLista` (sibling of `shared/pdf/validar-archivo-pdf.ts`); `tests/unit/archivo-receta-pdf.test.ts`. |
| R16 | Domain parser `parsers/lista-xlsx-crystal.ts`. |
| R17 | `leerListaPrecios`. |
| R18 | Domain `construirVistaPrevia`; UI. |
| R19 | UI `importar-lista-form.tsx`. |
| R20 | `registrarCostosProveedor`. |
| R21 | DB unique `(tenant_id, proveedor_id, hash_sha256)`; checked at read time to warn early. |
| R22 | By construction: the import only touches the rows it applies. |
| R23 | `registrarCostosProveedor`. |
| R24 | `registrarCostosProveedor` with origen MANUAL. |
| R25 | Domain `costearLinea`. |
| R26 | Infrastructure query + domain `elegirCostoProveedor`. |
| R27 | Domain `costearLinea` (unchanged branch). |
| R28 | Domain `calcularCotizacion`. |
| R29 | Domain (unchanged). |
| R30 | `calcularCotizacionesAcumuladas`. |
| R31 | `calcularPrecioFinal` (unchanged). |
| R32 | Domain types; `get-cotizacion-item.ts`; `cotizacion-detalle.tsx`. |
| R33 | By construction (insert-only `cotizacion`). |
| R34 | DB tests. |
| R35 | Queries. |
| R36 | `PERMISO_CATALOGO`, migration 0079, `tests/db/auth-permisos.test.ts`. |
| R37 | — |

## Data model (migration 0079)

```
fsj.lista_precio_proveedor            -- append-only (REVOKE UPDATE/DELETE, forbid_update_delete)
  id, tenant_id, proveedor_id → proveedor(tenant_id, id),
  formato ('XLS' | 'XLSX' | 'PDF'; 'XLS' added by 0080, 'PDF' unused), nombre_archivo, hash_sha256,
  fecha_lista date, filas_leidas int, filas_aplicadas int,
  registrado_por_id, registrado_en
  UNIQUE (tenant_id, proveedor_id, hash_sha256)

fsj.costo_proveedor                   -- versioned (regla_precio pattern)
  id, tenant_id,
  droga_id → droga(tenant_id, id), proveedor_id → proveedor(tenant_id, id),
  precio_informado numeric > 0, unidad_precio_id → unidad_medida(id),
  costo_unitario numeric > 0, fecha_precio date,
  descripcion_proveedor text NULL,
  lista_precio_id → lista_precio_proveedor(tenant_id, id) NULL,
  motivo text NULL,
  vigente_desde timestamptz, vigente_hasta timestamptz NULL (> vigente_desde),
  creado_por_id,
  -- migration 0107 (R7a); rows before it got 21
  alicuota_iva numeric 0..100, precio_informado_con_iva numeric, costo_unitario_con_iva numeric
  UNIQUE (tenant_id, droga_id, proveedor_id) WHERE vigente_hasta IS NULL
  INDEX (tenant_id, proveedor_id) WHERE vigente_hasta IS NULL
```

Both tables: `fsj.setup_tenant_table` (RLS + tenant policy). `costo_proveedor`:
only `GRANT UPDATE (vigente_hasta)` to `fsj_app`, trigger validating the
update (R2), forbid DELETE. Permiso row for `costos.proveedor.gestionar`.
Audit entities `costo_proveedor` and `lista_precio_proveedor` (labels in
`modules/auditoria/domain/presentacion.ts`).

## Code (planned)

- `modules/costos-proveedor/domain/`: `costo-proveedor.ts` (validation,
  `calcularCostoUnidadBase`, `unidadPrecioPorDefecto`, `planVersionar`,
  `elegirCostoProveedor`), `importacion-lista.ts` (preview types and states),
  `archivo-lista.ts` (file validation + format detection), `parsers/lista-xlsx-crystal.ts`.
- `modules/costos-proveedor/infrastructure/`: `costo-proveedor-repository.ts`,
  `leer-xlsx.server.ts`, `leer-xls.server.ts` (BIFF8), `libro-hojas.ts` (the
  `LibroHojas` shape both readers return).
- `modules/costos-proveedor/application/`: `listar-costos-vigentes.ts`,
  `get-historial-costo.ts`, `listar-listas.ts`, `leer-lista-precios.ts`,
  `registrar-costos-proveedor.ts`, `dar-de-baja-costo-proveedor.ts`,
  `costos-proveedor-para-cotizar.ts` (tx-scoped read used by `precios`;
  `costosProveedorParaCotizar` returns drogaId -> chosen costo).
- `modules/costos-proveedor/ui/` + `app/(app)/costos-proveedor/**`.
- Edited: `modules/precios/domain/calcular-cotizacion.ts` (`costoProveedor`, `fuente`,
  `leerDetalleCotizacion`), `modules/precios/application/cotizar-lineas.ts`,
  `get-cotizacion-item.ts` (`calcular-cotizacion.ts` persists the detalle as is),
  `modules/precios/ui/cotizacion-detalle.tsx`, `modules/precios/ui/actions.ts`
  (aviso wording), `modules/recetas/domain/presupuesto.ts` (`fuentes`),
  `modules/recetas/ui/presupuesto-panel.tsx`, `app/(app)/layout.tsx`,
  `app/(app)/sidebar-nav.tsx`, `modules/auth/domain/permisos.ts`,
  `prisma/schema.prisma`, `modules/README.md`, `openspec/specs/presupuesto-receta/spec.md`,
  `openspec/specs/reglas-precio/spec.md`.

## Decisions

- **New module, not `proveedores` or `stock`.** Those own the real purchase
  cost (trayectoria, partidas). A separate module keeps reference
  prices and real costs from being mixed by accident.
- **Versioned rows instead of an updatable price.** Gives the "valor
  anterior" and the full history for free, matches `regla_precio`, and makes
  an accidental overwrite impossible at the DB level.
- **Cost stored per droga unidad base**, like partidas, so the cotización
  multiplies the same way whatever the source; the precio informado is kept
  for display and recomputation.
- **Latest `fecha_precio` wins between proveedores** (user decision
  2026-10-15). Alternatives rejected: cheapest (optimistic, rewards stale
  lists), preferred proveedor per droga (more model and data entry).
- **Fallback to partidas when there is no costo de proveedor** (user decision
  2026-10-15). Alternative rejected: leaving the línea uncosted, which would
  make most cotizaciones incomplete until every list is loaded. Side effect,
  wanted: until the first list is loaded every cotización is identical to
  today's.
- **Only base rows of the received list** (user decision 2026-10-15): in that
  list the base row's PRECIO is per kg/L, while presentation rows are
  inconsistent (some look like a price per package).
- **Net of IVA** (user decision 2026-10-15), like partidas, so the tramo
  margins keep comparing like with like. **Superseded 2026-10-26 (R7a, R31):**
  the price is still typed net, but each costo stores its IVA too and the
  cotización prices on the cost with IVA; partidas get the tenant's
  `alicuota_iva_porcentaje` (21 by default) at cotización time. Tramo
  boundaries are now compared against the cost with IVA.
- **No automatic recalculation of existing cotizaciones** (user decision
  2026-10-15).
- **.xls native reader instead of a dependency** (user decision 2026-10-15):
  the real list is a BIFF8 `.xls` (Crystal Reports export, 2.1 MB, four
  sheets) and the user wants it uploaded as is. The only mature npm reader,
  `xlsx` (SheetJS), is abandoned at 0.18.5 with known vulnerabilities, so
  `leer-xls.server.ts` reads the format directly (CFB + the BIFF8 records the
  lists use) and returns the same shape as the .xlsx reader. Alternatives
  rejected: asking the user to re-save as .xlsx (the original decision: an
  extra manual step on every list) and a new dependency. Cost: a format
  reader to maintain, covered by tests that build workbooks with a test-only
  BIFF8 writer (`tests/unit/helpers/xls-builder.ts`, no binary fixtures).
- **The signature decides the format**, not the extension or MIME type
  (client-controlled): an OLE2 file named `.xlsx` is read as .xls and a zip named
  `.xls` as .xlsx; a file whose content does not parse says so.
- **4 MiB limit for lists, 1 MiB for PDFs**: the real list (2.1 MB .xls)
  outgrew the shared 1 MiB. `bodySizeLimit` is global to Server Actions, so it
  is raised to 4 MiB + 32 KiB for everyone; each action still enforces its own
  file limit, and the confirmation JSON cap (`MAX_CONFIRMACION_BYTES`) follows
  the body limit. 4 MiB, not more, because the app is hosted on Vercel
  (`docs/deploy.md`), which caps a serverless request body at about 4.5 MB: a
  bigger limit would let files through our check that the platform then
  refuses with a generic error.
- **PDF parser dropped (E7)**: the user clarified on 2026-10-15 that the
  supplier sends this Excel, not a PDF. `formato 'PDF'` stays allowed by the
  CHECK (no migration churn) but nothing writes it.
- **Synonyms reused for matching** (`DrogaAlias`), same as the invoice import,
  instead of a per-supplier code table: no supplier code is printed on the
  received list, and a second matching mechanism would diverge.

## Out of scope

- Reservas and potencia in the cotización (current divergence from the real
  consumption, documented above).
- Deterministic tie-break in `getPartidasElegiblesDeDroga`.
- `app/(app)/partidas/[id]/page.tsx` shows the raw partida cost with
  `stock.ver` while every other cost view needs `stock.valorizado.ver`.
- The stale comment in `corregir-costo-partida.ts` ("not referenced by any
  historical snapshot": `cotizacion.detalle` does store it).

## Open

- Which proveedor (razón social, CUIT) the received list belongs to.
- Whether to warn in the cotización when the costo de proveedor used is older
  than N days (no rule defined; today only its date is shown).

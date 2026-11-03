# Delta — Costos de proveedores: "Listado de precios: Catálogo"

## ADDED Requirements

### Requirement: R16b — Catálogo layout

The parser SHALL also read the supplier's **"LISTADO DE PRECIOS: CATALOGO"** (Crystal Reports export): a header row
with `Codigo Producto`, `Descripción`, `UM`, `Precio` and `Tipo Iva` (case and accents ignored, other columns
ignored), then one data row per product. A data row is a row whose code matches `NNNNN/NNN`; every other row is
ignored. The price is per the row's UM, net of IVA (R7). User decision (2026-11-03).

#### Scenario: Footer and header rows

- **WHEN** a Catálogo sheet with page footers, repeated headers, the "Fecha Impresión" block and the closing
  "SUJETA A VARIACION..." line is parsed
- **THEN** only the rows with a product code are data rows

### Requirement: R16b — Values off their header

The export places some values one column off their header. Each Catálogo field SHALL be read from its header's
column or, when that cell is empty or of the wrong type, from the adjacent one.

#### Scenario: Price one column off its header

- **GIVEN** a Catálogo sheet whose `Precio` header is in column R and whose prices are in column Q
- **WHEN** it is parsed
- **THEN** every data row has its price

### Requirement: R16c — Unidad from the list

In the Catálogo layout the row's UM SHALL set the unidad de precio: `Kg` → kg, `G` → g, `L` → L, `UN` → u, and
`Mi` (millar) → u with the price divided by 1000 (the row says it was per millar). Any other UM leaves the unidad
de precio empty, as a row without unit. User decision (2026-11-03).

#### Scenario: Price per millar

- **GIVEN** a Catálogo row "CAPSULAS GELAT 0", UM `Mi`, price 44.100
- **WHEN** it is read
- **THEN** its precio informado is 44,1 per u

#### Scenario: Unit of another magnitud

- **GIVEN** a droga measured in mg and a Catálogo row for it with UM `L`
- **WHEN** the list is read
- **THEN** the row is omitida (unidad), with a message that the list prices it per L and the droga is measured by
  mass, and it neither blocks the confirmation nor is imported

### Requirement: R16c — IVA from the list

In the Catálogo layout the row's `Tipo Iva` SHALL set its alícuota: `E` (exento) → 0; `G` (gravado) or anything
else → no alícuota chosen, so R7a applies (the vigente's, else the parametro's). User decision (2026-11-03).

#### Scenario: Exempt row

- **GIVEN** a Catálogo row with `Tipo Iva` `E`
- **WHEN** it is imported
- **THEN** its costo is stored with alícuota 0

## MODIFIED Requirements

### Requirement: R6 — Default unidad de precio

The default unidad de precio SHALL follow the droga's magnitud: masa → kg, volumen → L, unidad → u. Editable per
row. A list whose layout carries the unit of each row (Catálogo, R16c) SHALL use that unit instead.

#### Scenario: Droga measured by mass

- **GIVEN** a droga whose magnitud is masa
- **WHEN** a row or entry for it is shown
- **THEN** the unidad de precio defaults to kg and can be changed

#### Scenario: List that says the unit

- **GIVEN** a droga measured in mg and a Catálogo row for it with UM `G`
- **WHEN** the list is read
- **THEN** the row's unidad de precio is g

### Requirement: R7a — Alícuota default and inheritance

The alícuota SHALL default to the tenant parametro `alicuota_iva_porcentaje` (21, Configuración › Parámetros) and be
**editable per costo** in the manual form. A row that does not choose one (a list import) keeps the pair's vigente
alícuota, else takes the parametro's. A list row that states it is exempt (Catálogo `Tipo Iva` `E`, R16c) chooses
0. Changing the parametro never touches costos already stored.

#### Scenario: A product at 10,5 %

- **GIVEN** a costo whose alícuota was set to 10,5 by hand
- **WHEN** the proveedor's next list is imported
- **THEN** the new version keeps 10,5

#### Scenario: Exempt row over a vigente at 21 %

- **GIVEN** a vigente costo at 21 %
- **WHEN** a Catálogo list with that droga's row as `Tipo Iva` `E` is imported
- **THEN** the new version has alícuota 0

### Requirement: R16 — Base rows of the received layout

The parser SHALL recognize the layout of the sheet by its header row: the **"Lista de medicamentos"** (header
`DESCRIPCION`, `PRECIO`) or the **Catálogo** (R16b, header with `Codigo Producto`, `UM` and `Tipo Iva`). A sheet with
neither header is refused with a readable message. Only **base rows** are imported, as price per kg/L/u (Lista de
medicamentos) or per the row's UM (Catálogo); the others are listed as **omitida (presentación)**. In the Lista de
medicamentos a presentation row is one whose description ends in a presentation (`X <n>`, `Bidon X`, `Tambor X`,
`Pet X`, `Cuñete X`, `Bolsa X`); in the Catálogo it is one whose code does not end in `/000`, whatever its text.

#### Scenario: CP11 — Parser rows

- **WHEN** the received list is parsed
- **THEN** presentation rows are omitted and header, footer and blank rows are ignored
- **AND** "Sicotrop L4" / "Sedronar L2" are kept in the description and numbers given as text are parsed

#### Scenario: Catálogo presentation by code

- **GIVEN** Catálogo rows `00052/000` "ACEITE DE ALMENDRAS PURO FNA VI" and `00052/014` "... Bidon X 10"
- **WHEN** the list is parsed
- **THEN** the first is a base row and the second is omitida (presentación)

#### Scenario: Unknown layout

- **WHEN** a sheet has neither header
- **THEN** it is refused saying the header was not found

### Requirement: R16 — Ignored rows, columns and sheets

Blank rows, the header and page footers (`Page n of m`) SHALL be ignored. Other columns (`PRECIO mg`, `mg C/IVA`,
`COSTO` in the Lista de medicamentos; `Mínimo` in the Catálogo) are ignored. The workbook has one sheet per date
(newest last): the preview opens the **last sheet that has data** and shows a sheet selector that re-reads the same
file with another sheet; each import reads ONE sheet.

#### Scenario: Workbook with several sheets

- **GIVEN** a workbook with one sheet per date
- **WHEN** it is read
- **THEN** the preview opens the last sheet that has data and offers a sheet selector
- **AND** picking another sheet re-reads the same file with that sheet only

### Requirement: R18 — Row states

Row states in the preview SHALL be: **asociada** (will apply), **sin asociar** (no droga; omitted unless the user
picks one), **duplicada** (same droga twice in the file: both rows flagged, the user must omit one), **precio
inválido** (missing, ≤ 0 or not a number), **más antigua** (R9), **sin cambios** (R10), **omitida** (presentación,
**unidad** or by the user). **Omitida (unidad)**: the list's own unit (R16c) is of another magnitud than the droga's
unidad base; it is not imported and does not block, and no conversion is attempted (R5). If the user picks a
unidad de precio of the droga's magnitud, the row is evaluated as any other. The preview shows, per row, the list's
UM and IVA when the layout carries them.

#### Scenario: CP3 — Invalid price

- **WHEN** a row's precio is 0, negative, empty or not a number
- **THEN** it is precio inválido

#### Scenario: CP7 — Same droga twice

- **WHEN** a file has the same droga twice
- **THEN** both rows are duplicada and confirm is refused until one is omitted

#### Scenario: Omitted for its unit

- **GIVEN** a Catálogo row priced per L for a droga measured in mg
- **WHEN** the preview is shown
- **THEN** the row is omitida (unidad) and the confirmation is not blocked by it

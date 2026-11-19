# Importación de factura de compra

## Purpose

A factura de compra, read from a PDF or loaded by hand (factura manual), enters its lotes as partidas. This spec covers the import traceability each lote carries (despacho de importación, país de origen, migration 0062); the manual factura offers what the PDF one stores. Change `estandarizar-validaciones` (user decision, 2026-11-04).

## Requirements

### Requirement: FC1 — Despacho and país de origen on every lote

Every lote of a factura de compra SHALL be able to carry a **Despacho de importación** and a **País de origen**, both optional free text of at most 200 characters, where empty means no data. They SHALL be stored on the lote's partida (`partida.despacho_importacion`, `partida.pais_origen`, migration 0062) when the factura is confirmed, and never changed afterwards. A factura read from a PDF stores the values read from the invoice, shown under the lote as text.

#### Scenario: Factura from a PDF

- **GIVEN** a factura read from a PDF whose lote prints despacho `24001IC04123456X`
- **WHEN** the user confirms the factura
- **THEN** the lote's partida stores that despacho, as before this change

#### Scenario: Too long

- **GIVEN** a lote whose despacho has 201 characters
- **WHEN** the user confirms the factura
- **THEN** nothing is stored
- **AND** the lote's despacho field shows the error and the rest of the form keeps what the user typed

### Requirement: FC2 — The factura manual offers them

Each lote of a factura manual (loaded by hand, without a PDF) SHALL offer Despacho de importación and País de origen as inputs, empty by default, so the manual factura offers what the PDF factura stores. User decision (2026-11-04).

#### Scenario: Manual factura with despacho and país

- **GIVEN** a user loading a factura manual with one lote
- **WHEN** the user types despacho `24001IC04123456X` and país `Alemania` and confirms the factura
- **THEN** the lote's partida stores despacho `24001IC04123456X` and país de origen `Alemania`

#### Scenario: Manual factura without them

- **GIVEN** a user loading a factura manual with one lote
- **WHEN** the user leaves despacho and país empty and confirms the factura
- **THEN** the lote's partida stores no despacho and no país de origen

### Requirement: FC3 — Free supplier comprobante number

The comprobante `numero` SHALL accept any non-blank supplier text of at most 30 characters (migration 0128). When
`numero` consists only of digits, leading zeros SHALL be stripped before persistence so the UNIQUE key `(tenant,
proveedor, letra, punto_venta, numero)` still catches repeated imports; alphanumeric numbers keep their exact text.

#### Scenario: Long or alphanumeric supplier number

- **GIVEN** a factura with `numero` `"000500152596"` or `"FC-0012-A"`
- **WHEN** the user confirms the factura
- **THEN** `"000500152596"` is normalized to `"500152596"` and `"FC-0012-A"` is stored as `"FC-0012-A"`

### Requirement: FC4 — Creating a missing droga reuses NuevaDrogaDialog

When a factura line cannot match an existing droga, "Crear «…»" SHALL open the shared `NuevaDrogaDialog` (same
`DrogaForm` as `/catalogos/drogas`) outside the invoice form instead of a separate inline alta.

#### Scenario: Creating a droga from an invoice line

- **GIVEN** an unmatched invoice line
- **WHEN** the user clicks "Crear «…»" and completes the dialog
- **THEN** the droga is created through `crearDroga` and selected in that line

### Requirement: FC5 — Invoice lote vencimiento by month

Invoice lote vencimientos SHALL be read and edited by month and year (`mm/aaaa`, stored as that month's last day).
The PDF parser accepts `dd/mm/aaaa` or `mm/aaaa` and normalizes via `finDeMes`; the form and use case validate via
`fechaVencimientoLote`.

#### Scenario: PDF lote with dd/mm/aaaa or mm/aaaa

- **GIVEN** an invoice PDF with a lote printing `Vto: 15/06/2027` or `Vto: 06/2027`
- **WHEN** the PDF is parsed
- **THEN** the lote's vencimiento is normalized to `2027-06-30`

## Enforcement

- `importarFacturaCompra` validates both fields per lote (`textoOpcional`: trimmed, max 200, empty = null) and `registrarPartidaCompra` writes them on insert; `partida.despacho_importacion` / `pais_origen` are insert-only for `fsj_app`.
- `importarFacturaCompra` validates `numero` (non-empty, max 30, leading zeros stripped only when `/^\d+$/`) matching DB `comprobante_compra_numero_check` (migration 0128), and `fechaVencimiento` per lote via `fechaVencimientoLote`.
- The field errors mark `lineas.<i>.despachoImportacion` / `lineas.<i>.paisOrigen` in the form.

## Code

- `modules/stock/application/importar-factura-compra.ts` (`lineaInput`, `importarFacturaCompraInput`), `modules/stock/application/ingresar-partida.ts` (`registrarPartidaCompra`), `modules/stock/domain/factura-compra-pdf-parser.ts`.
- `modules/stock/ui/importar-factura-form.tsx` (manual branch of each lote, `NuevaDrogaDialog`), `modules/stock/ui/ingresar-partida.tsx`, `app/(app)/partidas/ingresar/page.tsx`.
- `prisma/migrations/*_0062_*` (columns), `prisma/migrations/*_0128_comprobante_numero_libre*` (comprobante number check).

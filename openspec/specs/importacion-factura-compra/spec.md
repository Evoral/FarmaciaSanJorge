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

## Enforcement

- `importarFacturaCompra` validates both fields per lote (`textoOpcional`: trimmed, max 200, empty = null) and `registrarPartidaCompra` writes them on insert; `partida.despacho_importacion` / `pais_origen` are insert-only for `fsj_app`.
- The field errors mark `lineas.<i>.despachoImportacion` / `lineas.<i>.paisOrigen` in the form.

## Code

- `modules/stock/application/importar-factura-compra.ts` (`lineaInput`), `modules/stock/application/ingresar-partida.ts` (`registrarPartidaCompra`).
- `modules/stock/ui/importar-factura-form.tsx` (manual branch of each lote), `modules/stock/ui/ingresar-partida.tsx`, `app/(app)/partidas/ingresar/page.tsx`.
- `prisma/migrations/*_0062_*` (columns).

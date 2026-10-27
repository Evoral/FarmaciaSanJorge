# Exportaciones Excel (.xlsx)

## Purpose

Every list export that used to download a CSV now downloads a branded Excel workbook. Decided 2026-10-14: a CSV
cannot carry the farmacia's colors or logo, and Excel in an es-AR locale opened it as a single column (it expects
`;` as separator, not `,`).

## Requirements

### Requirement: Excel instead of CSV

Every list export listed under **Exports** SHALL download a branded Excel workbook (.xlsx). There MUST be no CSV
export anymore. The PDF exports are unchanged.

#### Scenario: Exporting a list

- **WHEN** the user exports one of the reports listed under Exports
- **THEN** the download is an .xlsx workbook
- **AND** no CSV export is offered

### Requirement: Report heading

The workbook (`shared/xlsx/xlsx-report.ts`) SHALL open with the logo (`public/logo.png`) and "Farmacia San Jorge",
the report title, a one- or two-sentence description of what the export contains (required, written in each
route), "Fecha de emisión" (dd/mm/aaaa hh:mm) and "Filtros" (or "Sin filtros"), followed by a brand-green rule.

#### Scenario: Export without filters

- **WHEN** a report is exported with no filter applied
- **THEN** the heading shows the logo, the name, the title, the description, "Fecha de emisión" and "Sin filtros"

### Requirement: Table styling

The column header SHALL be brand green with white bold text, frozen and with auto-filter; rows are zebra; the
subtotal/total rows and the truncation warning are styled apart.

#### Scenario: Opening the workbook

- **WHEN** the user opens an exported workbook
- **THEN** the green column header stays frozen with auto-filter
- **AND** subtotal/total rows and the truncation warning look different from the zebra data rows

### Requirement: Print setup

The workbook SHALL print landscape, one page wide, with the header row repeated and a "Página N de M" footer.

#### Scenario: Printing a long report

- **WHEN** the user prints a workbook that spans several pages
- **THEN** each page is landscape and one page wide, repeats the header row and shows "Página N de M"

### Requirement: Typed cells

Dates MUST be real Excel dates shown as dd/mm/aaaa (calendar days) or dd/mm/aaaa hh:mm (instants); quantities and
amounts MUST be numbers (amounts with `$`), so they sort, filter and sum, with the viewer's own decimal separator.
Enum values SHALL use their UI labels.

#### Scenario: Summing a column

- **WHEN** the user sums an amount column in Excel
- **THEN** the cells sum as numbers, shown with `$` and the viewer's own decimal separator

#### Scenario: Dates and enums

- **WHEN** the workbook shows a calendar day, an instant and an enum value
- **THEN** the day reads dd/mm/aaaa, the instant dd/mm/aaaa hh:mm, both as real Excel dates
- **AND** the enum shows its UI label

### Requirement: Time zone

Instants SHALL be shown in `America/Argentina/Mendoza` (the schema default of `tenant.zona_horaria`), not yet the
tenant's own zone.

#### Scenario: Instant in the export

- **WHEN** an export contains an instant
- **THEN** it is shown in `America/Argentina/Mendoza`

### Requirement: Filtros matches the audit record

"Filtros" SHALL be the same summary the export's audit record stores (`resumenFiltroParaAuditoria` in each use
case), so the file and the audit log always agree.

#### Scenario: Filtered export

- **WHEN** a report is exported with filters
- **THEN** "Filtros" in the file equals the filter summary stored in the EXPORTAR audit record

### Requirement: Audit before the file

Every export MUST write its EXPORTAR record before the file is returned; `formato` is `"XLSX"` (older rows keep
`"CSV"`).

#### Scenario: Export audited

- **WHEN** a report is exported
- **THEN** an EXPORTAR record with `formato` `"XLSX"` is written before the file is returned

### Requirement: Formula safety

Text MUST always be stored as a string cell; the builder never writes formulas, so user text starting with `=`,
`+`, `-` or `@` stays text.

#### Scenario: Text that looks like a formula

- **GIVEN** a user-entered text that starts with `=`
- **WHEN** it is exported
- **THEN** the cell is a string cell, not a formula

## Exports

| Report | Route | Page |
|---|---|---|
| Reporte de recetas | `/api/recetas/reporte/export/xlsx` | `/reportes/recetas`, `/recetas` |
| Kardex de movimientos de stock | `/api/stock/kardex/export/xlsx` | `/reportes/kardex` |
| Stock valorizado | `/api/stock/valorizado/export/xlsx` | `/reportes/stock-valorizado` |
| Libro recetario digital | `/api/libro/export/xlsx` | `/libro` |
| Libro contralor | `/api/libro/export/contralor/xlsx` | `/libro/contralor` |
| Cumplimiento de firma de cierres | `/api/cierres/reporte/xlsx` | `/cierres/reporte` |

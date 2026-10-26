# Exportaciones Excel (.xlsx)

Every list export that used to download a CSV now downloads a branded Excel
workbook. Decided 2026-10-14: a CSV cannot carry the farmacia's colors or
logo, and Excel in an es-AR locale opened it as a single column (it expects
`;` as separator, not `,`).

## Exports

| Report | Route | Page |
|---|---|---|
| Reporte de recetas | `/api/recetas/reporte/export/xlsx` | `/reportes/recetas`, `/recetas` |
| Kardex de movimientos de stock | `/api/stock/kardex/export/xlsx` | `/reportes/kardex` |
| Stock valorizado | `/api/stock/valorizado/export/xlsx` | `/reportes/stock-valorizado` |
| Libro recetario digital | `/api/libro/export/xlsx` | `/libro` |
| Libro contralor | `/api/libro/export/contralor/xlsx` | `/libro/contralor` |
| Cumplimiento de firma de cierres | `/api/cierres/reporte/xlsx` | `/cierres/reporte` |

The PDF exports are unchanged. There is no CSV export anymore.

## Rules

- **Layout** (`shared/xlsx/xlsx-report.ts`): the logo (`public/logo.png`) and
  "Farmacia San Jorge", the report title, a one- or two-sentence description
  of what the export contains (required, written in each route), "Fecha de emisión" (dd/mm/aaaa hh:mm)
  and "Filtros" (or "Sin filtros"); a brand-green rule; the column header in
  brand green with white bold text, frozen and with auto-filter; zebra rows;
  subtotal/total rows and the truncation warning styled apart. Prints
  landscape, one page wide, header row repeated, "Página N de M" footer.
- **Typed cells**: dates are real Excel dates shown as dd/mm/aaaa (calendar
  days) or dd/mm/aaaa hh:mm (instants); quantities and amounts are numbers
  (amounts with `$`), so they sort, filter and sum, with the viewer's own
  decimal separator. Enum values use their UI labels.
- **Time zone**: instants are shown in `America/Argentina/Mendoza` (the
  schema default of `tenant.zona_horaria`), not yet the tenant's own zone.
- **Filtros** is the same summary the export's audit record stores
  (`resumenFiltroParaAuditoria` in each use case), so the file and the audit
  log always agree.
- **Audit**: every export still writes its EXPORTAR record before the file is
  returned; `formato` is now `"XLSX"` (older rows keep `"CSV"`).
- **Formula safety**: text is always stored as a string cell; the builder
  never writes formulas, so user text starting with `=`, `+`, `-` or `@` stays
  text.

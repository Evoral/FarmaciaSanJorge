# Control table: exportaciones-excel

Original: `git show 22ee3f1:openspec/specs/exportaciones-excel/spec.md`.

The original rules have no IDs, so the requirements have none (design §1).

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Intro: CSV → branded Excel, decided 2026-10-14, why | `## Purpose` | — | Verbatim. |
| Exports table; "PDF exports unchanged. No CSV export anymore." | "Excel instead of CSV" + `## Exports` (table verbatim) | "Exporting a list" (direct) | — |
| Layout, first half: logo, name, title, description, Fecha de emisión, Filtros, green rule | "Report heading" | "Export without filters" (direct) | **Stale, kept as written** — see below. |
| Layout, second half: green frozen header with auto-filter, zebra, totals and truncation warning apart | "Table styling" | "Opening the workbook" (direct) | Layout split in three: the original was over the CLI's 500-character limit. |
| Layout, print: landscape, one page wide, header repeated, "Página N de M" | "Print setup" | "Printing a long report" (direct) | — |
| Typed cells: dates, numbers with `$`, viewer's separator, enum labels | "Typed cells" | "Summing a column", "Dates and enums" (direct) | — |
| Time zone: Mendoza, not yet tenant's own | "Time zone" | "Instant in the export" (direct) | — |
| Filtros = audit summary | "Filtros matches the audit record" | "Filtered export" (direct) | — |
| Audit: EXPORTAR before the file, `formato` XLSX, older CSV | "Audit before the file" | "Export audited" (direct) | — |
| Formula safety | "Formula safety" | "Text that looks like a formula" (direct) | — |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

## Conflict found (not fixed here, design: "a rule that looks wrong is reported")

"Report heading" says the banner carries `public/logo.png` and "Farmacia San Jorge". `logo-farmacia` R7 (revised
2026-10-23, later than this spec) says every XLSX banner, footer and author are the tenant's own name and logo,
"never a fixed brand". The code follows R7: `shared/xlsx/xlsx-report.ts` writes `options.farmacia` as banner name,
creator and footer, and draws `options.logo`. This spec is stale on that point; fixing it is a rule change to
make in its own commit.

`openspec validate exportaciones-excel --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-25)

Independent review (separate agent): APPROVE. Code confirms the R7 conflict above.
Fixed: the "Formula safety" scenario said the cell holds "that text"; `textoSeguro` prefixes `'` to text
starting with `=`, `+`, `-`, `@`, tab or CR (P4-03), so the scenario now only asserts a string cell.

Pre-existing gap, kept as written: the requirement does not mention the `'` prefix (P4-03).

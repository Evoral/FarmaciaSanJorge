# Control table: costos-proveedor

Original: `git show 1916dcb:openspec/specs/costos-proveedor/spec.md`.

R1–R37 keep their IDs. Rules over the 500-character limit were split into several requirements that all carry the
same ID (R14 ×4, R15 ×2, R16 ×2, R18 ×2, R19 ×2), so a code citation such as "R15" still finds its text. The test
cases CP1–CP19 are cited by code and tests (e.g. `tests/db/costos-proveedor.test.ts` "CP17", `importar-lista-precios.ts`
"CP8-CP10"): each keeps its ID as a scenario name under the rule it illustrates; a case covering two rules is split
(CP12 under R25 and R28, CP17 under R1 and R2, CP19 under R35 and R36). The "Enforced in" column moved verbatim to
`## Enforcement`. The interface rules have no IDs, so their requirements have none. No number was computed: CP1's
values (40.898 $/kg → 0,040898 $/mg, 40,898 $/g) are the original's.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status paragraph | `## Status` (verbatim) | — | — |
| Goal (paragraph + "This feature adds" list) | `## Purpose` (verbatim) | — | "Approved 2026-10-15 (see Status)." added; the "## Goal" heading dropped. |
| Vocabulary | `## Vocabulary` (verbatim) | — | — |
| Current behaviour (audited 2026-10-15) | `## Current behaviour` (verbatim) | — | — |
| R1 | R1 | CP17, second vigente (direct); CP17, RLS isolates tenants (direct, added in review) | — |
| R2 | R2 | CP4 (direct); CP17, UPDATE/DELETE (direct) | — |
| R3 | R3 | "Manual entry" (**derived**) | "Stored per version:" written "Each version SHALL store:". |
| R4 | R4 (formula in the text) | CP1 (direct) | — |
| R5 | R5 | CP2 (direct) | "must" written "MUST". |
| R6 | R6 | "Droga measured by mass" (**derived**) | — |
| R7 | R7 | "Price labels" (**derived**, from its Enforced-in "UI labels say 'sin IVA'") | — |
| R8 | R8 | "Price dated tomorrow" (**derived**) | "can not be after" written "MUST NOT be after". |
| R9 | R9 | CP5 (direct) | — |
| R10 | R10 | CP6 split in two (direct) | — |
| R11 | R11 | "Baja without motivo", "Baja with motivo" (**derived**) | — |
| R12 | R12 | "Proveedor de baja" (**derived**) | — |
| R13 | R13 | "Reading a list" (**derived**) | — |
| R14 | "R14 — Accepted formats, detected by signature", "R14 — Readers", "R14 — Unsupported files", "R14 — Dates and PDF" | "OLE2 file named .xlsx" (direct, from Decisions "The signature decides the format"); "Same list as .xls and .xlsx", "Encrypted .xls", "Unreadable file", "PDF list" (**derived**) | Split in four (500-character limit). "Not supported, with their own message" written "SHALL be refused with their own message"; "PDF is not read" written "PDF SHALL NOT be read". "Unreadable file" is limited to OLE2 files: the .xlsx reader says "no parece un .xlsx válido" (`leer-xlsx.server.ts`). |
| R15 | "R15 — File validation before parsing", "R15 — Body limit and .xls bounds" | "File over 4 MiB", "Too many rows", "Cyclic sector chain" (**derived**) | Split in two. |
| R16 | "R16 — Base rows of the received layout", "R16 — Ignored rows, columns and sheets" | CP11 (direct); "Workbook with several sheets" (**derived**) | Split in two. CP11 also covers the ignored rows of the second part. |
| R17 | R17 | "Text with no match" (**derived**) | — |
| R18 | "R18 — Row states", "R18 — Variation shown" | CP3, CP7 (direct); "Large variation" (**derived**) | Split in two. |
| R19 | "R19 — Preview edits", "R19 — Nuevo insumo" | "Remembering an equivalence", "Creating the droga from the row", "Without `drogas.crear`" (**derived**) | Split in two. |
| R20 | R20 | CP8 (direct) | — |
| R21 | R21 | CP9 (direct) | "can not be imported" written "MUST NOT be imported". |
| R22 | R22 | "Partial list" (**derived**) | — |
| R23 | R23 | CP10 (direct) | — |
| R24 | R24 | "Manual price with an older date" (**derived**: "same validation" applied to R9) | — |
| R25 | R25 | CP12, cost part (direct) | — |
| R26 | R26 | CP14 (direct) | — |
| R27 | R27 | CP13 (direct) | — |
| R28 | R28 | CP12, esIncompleta/faltante part (direct) | — |
| R29 | R29 | "Manual enrase with a costo de proveedor" (**derived**) | — |
| R30 | R30 | "Two ítems with the same proveedor-costed droga" (**derived**) | — |
| R31 | R31 | CP15 (direct) | — |
| R32 | R32 | CP16 (direct) | — |
| R33 | R33 | "New list after a cotización" (**derived**) | — |
| R34 | R34 | CP18 (direct) | — |
| R35 | R35 | CP19, read part (direct) | — |
| R36 | R36 | CP19, write part (direct) | — |
| R37 | R37 | "User without stock.valorizado.ver" (**derived**) | — |
| "Enforced in" column R1–R37 | `## Enforcement` (verbatim) | — | — |
| Interface: sidebar, route, tabs | "Section and tabs" | "Opening the section" (**derived**) | — |
| Interface tab 1 Vigentes | "Vigentes tab" | "Filtering by proveedor" (**derived**) | — |
| Interface tabs 2–3 | "Importar lista and Listas importadas tabs" | "After an import" (**derived**) | "R13–R23." written "SHALL implement R13–R23". |
| Interface tab 4 Historial | "Historial tab" | "Pair with two versions" (**derived**) | — |
| Interface: breadcrumbs, reuse `shared/ui` | "Breadcrumbs and shared UI" | "Any tab" (**derived**) | — |
| Interface: cotización detail, presupuesto panel | "Fuente in the cotización detail" | "PROVEEDOR línea without stock", "PARTIDAS línea" (**derived**) | — |
| Data model (migration 0079) + paragraph | `## Data model (migration 0079)` (verbatim) | — | R3 cites it. |
| Code (planned) | `## Code (planned)` (verbatim) | — | — |
| Decisions | `## Decisions` (verbatim) | — | — |
| Out of scope | `## Out of scope` (verbatim) | — | — |
| Open | `## Open` (verbatim) | — | — |
| Test cases CP1–CP19 | Scenarios named with their IDs | — | No separate test-case section is kept (precedent: sinonimos-droga). |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

## Conflicts and stale points (kept as written)

- `## Code (planned)`: the feature is implemented (Status), so "planned" is stale.
- R15 says `next.config.ts` `serverActions.bodySizeLimit`; the key is `experimental.serverActions.bodySizeLimit`
  (`4_227_072` = 4 MiB + 32 KiB, as the rule says). The test the rule cites exists (`tests/unit/archivo-receta-pdf.test.ts`).
- Checked against code, no conflict: `MAX_LISTA_BYTES = 4 * 1024 * 1024`, `MAX_FILAS_LISTA = 5000`, R4 rounding
  `toDecimalPlaces(10, ROUND_HALF_UP)`, R18 highlight `abs(variación) > 50`, R14 messages in `leer-xls.server.ts`.
- R37 cites `reglas-precio.md`; the file is now `openspec/specs/reglas-precio/spec.md`.

`openspec validate costos-proveedor --type spec --strict`: valid (CLI 1.14.1). 50 requirements, 58 scenarios.

## Review (2026-10-26)

Independent review (separate agent): CHANGES NEEDED → fixed. R1-R37, CP1-CP19, all limits, rounding, boundaries,
messages and permisos match the original; the split rules lost nothing; 30+ scenarios confirmed in code.
Fixed: CP17's element "RLS isolates tenants" had been dropped (`tests/db/costos-proveedor.test.ts` cites it);
it is now a CP17 scenario under R1.

Pre-existing, kept as written:
- R7 "Price labels": the forms and the import column say "sin IVA", but the Vigentes list says it only in the
  page description and the cotización detail not at all.
- The "PARTIDAS línea" scenario is as unconditional as the original; `cotizacion-detalle.tsx` shows the label
  only when `fuenteRegistrada && !esEnraseManual && (partidas.length>0 || faltante)`.
- R10 says it "matters for R16"; the code (`planVersionar`) ties it to R26.
- `## Code (planned)` lists `application/listar-listas.ts` (the file is `listar-listas-precio.ts`) and omits
  `importar-lista-precios.ts`; the Enforcement column for R13/R20/R23 names `registrarCostosProveedor`, but the
  import confirm runs in `importarListaPrecios` → `registrarFilasEnTx`.
- R15's `serverActions.bodySizeLimit` is `experimental.serverActions.bodySizeLimit` (value `4_227_072` = 4 MiB +
  32 KiB multipart margin).

## Split for the CI gate (tanda 10)

Rules over the 500-character limit split into requirements that each state one behavior, keeping original wording:

| Original | Split into | Scenarios | Note |
|---|---|---|---|
| R7a | "R7a — Both prices stored with IVA", "R7a — Alícuota default and inheritance", "R7a — Price display with IVA" | "Both prices stored with IVA" (direct); "A product at 10,5 %" (direct); "Price display with IVA" (derived) | Split in three (500-character limit). |
| R32 | "R32 — Snapshot in cotizacion.detalle", "R32 — Detalle without fuente or subtotalConIva" | "Snapshot stored in cotizacion.detalle" (derived); CP16 (direct) | Split in two (500-character limit). |

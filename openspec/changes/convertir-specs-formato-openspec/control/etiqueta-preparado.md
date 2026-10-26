# Control table: etiqueta-preparado

Original: `git show 8e1ac1c:openspec/specs/etiqueta-preparado/spec.md`.

R1–R9 keep their IDs and the original order (R8 before R7, as in the original). Split: R1 ×2 (border and top band;
body and footer, opening "Below the R1 top band"), R4 ×2 (units per day; posología as written and the fracción,
opening "the R4 "Dosis:""). The "Code" column moved verbatim to `## Code`. The intro paragraph is restated as "Copy
of the farmacia's real label"; the placement paragraph is kept verbatim in `## Placement` (a pointer to
hoja-etiquetas plus the scope sentence) and cited from `## Purpose`. The original has no test cases.

Numbers computed by the converter: R4 "N veces al día" (cápsulas, `fraccion_dosis_por_unidad` 1, "3 veces al día":
1 / 1 × 3 = "3 cáp/día"; the "cáp/día" format comes from the original's example and `dosisEtiqueta`).

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Intro (copy of the real label, 2026-10-19; earlier rules still apply) | "Copy of the farmacia's real label" | "Etiqueta printed" (direct) | — |
| R1 | "R1 — Layout: border and top band", "R1 — Layout: Rp/, the right column and the footer" | three (direct) | — |
| R2 | R2 | "Missing field" (**derived**: celular as the example); "Long text", "Long dosis" (direct) | — |
| R3 | R3 | "Phones edited" (**derived**) | — |
| R4 | "R4 — Dosis as units per day", "R4 — Posología as written, and the fracción" | "Media dosis cada 12 horas", "No frequency", "Half-dose cápsulas" (direct); "N veces al día" (**derived**, computed), "Crema" (**derived**: not in the list of forms counted in units), "Whole-dose cápsulas" (**derived**) | — |
| R5 | R5 | direct | — |
| R6 | R6 | direct | — |
| R8 | R8 | both (direct) | Kept before R7. |
| R7 | R7 | both (direct) | — |
| R9 | R9 | three (direct) | — |
| Placement paragraph | `## Placement` (verbatim) | — | — |
| "Code" column | `## Code` (verbatim) | — | — |
| Rollback line | `## Rollback` (verbatim) | — | — |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

Derived scenarios: 5 of 23.

## Conflicts and stale points (kept as written)

- R1 cites `openspec/specs/logo-farmacia/spec.md` R6; after its conversion that is "R6 — Printed documents carry the
  tenant's logo" (still findable).
- R7's "The new fields" refers to the fields of this change (2026-10-19); R9 (2026-10-22) adds the "(ps)" mark to the
  snapshot later.
- Checked against `dosisEtiqueta` / `tomasPorDiaDePosologia`: units per day = tomas × doses per toma (0.5 for "media
  dosis", else 1) / fracción; falls back to the posología when the form has no unit or no frequency. No conflict.

`openspec validate etiqueta-preparado --type spec --strict`: valid (CLI 1.14.1). 12 requirements, 23 scenarios.
`chk.py` silent.

## Review (2026-10-26)

Independent review (separate agent): APPROVE. Rules, T1-T8 and computed numbers confirmed in code. Fixed: "the administrator" → a user with `config.editar`.

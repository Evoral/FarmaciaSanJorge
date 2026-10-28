# Control table: vencimiento-preparado

Original: `git show 8e1ac1c:openspec/specs/vencimiento-preparado/spec.md`.

R1–R14 keep their IDs and order. Split: R7 ×3 (format; persisted snapshot; older layout), R10 ×3 (dialog; one
Imprimir and the single-preparación form; selector default). Both "Enforced in" columns moved verbatim to one
`## Enforcement` table. The Goal is the Purpose (verbatim). Decisions: "Snapshot" is folded into R4 (its reason
quoted); "Counted from the confirmation's jornada" and the 60-month cap "both in the admin validator and when reading
the row" are restated as requirements without IDs; "Nullable column + no backfill" is R6's rule and reason. The
section stays verbatim. The original has no test cases.

Numbers computed by the converter (all in **derived** scenarios): R1 2026-10-07 + 3 months = 2027-01-07; R9
2026-10-21 + 35 days = 2026-11-25 and + 14 days = 2026-11-04 (October has 31 days); R12 2026-11-04 printed `Vence:
04/11/26` (matches the example in `formatearVenceEtiqueta`'s comment); R3 61 refused (> 60); R4 parameter 3 → 6.
R2's three dates and R7's `Vence: 03/27` come from the original.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status | `## Status` (verbatim) | — | Dates also in `## Purpose`. |
| Goal (two paragraphs) | `## Purpose` (verbatim) | — | Its rules are R1, R7, R9, R13. |
| R1 | R1 | "Estándar with the default 3 months", "Server date differs from the jornada" (**derived**) | — |
| Decisions › counted from the jornada | "Counted from the confirmation's jornada, not iniciada_en" | "Preparación started on an earlier day" (direct) | — |
| R2 | R2 | three (direct, the original's dates) | — |
| R3 | R3 | "Value above the cap" (**derived**); "Tenant without the row", "Out-of-range stored value" (direct) | — |
| Decisions › 60-month cap | "Cap enforced on edit and on read" | "Row above the cap" (**derived**) | — |
| R4 + Decisions › Snapshot | R4 | "Parameter edited after a confirmation" (**derived**: values) | The Decision's sentence is quoted in R4 ("Snapshot, not derived at print time: deriving it from `confirmada_en` + ..."). |
| R5 | R5 | "Change after confirmation" (direct); "Preparación not confirmed" (**derived**) | — |
| R6 + Decisions › no backfill | R6 | both (direct) | — |
| R7 | "R7 — Vence line format", "R7 — Every print lays out the persisted snapshot", "R7 — Older text layout" | four (direct) | Part 3 "Only an etiqueta stored in an older text layout ... is rebuilt" written "An etiqueta stored in an older text layout that does not parse SHALL be the only one rebuilt". |
| R8 | R8 | direct | — |
| R9 | R9 | "Aqueous with conservante", "Aqueous without conservante" (**derived**, computed); "No parameter for the day counts" (**derived**) | — |
| R10 | "R10 — Tipo chosen per ítem in the toma", "R10 — One Imprimir and the single-preparación form", "R10 — Selector default and when it is offered" | all seven (direct) | Part 2 names "the toma's "Imprimir etiquetas" dialog"; part 3 "The tipo de vencimiento selector". |
| R11 | R11 | both (direct) | — |
| R12 | R12 | "Aqueous without conservante" (**derived**, computed); "Legacy tipo" (direct) | — |
| R13 | R13 | "Aqueous without conservante" (direct); "Estándar" (**derived**: "instead of") | — |
| R14 | R14 | direct | — |
| "Enforced in" columns | `## Enforcement` (verbatim) | — | — |
| Decisions | `## Decisions` (verbatim) | — | — |
| Pending | `## Pending` (verbatim) | — | Not rules (especialidad medicinal cap, 90/180-day tipos not offered). |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

Derived scenarios: 11 of 37.

## Conflicts and stale points (kept as written)

- R10 cites "D8" without a file; it is D8 of `openspec/specs/libro-recetario-y-contralor/spec.md` ("Un asiento por
  receta", 2026-10-16).
- R7 (2026-10-15: every print lays out the persisted `etiqueta.contenido`) and `openspec/specs/etiqueta-preparado/spec.md`
  R7/R9 (new fields and the "(ps)" mark live in the snapshot) agree. No conflict.
- Checked against code: `MESES_VENCIMIENTO_PREPARADO_MAX = 60`; `formatearVenceEtiqueta` prints `DD/MM/YY` for the
  day-based tipos and `MM/YY` otherwise. No conflict.

`openspec validate vencimiento-preparado --type spec --strict`: valid (CLI 1.14.1). 20 requirements, 37 scenarios.
`chk.py` silent.

## Review (2026-10-26)

Independent review (separate agent): APPROVE. Rules, T1-T8 and computed numbers confirmed in code. Fixed: "the administrator" → a user with `config.editar`.

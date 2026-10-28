# Control table: hoja-etiquetas

Original: `git show 8e1ac1c:openspec/specs/hoja-etiquetas/spec.md`.

R1–R14 keep their IDs and order. Split: R5 ×3 (must fit; existing sizes that do not fit; no size fits), R7 ×2
(parameters; invalid cell or size), R11 ×3 (rows and carried cell; other sizes and closing; touched rows, from
Decision 6), R14 ×3 (one Imprimir/one PDF; opening the tab; all or nothing and reprint). Each later part names its
antecedent ("On the R7 PDF route", "In the toma dialog", "On the toma's first print"). The "Code (planned)" column
moved verbatim to `## Code (planned)`. The Why is the Purpose (verbatim). Goals, Non-goals, Anti-goals, the Data
model's code fallback, the Rollout's orientation sentence, Call 4 and the Decisions taken while implementing state
behavior: restated as requirements (no new IDs), sections kept verbatim. The original has no test cases; its Tests
section's grid examples are scenarios.

Numbers computed by the converter (all in **derived** scenarios), on the seeded sheet 210 × 297 mm, margin 5 mm
(usable 200 × 287 mm): R3 100 × 42 → floor(200/100) = 2 columnas, floor(287/42) = 6 filas (the "2 × 6 = 12 por hoja"
of R12); R4 60 × 40 size, cell (3, 2) → (5 + 2·60, 5 + 1·40) = (125, 45) mm, leftover 20 mm right / 7 mm bottom; R2
ancho 50, margen 20 → 50 − 40 = 10 accepted, margen 20,1 → 9,8 refused; R5 a 205 mm wide size does not fit; a 100 ×
297 / 5 mm sheet (usable 90) no longer fits 100 × 42; R7 `columna=3` is out of a 2-column grid; R8 summary "2 columnas
× 6 filas · 12 etiquetas por hoja". 200 / 100 = 2 and 3 × 66,7 = 200,1 > 200 → 2 come from the original.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status | `## Status` (verbatim) | — | Date also in `## Purpose`. |
| Why | `## Purpose` (verbatim) | — | Its rules are R3 and R6. |
| Goals 1–2 | `## Goals` (verbatim); rules R1, R8 | — | — |
| Goal 3 (same picker, both dialogs) | "Same picker in both print dialogs" | both (direct) | — |
| Non-goal: no memory of used cells | "No memory of used cells" | direct | — |
| Non-goal: no pre-cut sheets | "No pre-cut sheets" | "Sheet form" (**derived**) | — |
| Non-goal: no roll mode | "Every etiqueta prints on the sheet" | direct | — |
| Non-goal: no multi-etiqueta PDF | `## Non-goals` only (verbatim) | — | **Not restated as a requirement**: R14 (toma first print: every etiqueta in ONE PDF, each in its own cell of the same sheet) contradicts it. See Conflicts. |
| Non-goal: no change to WHAT is printed | "What is printed is unchanged" | direct | — |
| Anti-goal: exact position | "Exact cell position" | direct | — |
| Anti-goal: existing sizes | "Existing sizes keep working" | direct (100 × 42 from Why) | — |
| R1 + Call 1 | R1 | both (direct) | Call 1's reason ("most printers cannot print the outer few mm") added to R1. |
| Data model › Code fallback | "Missing sheet row" | both (direct) | — |
| R2 | R2 | "Ancho below the limit", "Usable area exactly 10 mm", "Usable area below 10 mm", "Comma input" (**derived**; two computed) | — |
| R3 | R3 | "Exact fit", "Near miss" (direct, from R3 and Tests); "Seeded A4 with a 100 × 42 size" (**derived**, computed) | — |
| R4 + Calls 2, 3 | R4 | "Column 3, row 2" (**derived**, computed); "Adjacent cells" (direct) | Call 3's "not centered on the sheet" added to R4. |
| Call 4 | "No rotation of the etiqueta" | direct | — |
| R5 + Calls 7, 8 | "R5 — A size must fit the sheet", "R5 — Existing sizes that do not fit", "R5 — No size fits" | "New size too wide", "Sheet shrunk under an active size" (**derived**, computed); the other three (direct) | — |
| Decision 1 | "Sheet edit blocked only by sizes that fit now" | "Enlarging the sheet with a non-fitting size" (**derived**) | — |
| Decision 2 | "Size checks against the sheet" | both (direct) | Conflicts with R5's "field error" for reactivation (see below). |
| Decision 4 | "Sheet and size locks" | "Size created during a sheet edit" (**derived**) | — |
| R6 | R6 | "60 × 40 size on A4" (**derived**) | — |
| Rollout: orientation sentence | "Orientation from the page size" | direct | — |
| R7 + Call 10 | "R7 — PDF route parameters" | three (direct) | — |
| R7 (invalid cell) + Decision 3 | "R7 — Invalid cell or size" | "Out-of-grid cell" (**derived**, computed), "Non-integer cell" (**derived**); "Size that does not fit" (direct) | — |
| R8 | R8 | "Dialog opened" (**derived**, computed); two (direct) | — |
| R9 | R9 | "Keyboard" (**derived**; `posicion-en-hoja.tsx` maps ArrowRight to the next column) | — |
| R10 | R10 | direct | — |
| R11 + Calls 6, 9 | "R11 — Toma dialog rows", "R11 — Other sizes and closing the dialog" | four (direct) | Part 2's "Closing the dialog forgets it" written "forgets the carried cells". |
| Decision 6 | "R11 — Touched rows" | both (direct) | Carries R11's ID because the Decision is labelled "R11:". |
| R12 | R12 | "Seeded sheet" (**derived**: "2 × 6 = 12" tied to 100 × 42); "Sheet edit refused" (direct); "User without config.editar" (**derived**) | — |
| R13 | R13 | "Sheet edited", "Print dialog without config.ver" (**derived**) | — |
| Decision 5 | "Audit entity of the sheet" | direct | — |
| R14 | "R14 — Toma first print: one Imprimir, one PDF", "R14 — Opening the tab", "R14 — All or nothing; reprint per ítem" | "Three ítems of the same size", "Two ítems in the same cell" (**derived**); three (direct) | — |
| Call 5, Data model, "Why a dedicated table" | `## Data model (...)` (verbatim) | — | Implementation; "The sheet<->size fit (R5) is enforced in the use cases" is an enforcement note. |
| "Code (planned)" column | `## Code (planned)` (verbatim) | — | — |
| Code touched, Tests, Rollout | verbatim | — | — |
| Calls made without explicit confirmation | `## Calls made ...` (verbatim) | — | Each call is in the requirement named above. |
| Decisions taken while implementing | `## Decisions taken while implementing` (verbatim) | — | Each decision is in the requirement named above. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. One exception to
restating: the non-goal "No multi-etiqueta PDF" is kept verbatim in `## Non-goals` but not restated as a requirement,
because R14 contradicts it (below); the reviewer should confirm this call.

Derived scenarios: 22 of 61.

## Conflicts and stale points (kept as written)

- Non-goal "No multi-etiqueta PDF (several etiquetas on one sheet in a single print)" vs R14 (toma first print opens
  every etiqueta in ONE PDF, each in its own cell of the same sheet; `buildEtiquetasPdf`). R14 is the later rule and
  the code; the non-goal is stale.
- R5 says reactivating a size that does not fit "is rejected with a field error"; Decision 2 says it is "a plain domain
  error (the reactivation form has only the motivo, so there is no field to mark)". Both restated as written.
- Status says "migration 0096 pending to apply"; the repo has `20261021120000_0096_etiqueta_hoja` (and a second 0096,
  `20261021090000_0096_tipo_vencimiento_preparado`, hence the Data model's "re-check numbering"). Whether it was
  applied was not checked; the status line is likely stale. "Code (planned)" likewise predates the implementation.
- Goals' "one row per confirmed ítem" (toma dialog) vs `openspec/specs/vencimiento-preparado/spec.md` R10 and this
  R14, where the first print lists the ítems still to confirm. Goals predate R14.

`openspec validate hoja-etiquetas --type spec --strict`: valid (CLI 1.14.1). 35 requirements, 61 scenarios. `chk.py`
silent.

## Review (2026-10-26)

Independent review (separate agent): APPROVE. Rules, T1-T8 and computed numbers confirmed in code. Pre-existing, kept as written: non-goal "No multi-etiqueta PDF" vs R14 (pending user decision); R5 field error vs Decision 2 domain error (scenario follows Decision 2); "0096 pending to apply" stale.

# Control table: excipiente-preparacion

Original: `git show 8e1ac1c:openspec/specs/excipiente-preparacion/spec.md`.

English body and Spanish title kept. E1–E9 keep their IDs and order; E1 split in two (part 2 opens "The "Excipiente"
row of E1"). The "Enforced in" column moved verbatim to `## Enforcement`. The three Decisions state behavior and are
restated as requirements without IDs; the section stays verbatim. The original has no test cases and no computed
number was added.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status lines | `## Status` (verbatim) | — | Date also in `## Purpose`. |
| Goal | `## Purpose` (verbatim) | — | A sentence with the dates added. |
| E1 | "E1 — In the ficha, before Marcar como preparada", "E1 — Excipiente quantity in the unidad base" | "Pendiente ítem with the pesada en la ficha", "Text that matches no excipiente", "Quantity typed" (direct); "Droga of another clase", "No excipiente" (**derived**) | — |
| E2 | E2 | three (direct) | — |
| E3 | E3 | both (direct) | "is blocked" written "SHALL be blocked", with "with an excipiente chosen and no quantity" stating the heading's condition. |
| E4 | E4 | "Excipiente reserved" (**derived**: abierta/cerrada example); "Excipiente short of stock" (direct) | — |
| E5 | E5 | both (direct) | — |
| E6 | E6 | "Receta printed" (direct) | — |
| E7 | E7 | "Excipiente reserva" (direct); "Another droga without a línea" (**derived**: "allowed by the DB ONLY for") | — |
| E8 | E8 | both (direct) | — |
| E9 | E9 | both (direct) | — |
| Decisions › Lot | "Excipiente lot always automatic" | "No lot selector" (direct) | Same rule as E4's "oldest lot first, automatic". |
| Decisions › Unit | "Excipiente unit" | "Quantity field" (direct) | — |
| Decisions › before 0092 | "Reservations made before 0092" | "Older reserva" (direct) | — |
| Decisions (section) | `## Decisions` (verbatim) | — | — |
| "Enforced in" column | `## Enforcement` (verbatim) | — | — |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

Derived scenarios: 4 of 24.

## Conflicts and stale points (kept as written)

- E1 and E9 depend on the pesada en la ficha, whose lot choice conflicts with reserva-stock-preparacion's "Nobody
  picks partidas" (see `control/pesada-real.md`); the excipiente itself has no lot choice (Decisions), so no conflict
  here.
- E3's message "Falta la cantidad del excipiente" is in `pesaje-en-toma.tsx` (with a trailing ". "). No conflict.

`openspec validate excipiente-preparacion --type spec --strict`: valid (CLI 1.14.1). 13 requirements, 24 scenarios.
`chk.py` silent.

## Review (2026-10-26)

Independent review (separate agent): APPROVE. Rules, T1-T8 and computed numbers confirmed in code. 

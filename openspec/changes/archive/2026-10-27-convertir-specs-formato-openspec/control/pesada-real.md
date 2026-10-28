# Control table: pesada-real

Original: `git show 8e1ac1c:openspec/specs/pesada-real/spec.md`.

P1–P12 keep their IDs and order. Rules over the 500-character limit were split into requirements carrying the same
ID: P1 ×2, P3 ×3, P6 ×2, P8 ×2, P10 ×2, P11 ×2; each later part names its antecedent ("The split of a línea ... of
the P1 lot choice", "When `|real − esperada|` exceeds the P3 margen", "In the P8 lot selector", "A weighing draft
(`fsj.pesada_borrador`)", "The "Marcar como preparada" dialog"). Both "Enforced in" columns moved verbatim to
`## Enforcement`. The Goal is the Purpose (verbatim) and is also restated as "Real weighing of every non-manual
línea"; the "Pesada en la ficha" intro is restated as "Weighing in the ficha" (section kept verbatim; `schema.prisma`
and the toma page cite it); the Decision on triturados is restated as "Triturados and diluciones". The original has
no test cases.

Numbers computed by the converter: P3 "Small línea on a coarse balance" adds the condition 5 % (the Decision's
example states no tolerance) and 9 × 5 / 100 = 0,45 mg < 1 mg; P3 "Deviation equal to the margen" and "Pesada
outside the margen" (esperada 1,000 g, 5 %, 0,001 g balance: margen 0,050 g; 1,050 accepted, 1,051 outside). P2's
GIVEN "`precision_balanza` 0,001 g" is inferred from the original's examples (0,0455 → 0,046).

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status | `## Status` (verbatim) | — | Dates also in `## Purpose`. |
| Goal | `## Purpose` (verbatim) + "Real weighing of every non-manual línea" | "Non-manual línea confirmed" (direct) | — |
| P1 | "P1 — Lot choice for every línea", "P1 — Split over the checked lots and purity warning" | "Línea with several eligible partidas" (**derived**); "Enrase manual línea", "Recalculation", "Two lots checked", "Lots of different purity" (direct) | "in that order" written "in the order they are listed (abiertas first, then FEFO)". |
| P2 | P2 | "Prefill rounded half-up" (direct, precision inferred), "Volumen línea", "Lots changed before typing" (direct); "Lots changed after typing" (**derived**) | — |
| P3 | "P3 — Tolerance", "P3 — Outside the tolerance", "P3 — Tolerance parameter" | "Small línea on a coarse balance" (direct from Decisions, condition computed); "Deviation equal to the margen", "Pesada outside the margen" (**derived**, computed); "No co-firma", "Wrong DT password", "Default tolerance" (direct); "Edited in Parámetros" (**derived**) | Part 1 also states the Decision "the margen is never smaller than one balance division". |
| P4 | P4 | "Real weight over two lots" (**derived**) | — |
| P5 | P5 | both (direct) | — |
| P6 | "P6 — Record", "P6 — Consumption check and audit" | "Consumption differs from the pesada real" (**derived**); the other four (direct) | "INV-S12 then checks" written "For a línea with a `fsj.pesada_real` row, INV-S12 SHALL check". |
| P7 | P7 | direct | — |
| Pesada en la ficha intro | "Weighing in the ficha" + `## Pesada en la ficha (...)` (verbatim) | direct (permiso in GIVEN) | — |
| P8 | "P8 — Lot selector per línea", "P8 — Agregar otro lote" | "Option of an abierta lot por vencer" (**derived**: combines the per-condition attributes on one lot that meets every condition); the other four (direct) | — |
| P9 | P9 | three (direct) | — |
| P10 | "P10 — Saved as it is filled in", "P10 — What a weighing draft writes and who saves it" | seven (direct) | — |
| P11 | "P11 — Marcar como preparada only confirms", "P11 — Fields sent and the full form" | "Stock changed after the draft" (**derived**); the other four (direct) | — |
| P12 | P12 | both (direct) | — |
| "Enforced in" columns | `## Enforcement` (verbatim, one table) | — | — |
| Decisions | `## Decisions` (verbatim) | — | Bullet 1 (5 % default, "the DT should confirm" Farmacopea Argentina) is in P3 part 3; the "DT should confirm" is an open question, not a rule. Bullet 2 is in P3 part 1 and its scenario. Bullet 3 restated as "Triturados and diluciones" (direct). |
| Open | `## Open` (verbatim) | — | Not a rule (see stale point). |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

Derived scenarios: 9 of 50.

## Conflicts and stale points (kept as written)

- P1, P8 and P11 have the user see and choose the lots (pre-checked / preselected with the automatic plan's,
  "Agregar otro lote"). `openspec/specs/reserva-stock-preparacion/spec.md` still says "Nobody picks partidas" (its
  Decision section and the requirement "R1 — Nobody picks partidas"), its Flow "Marcar como preparada" dialog "shows
  the automatic plan read-only", R25 "none checked", and its Decisions "The partida pickers ... were removed". Already
  recorded in `control/reserva-stock-preparacion.md`; recorded here from this side.
- `## Open` says the DT co-firma's vigency is checked "on the confirmation's server date"; P6 and migration 0103
  (`0103_pesada_real_jornada`: `fsj.es_dt_vigente(..., fsj.jornada_actual(tenant_id))`) check it on the farmacia's
  jornada. The Open item is stale.
- The Goal and P1 speak of "the form" of "Marcar como preparada"; since P11 that dialog only confirms and the full
  form (`confirmar-form.tsx`) remains for "Recalcular reserva" and `/preparaciones/[id]`.
- `openspec/specs/ficha-tecnica/spec.md` INV-S12 still says a non-manual línea consumes exactly `cantidadAPesar`;
  P6 overrides it for a línea with a pesada real row (recorded in `control/ficha-tecnica.md`).

`openspec validate pesada-real --type spec --strict`: valid (CLI 1.14.1). 22 requirements, 50 scenarios. `chk.py`
silent.

## Review (2026-10-26)

Independent review (separate agent): APPROVE. Rules, T1-T8 and computed numbers confirmed in code. Fixed: P8 "the older first" → consumption order (abiertas first, then FEFO); "in the order they are listed" → "in that order" as the original; "the administrator" → a user with `config.editar`. Pre-existing: P1/P8/P11 vs reserva-stock "Nobody picks partidas"; `## Open` cites the server date, 0103 checks `fsj.jornada_actual`.

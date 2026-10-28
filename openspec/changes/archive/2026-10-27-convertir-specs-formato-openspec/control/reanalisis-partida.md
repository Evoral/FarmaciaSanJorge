# Control table: reanalisis-partida

Original: `git show 21bf0e2:openspec/specs/reanalisis-partida/spec.md`.

R1–R12 keep their IDs. Rules over the 500-character limit were split into requirements that carry the same ID
(R6 ×2, R8 ×2, R11 ×3). The "Enforced in" column moved verbatim to `## Enforcement`. The original has no test
cases. Numbers computed by the converter: R10 "Partida at the end of the alert window" / "beyond" (jornada + 30
is por vencer, jornada + 31 is not, from Vocabulary "jornada ≤ vencimiento vigente ≤ jornada +
`dias_alerta_vencimiento_partida` (default 30)"); R5 "Vencimiento vigente equal to the jornada" (not vencida, from
Vocabulary "vencimiento vigente < jornada actual").

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status paragraph | `## Status` (verbatim) | — | Date also cited in `## Purpose`. |
| Goal | `## Purpose` (verbatim) | — | "Implemented 2026-10-12 (see Status)" and a pointer to `## Vocabulary` added; the "## Goal" heading dropped. |
| Vocabulary (incl. the vencida / por vencer boundaries) | `## Vocabulary` (verbatim) | — | Cited from `## Purpose`; R5 and R10 scenarios use its boundaries. |
| R1 | R1 | "Reanálisis of an insumo partida" (**derived**); "Expired insumo partida" (direct) | "can be" written "SHALL be". |
| R2 | R2 | "Two partidas of the same droga" (**derived**) | "Scope is" written "SHALL be". |
| R3 | R3 | "New date equal to the jornada actual" (**derived**: "strictly after"); "Reanálisis without motivo or respaldo", "Vigente partida re-analysed again" (direct); "Partida without saldo" (direct, from Decisions "The DB refuses a reanálisis without saldo (INV-S22)") | — |
| R4 | R4 | "Reanálisis recorded" (direct); "Changing a reanálisis row" (**derived**: `forbid_update_delete` read as a refusal); "Changing the printed date" (direct, from Enforcement › R4 INV-S23) | "is never overwritten" written "MUST never be overwritten". |
| R5 | R5 | "Vencida droga partida" (direct); "Vencimiento vigente equal to the jornada" (**derived**, boundary from Vocabulary); "Re-analysed partida" (direct, from Goal "usable again until the new date") | — |
| R6 | "R6 — Marcar como vencida", "R6 — Reserved stock; terminal partida" | "The DT marks a vencida partida" (direct); "Por vencer partida" (direct, from Decisions "offered only for an already vencida partida"); "Partida with stock reserved" (direct); "After marking it as vencida" (**derived**: terminal = saldo 0 and Decisions' INV-S22 refusal) | Split at "Stock reserved". "Marcar como vencida: on ..., after a warning ..., registers" written "**Marcar como vencida**, on ..., SHALL register, after a warning ..., an AJUSTE"; "the ajuste refuses it" written "the ajuste of "Marcar como vencida" SHALL refuse it". |
| R7 | R7 | "Suplente DT" (direct; permiso `stock.ajuste.autorizar` from Enforcement › R7); "User who is not the DT vigente", "Wrong password" (**derived**; "failed attempts audited" comes from Enforcement › R7) | — |
| R8 | "R8 — Expiry reads use the vencimiento vigente", "R8 — Listings that use the vencimiento vigente" | "Re-analysed partida in the preparation flow" (**derived**); "Re-analysed partida in the listings" (direct) | Split in two at `/partidas`; the second part says "The vencimiento vigente SHALL also be used by". Every item of the list kept. |
| R9 | R9 | "Re-analysed partida" (direct); "Partida never re-analysed" (**derived**: "the original date when they differ") | "Partida detail (...): ..." written "The partida detail (...) SHALL show". |
| R10 | R10 | "Partida at the end of the alert window", "Partida beyond the alert window" (**derived**, computed); "Home card" (direct) | "Por vencer warnings: ..." written "SHALL be shown in: ...". |
| R11 | "R11 — Vencida shown to everyone: home and notification bar", "R11 — Vencimientos tab, stock note, detail banner, buttons", "R11 — Blocked partida visible in the preparation flow" | "Session with cierres.ver and stock.ver", "Session without cierres.ver", "Viewer who is not the DT", "DT vigente in Vencimientos", "Vencida partida in the reserva form", "Reserved partida that expired" (direct) | Split in three; the second part opens "Vencida — requiere acción del DT SHALL also be shown in". Permission-dependent links and buttons carry the permisos/role in GIVEN. |
| R12 | R12 | "Reanálisis of a partida" (**derived**) | "is unrelated and unchanged" written "SHALL stay unrelated and unchanged". |
| "Enforced in" column R1–R12 | `## Enforcement` (verbatim) | — | — |
| Decisions | `## Decisions` (verbatim) | — | Cited by R3, R6 scenarios. |
| Code | `## Code` (verbatim) | — | — |
| Open | `## Open` (verbatim) | — | — |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

Derived scenarios: 13 of 34.

## Conflicts and stale points (kept as written)

- R10 calls the form "the reserva / confirmation / modificar reserva form"; `reserva-stock-preparacion` renamed the
  action "Recalcular reserva" (formerly "Modificar reserva").
- R10 and R11 describe the reserva/pesar step from before `openspec/specs/pesada-real/spec.md` (the toma now weighs
  in `ui/pesaje-en-toma.tsx`); the files they cite still exist (`lineas-ficha-tabla.tsx`, `confirmar-form.tsx`).
  Not checked whether the por vencer badge and the "No disponible" listing also appear in the pesada-real UI.
- Checked against code, no conflict: VENCIDA = vigente < jornada and POR_VENCER = jornada ≤ vigente ≤ jornada +
  días, both ends included (`estadoVencimientoPartida`, `estaVencida`); permiso `stock.ajuste.autorizar` on
  `reanalizar-partida.ts` and `marcar-partida-vencida.ts`; `openspec/specs/vencimiento-preparado/spec.md` exists.

`openspec validate reanalisis-partida --type spec --strict`: valid (CLI 1.14.1). Every requirement text parsed by
the CLI matches the file (no dropped line).

## Review (2026-10-26)

Independent review (separate agent): CHANGES NEEDED → fixed. Rules, day counts and boundaries confirmed in code
(`estadoVencimientoPartida`: VENCIDA when vigente < jornada, POR_VENCER when vigente <= jornada + días; new date
refused when <= jornada; default 30). Fixed, all introduced by the conversion:
- R1 "Expired insumo partida" made the zeroing the result of a use attempt; it is now the rule's own statement
  (re-marked derived: it restates "expired = unusable; zeroed with a normal VENCIMIENTO ajuste").
- R10 alert-window scenarios used the pesar step, whose current UI (`pesaje-en-toma.tsx`) shows "vence <fecha>"
  text, not the badge; they now use the reserva / confirmation form (`confirmar-form.tsx`), which has it.
- R8 "Re-analysed partida in the listings" applied every attribute to every listing; it now gives each listing
  its own attributes as the original does (re-marked derived).

Closed: the pesada-real check is done; the "No disponible" listing is in `lineas-ficha-tabla.tsx`, and the R10
"pesar step" wording is stale (pre-existing, kept as written).

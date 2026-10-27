# Control table: reserva-stock-preparacion

Original: `git show 21bf0e2:openspec/specs/reserva-stock-preparacion/spec.md`.

R1, R1b, R2–R6, R6b, R8–R26 and R7 keep their IDs and the original order (R7 stays last, after R26, as in the
original; there is no R7 between R6b and R8). Rules over the 500-character limit were split into requirements that
carry the same ID: R1 ×6 (two of them restate the Decision section's rules), R1b ×2, R2 ×2, R5 ×2, R6b ×2, R9 ×3, R10 ×2, R12 ×4, R13 ×4, R14 ×2, R18 ×5, R19 ×2,
R20 ×2, R21 ×2, R23 ×3, R25 ×5, R26 ×3. The Flow table rows have no IDs, so their requirements ("Toma workspace —
...") have none; their "Command" column moved verbatim to `## Flow commands`. The "Enforced in" column moved
verbatim to `## Enforcement`. The original has no test cases.

Numbers computed by the converter (all in **derived** scenarios): R3 1000 mg − 400 mg reserved by others = 600 mg
available; R5 600 mg saldo − 200 mg other reservas = 400 mg < 500 mg reserved → flagged; R8 1000 mg − 300 mg
reserved = 700 mg free, an ajuste of 800 mg refused with X = 300 mg, Y = 700 mg; R12 1,5 g = 1500 mg (only for an
enrase manual línea or a partida of 100 % purity: `reservasDelPlan` stores the purity-corrected quantity). The "Ítem 2"
and "ítem N" values come from the original.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status paragraph | `## Status` (verbatim) | — | Dates also cited in `## Purpose`. |
| Goal | `## Purpose` (verbatim) | — | A sentence with the dates (2026-10-08, 2026-10-15, 2026-10-18) added; the "## Goal" heading dropped. |
| Decision: automatic reserva (DT decision, 2026-10-15) | `## Decision: automatic reserva (DT decision, 2026-10-15)` (verbatim) + "R1 — Consumption order and eligible partidas", "R1 — Nobody picks partidas" | "Two abiertas", "Two cerradas", "Re-analysed partida" (**derived**); "Línea of equal purities", "Línea of different purities" (direct) | Cited from `## Purpose`. Kept verbatim and also restated as two R1 requirements (review fix 1): "oldest apertura first", "Not by ingreso date", "vencimiento vigente (INV-S10, reanálisis-aware)" and "Nobody picks partidas -- not when reserving, not when recalculating, not on `/preparaciones/[id]`'s confirmation" were stated by no requirement. "Nobody picks partidas" conflicts with pesada-real (see below), kept as written. |
| Flow intro: no re-authentication (2026-10-21), `ReauthAwareForm` | "Toma workspace — no re-authentication" | "Marking an ítem as preparada" (direct) | — |
| Flow row Pendiente, ficha vigente | "Toma workspace — Marcar como preparada offered", "— Marcar como preparada dialog", "— what Marcar como preparada writes" | "Pendiente ítem with a vigente ficha", "Dialog with an enrase línea", "Línea without enough stock", "Ítem marked as preparada" (direct) | Split in three: Action column (two parts) and "What it writes". Command → `## Flow commands`. "(a one-click path when nothing must be typed is PENDING)" moved verbatim to `## Pending`; the requirement says "(a one-click path is pending, see `## Pending`)". |
| Flow row Pendiente, Ficha desactualizada | "Toma workspace — Ficha desactualizada" | "User with fichas.generar", "User without fichas.generar" (direct, permiso in GIVEN) | "What it writes" ("A new ficha version.", whose subject was the `fichas.generar` command) written "`fichas.generar` writes a new ficha version." |
| Flow row Stock reservado › Recalcular reserva | "Toma workspace — Recalcular reserva", "— what Recalcular reserva writes" | "Recalcular from the toolbar", "Recalcular from the alert", "Reserva recalculated" (direct) | Split in two. |
| Flow row Stock reservado › Registrar pérdida | "Toma workspace — Registrar pérdida" | "Pérdida registered" (direct; ROTURA picked from the two motivos) | — |
| Flow row Stock reservado › Liberar reserva | "Toma workspace — Liberar reserva" | "Reserva released" (direct) | — |
| Flow row Receta › Imprimir etiquetas | "Toma workspace — Imprimir etiquetas button", "— Imprimir etiquetas disabled", "— what Imprimir etiquetas writes", "— after Imprimir etiquetas" | "Every ítem reserved", "An ítem still Pendiente", "A reserva that no longer fits", "Receta printed", "Confirmation succeeds" (direct) | Split in four. "A reserva that no longer fits" instantiates "ítem N" as ítem 2. |
| Flow row Receta (nothing left to confirm) › reprint | "Toma workspace — reprint" | "Reprinting" (direct) | Command ("— (each row prints through ...)") → `## Flow commands`. |
| Flow: ítem labels, "Confirmación en curso" | "Toma workspace — ítem labels" | "INICIADA preparación without reservas" (direct) | — |
| R1 | "R1 — Candidates and locks", "R1 — The split and its checks", "R1 — Where the planning is used", "R1 — Partidas locked" | "Ficha with two líneas and an excipiente", "Two líneas short of stock", "Imprimir etiquetas" (direct); "Abierta and cerrada partidas", "Ficha whose drogas have three eligible partidas" (**derived**) | Split in four. "This planning SHALL be used by" opens part 3. Two more R1 requirements restate the Decision section (row above). |
| R1b | "R1b — Recalcular reserva counts its own reservas", "R1b — Out-of-date ficha and locks" | "Partida fully reserved by this preparación" (**derived**); "Enrase quantity not sent", "Ficha desactualizada" (direct) | Split in two; "It refuses" written ""Recalcular reserva" SHALL refuse". |
| R2 | "R2 — One row per partida drawn", "R2 — Older rows and desvío" | "Línea drawn from two partidas" (**derived**); "Row with cantidad 0 from before 2026-10-15", "Stock unchanged since the reserva" (direct) | Split in two. |
| R3 | R3 | "Partida partly reserved by another preparación" (**derived**, computed) | "is not available" written "SHALL NOT be available". |
| R4 | R4 | "Preparación confirmed", "Preparación released" (direct) | — |
| R5 | "R5 — Imprimir etiquetas never changes a reserva", "R5 — La reserva ya no alcanza" | "Stock changed after the reserva", "Reserved partida expired" (direct); "Reserved quantity above the free saldo" (**derived**, computed) | Split in two. Part 2's "flag such an ítem up front" written "flag up front an ítem whose reserva no longer fits the stock" (review fix 4). |
| R6 | R6 | "Reserving", "First confirmation" (direct) | — |
| R6b | "R6b — A live preparación blocks editing", "R6b — After editing" | "Receta with stock reserved", "After Liberar reserva", "Edit by a user with fichas.generar" (direct); "Direct database delete" (**derived**, from Enforcement › R6b INV-R11 and migration 0072) | Split in two. The DB scenario was "Direct database update", overbroad (review fix 3): `receta_assert_editable` guards only `item_receta` / `componente_item_receta` DELETEs, and only while the receta is PENDIENTE_PREPARACION. |
| R8 | R8 | "Ajuste larger than the free part" (**derived**, computed) | — |
| R9 | "R9 — Locks of Registrar pérdida", "R9 — Partida and reserva consumed", "R9 — Re-plan after the pérdida" | "Pérdida registered", "Droga still has the stock", "Droga lacks the stock" (direct); "Partida not reserved by the preparación", "Partida reserved by another preparación too" (**derived**) | Split in three; "The partida must be one" written "The partida of a pérdida MUST be one"; part 3's "Then the reserva" written "After the pérdida's AJUSTE, the reserva" (review fix 4). |
| R10 | "R10 — A pérdida needs the DT's authorization", "R10 — Credential and permiso" | "Pérdida without a DT vigente as authorizer", "User with preparaciones.confirmar only" (**derived**) | Split in two. |
| R11 | R11 | "Partida with stock reserved in the valorizado" (direct) | — |
| R12 | "R12 — Stock quantities in the droga's unidad base", "— Línea quantities in the magnitud's base unit", "— Línea unit kept; other magnitud refused", "— Displays" | "Línea in g, droga in mg" (**derived**, computed); "Línea of another magnitud" (**derived**: example); "Enrase quantity typed", "Faltante message", "Quantity in the dialog" (direct) | Split in four. "Línea in g, droga in mg" now states in GIVEN that the línea is enrase manual or reserved from a partida of 100 % purity (review fix 2). |
| R13 | "R13 — Imprimir etiquetas confirms the whole receta", "— One transaction, one asiento", "— Lock order of Imprimir etiquetas", "— Audit and reprinting" | "An ítem without reserva", "Nothing left to confirm", "Ítem 2 fails" (the original's example), "Reserva made during the print", "Receta printed", "Reprint dialog" (direct); "Two ítems confirmed" (**derived**) | Split in four. |
| R14 | "R14 — Reserved preparación confirmed only from the toma workspace", "R14 — Descartar refuses a reserved preparación" | all three (direct) | Split in two. |
| R15 | R15 | "An ítem with stock reservado" (**derived**) | — |
| R16 | R16 | "Ficha técnica screen" (direct, from the Flow ítem labels "former "Preparar", removed by R16") | — |
| R17 | R17 | "Taken PREPARADA receta" (direct); "ANULADA receta" (**derived**: "any other estado") | — |
| R18 | "R18 — Vigente ficha", "— Same staleness rule as the regeneration", "— Recomputation chosen over timestamps", "— Unverifiable ficha; refusal and toma display", "— Editing does not generate fichas without fichas.generar" | "Older ficha version", "Ítem data changed", "Edit that leaves an ítem unchanged" (**derived**); "Weighing parameter changed", "Droga dada de baja", "Reserving on a desactualizada ficha", "Editor without fichas.generar" (direct) | Split in five. "Chosen over timestamps because" written "Staleness SHALL be decided by recomputation, chosen over timestamps because" (Decisions: "Ficha staleness by recomputation, not timestamps (R18)"). |
| R19 | "R19 — At most one live preparación per ítem", "R19 — Database backstop" | "Live preparación on an older ficha version", "Second live preparación inserted" (direct); "Stale dialog" (**derived**) | Split in two. |
| R20 | "R20 — No new ficha version while a preparación lives", "R20 — Toma shows the live preparación's ficha" | all three (direct) | Split in two. |
| R21 | "R21 — Partidas para pesar of a Pendiente ítem", "R21 — Same computation; reserved ítem; draft preview" | all five (direct) | Split in two. |
| R22 | R22 | "Asiento anulado", "Seleccionar etiquetas" (direct) | — |
| R23 | "R23 — Lock order", "R23 — Lock order per command", "R23 — Other writers" | "Any path", "Confirmation from /preparaciones/[id]" (direct); "Pérdida and Imprimir etiquetas at the same time" (**derived**) | Split in three; part 2 opens "The commands SHALL lock as follows.", part 3 "Other writers SHALL lock:". |
| R24 | R24 | "Receta annulled before the reserva commits" (**derived**); "Confirmation of an ANULADA receta" (direct) | — |
| R25 | "R25 — Different purities: the user chooses the lot", "— Why, and the lot checkboxes", "— Split over the checked lots", "— Server handling of the chosen lots", "— Defaults and exceptions" | "Lot of 98 % and lot without potencia declarada" (**derived**); the other nine (direct) | Split in five. The "Superseded in part" note stays in the first part. The reason ("the lab weighing from another bottle ... dose wrong") did not fit the first part and opens the second: "The automatic plan is not enough because ...". Part 1's "the automatic plan SHALL NOT be enough" (a fact turned into a prohibition) written "This rule SHALL apply when ...: then the automatic plan is not enough." (review fix 5). Parts 4-5's "such a línea" written "a non-manual línea whose eligible partidas with balance declare different purities" (review fix 4). |
| R26 | "R26 — Marked as preparada listed in Confirmadas", "— En curso and Imprimir", "— Nothing confirmed from the list" | all six (direct) | Split in three. Part 2's "waits here" written "waits here (in the Confirmadas tab)" (review fix 4). |
| R7 | R7 | "Reserving without preparaciones.iniciar", "Printing without etiquetas.generar" (**derived**); "Releasing" (direct) | "Permisos:" written "Permisos SHALL be:". |
| "Enforced in" column | `## Enforcement` (verbatim) | — | — |
| Invariants preserved | `## Invariants preserved` (verbatim) | — | Statements about invariants defined elsewhere; kept as reference. |
| Decisions | `## Decisions` (verbatim) | — | — |
| Open | `## Open` (verbatim) | — | Known gaps (no reserva expiry, cotizaciones ignore reservas, two líneas of the same droga, PDF column) stay as written, not requirements. |
| Not verified | `## Not verified` (verbatim) | — | — |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

Derived scenarios: 29 of 118.

## Conflicts and stale points (kept as written)

- R7 says every step is audited "CONFIRMAR on the preparación"; R13 says "Imprimir etiquetas" is "Audited ONCE on
  the receta (CONFIRMAR)". The code agrees with R13 (`confirmarReservasReceta`: `audit: { entidad: "receta", accion:
  CONFIRMAR }`). R7's "on the preparación" also conflicts with the pérdida: `registrar-perdida-reserva.ts` audits
  CREAR on `movimiento_stock`.
- `openspec/specs/pesada-real/spec.md` (P1, P8, P11, 2026-10-19) lists every línea's lots pre-checked with the
  automatic plan's. R25 flags itself "Superseded in part", but these still say otherwise and were not updated:
  "Decision: automatic reserva" ("Nobody picks partidas", now also the requirement "R1 — Nobody picks partidas"),
  the Flow "Marcar como preparada" dialog ("shows the
  automatic plan read-only ... asks only the real enrase quantity"), R25 "none checked", and Decisions ("The partida
  pickers, the client-sent partida ids and their schema were removed").
- R18 cites `openspec/specs/presupuesto-receta/spec.md`, "Edición"; after its conversion that is the requirement
  "Edición — regeneración de fichas desactualizadas" (still findable).
- Checked against code, no conflict: permisos of R7 (`preparaciones.confirmar` on reservar/recalcular/imprimir/
  pérdida, `preparaciones.descartar` on liberar); `ESTADOS_RECETA_VISIBLES_EN_TOMA` = laboratory estados +
  PREPARADA (R17); the valorizado PDF still has no reserved column (Open).

`openspec validate reserva-stock-preparacion --type spec --strict`: valid (CLI 1.14.1). Every requirement text
parsed by the CLI matches the file (no dropped line; `chk.py` silent).

## Review (2026-10-26)

Independent review (separate agent): CHANGES NEEDED → fixed. Six fixes, all introduced by the conversion:

1. The Decision section held rules no requirement stated ("oldest apertura first", "Not by ingreso date",
   "vencimiento vigente (INV-S10, reanálisis-aware)", "Nobody picks partidas -- not when reserving, not when
   recalculating, not on `/preparaciones/[id]`'s confirmation"). Restated as "R1 — Consumption order and eligible
   partidas" and "R1 — Nobody picks partidas"; the section stays verbatim. The table row that said R1/R3/R25
   covered these rules is corrected.
2. R12 "Línea in g, droga in mg" (1,5 g → 1500 mg) holds only for an enrase manual línea or a partida of 100 %
   purity (`reservasDelPlan` stores the purity-corrected quantity); the condition is now in GIVEN (derived).
3. R6b "Direct database update" was overbroad and wrongly called direct: migration 0072 `receta_assert_editable`
   guards only `item_receta` / `componente_item_receta` DELETEs while the receta is PENDIENTE_PREPARACION. Now
   "Direct database delete", narrowed to that, derived.
4. Dangling references after the splits now name their antecedent: R5 part 2 ("such an ítem"), R9 part 3 ("Then
   the reserva"), R25 parts 4-5 ("such a línea"), R26 part 2 ("waits here"), Flow "Ficha desactualizada" ("It
   writes", the `fichas.generar` command).
5. R25 "the automatic plan SHALL NOT be enough" turned a fact into a prohibition; now "This rule SHALL apply when
   ...: then the automatic plan is not enough."
6. "a one-click path when nothing must be typed is PENDING" moved verbatim to `## Pending`, referenced from the
   "Marcar como preparada dialog" requirement.

Pre-existing, kept as written:
- R20's message differs from the code: `generar-ficha-tecnica.ts` (L149) adds "(una preparación en curso)".
- R14's Descartar message in the code adds `("Liberar reserva")`.
- The Flow row "Imprimir etiquetas" says every ítem not yet Confirmada is Stock reservado, while the same row
  (now the next requirement) disables the button while an ítem is Pendiente.
- R7's "on the preparación" audit also conflicts with `registrar-perdida-reserva.ts` (CREAR on `movimiento_stock`),
  added to the R7 vs R13 note above.

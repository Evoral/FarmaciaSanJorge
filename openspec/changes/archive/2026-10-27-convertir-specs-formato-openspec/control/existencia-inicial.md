# Control table: existencia-inicial

Original: `git show 21bf0e2:openspec/specs/existencia-inicial/spec.md`.

R1–R12 keep their IDs. Rules over the 500-character limit were split into requirements that carry the same ID
(R3 ×2, R5 ×2, R6 ×3, R8 ×2, R12 ×2). The "Enforced in" column moved verbatim to `## Enforcement`. The original
has no test cases. Numbers computed by the converter: R6 "Last day of the plazo" / "Day after the plazo"
(first signed cierre 2026-10-01 + 30 days = 2026-10-31 abierto, 2026-11-01 cerrado, from "jornada actual ≤ jornada
of the first signed cierre + `dias_relevamiento_inicial`"); R6 "Parametro above 90" uses 91.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status paragraph | `## Status` (verbatim) | — | Date also cited in `## Purpose`. |
| Goal (two paragraphs) | `## Purpose` (verbatim) | — | "Implemented 2026-10-23 (see Status)." added; the "## Goal" heading dropped. |
| Vocabulary | `## Vocabulary` (verbatim) | — | The plazo default 30 / max 90 also stated in R6. |
| R1 | R1 | "Partida inserted without origen" (**derived**: "default"); "Ingreso of the other type" (**derived**: example of "mismatch"); "Second ingreso" (**derived**: "exactly one ingreso" + Enforcement "one ingreso per partida") | "is" written "SHALL be". "Insert-only" kept in the text, no scenario. |
| R2 | R2 | "Alta with the relevamiento cerrado" (**derived**); "Insert that skips the app" (direct, from Enforcement › R2 DB trigger); "Purchase after the relevamiento" (direct) | — |
| R3 | "R3 — Data read from the envase", "R3 — Costo unitario and proveedor" | "Cantidad zero", "DROGA without fecha de vencimiento", "Negative costo unitario" (**derived**: "required, > 0" / "required" / "≥ 0" read as refusals); "Insumo without fecha de vencimiento", "Droga with a vigente costo de proveedor", "Envase without proveedor" (direct) | Split in two at the list: the second part says "SHALL also include **costo unitario** (...) and **proveedor** (optional)". The original does not say which layer refuses; the scenarios do not either. |
| R4 | R4 | "COMPRA partida without proveedor", "Same lote twice without proveedor" (**derived**); "Partida without proveedor in a read" (direct, from Enforcement › R4) | "is nullable" written "SHALL be nullable". |
| R5 | "R5 — Use case", "R5 — Existencia inicial panel" | "Envase loaded" (direct); "User without the permiso" (**derived**); "Relevamiento abierto", "Relevamiento cerrado", "Submit with an error", "Submit that succeeds" (direct) | Split at "Its UI". |
| R6 | "R6 — When the relevamiento is abierto", "R6 — Plazo capped at three months", "R6 — Raising the parametro" | "No signed cierre yet" (direct); "Last day of the plazo", "Day after the plazo" (**derived**, computed dates); "Parametro above 90" (**derived**: "accepts 1-90"); "Stored value above 90" (direct); "Plazo ran out, parametro raised", "Closed by the DT, parametro raised" (direct) | Split in three. "can never exceed" written "MUST never exceed". |
| R7 | R7 | "The DT closes the relevamiento" (direct; the permiso `stock.ajuste.autorizar` comes from Enforcement › R7); "Before confirming" (direct); "A user who is not the DT vigente" (**derived**); "Reopening a closed relevamiento" (**derived**: Enforcement "write-once" read as a DB refusal) | "Cerrar relevamiento: only the DT vigente" written "SHALL be done only by the DT vigente". |
| R8 | "R8 — No contralor asiento for an INGRESO_INICIAL", "R8 — Close refused while contralor and physical stock differ" | "Existencia inicial of a controlled droga", "Contralor saldo differs from the physical stock", "Contralor manual" (direct) | Split in two; the second part repeats the rule's scope "With the contralor digital activo," so it is not lost at the seam. |
| R9 | R9 | "Envase already open at the relevamiento" (direct) | — |
| R10 | R10 | "Partida de existencia inicial in the reports" (direct) | — |
| R11 | R11 | "Faltante found after the close", "Sobrante found after the close" (direct) | — |
| R12 | "R12 — Saldo de apertura at the alta of a controlled droga", "R12 — Editing into controlada; contralor manual" | "Alta of a controlled droga" (direct); "Alta without saldo de apertura" (**derived**: "requires"); "Droga edited into controlada", "Contralor manual" (direct) | Split in two. The opening "**Controlled droga given alta with the contralor digital activo**: the alta requires" is written "For a **controlled droga given alta with the contralor digital activo**, the alta SHALL require": the CLI drops a requirement line that starts with `**...**:` (it reads it as metadata), which made the text lose its first line. |
| "Enforced in" column R1–R12 | `## Enforcement` (verbatim) | — | — |
| Decisions | `## Decisions` (verbatim) | — | — |
| Implementation notes | `## Implementation notes` (verbatim) | — | — |
| Open points | `## Open points` (verbatim) | — | — |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

Derived scenarios: 16 of 43.

## Conflicts and stale points (kept as written)

- Enforcement › R2 says "App: the new use case (R4)"; the use case is described in R5
  (`ingresar-existencia-inicial.ts`).
- Enforcement › R6 names a pure "Domain function `relevamientoAbierto(...)`". No such function exists: the window
  is computed only in SQL (`fsj.relevamiento_inicial_abierto`, header of `modules/stock/domain/existencia-inicial.ts`:
  "so the app and the DB can never disagree on it").
- Checked against code, no conflict: permiso `stock.partida.ingresar` (`ingresarExistenciaInicialCommand`);
  close permiso `stock.ajuste.autorizar` + `esDtVigenteHoy` + `verificarPasswordDtPartidaCommand`
  (`cerrar-relevamiento-inicial.ts`); `DIAS_RELEVAMIENTO_INICIAL_DEFAULT = "30"`, `DIAS_RELEVAMIENTO_INICIAL_MAX = 90`;
  the implementation note "No app path activates the contralor digital yet" still holds (`editarDatosTenant` never
  accepts `fechaActivacionContralor`).

`openspec validate existencia-inicial --type spec --strict`: valid (CLI 1.14.1). Every requirement text parsed by
the CLI matches the file (no dropped line).

## Review (2026-10-26)

Independent review (separate agent): APPROVE. Day arithmetic confirmed in code
(`relevamiento_inicial_fecha_limite` = first signed cierre + least(coalesce(días, 30), 90); open while
`jornada_actual <= limite`; the parámetro refuses 91). R12's reworded opening keeps its meaning. Stale points
confirmed (R2 Enforcement cites R4 for what is R5; no pure `relevamientoAbierto(...)` exists, the window is SQL
only). Note: the R7 scenarios' "relevamiento abierto" GIVEN comes from the code (`cerrar-relevamiento-inicial.ts`
refuses a second close) rather than R7's text; harmless.

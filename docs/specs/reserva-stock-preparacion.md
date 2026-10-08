# Reserva de stock de una preparación

Status: implemented 2026-10-08 (migrations 0071, 0072). Rollback:
`docs/rollbacks/reserva-stock-preparacion.md`.

## Goal

The lab has more internal steps after weighing. The libro recetario (and the
stock descuento) must be written only at the **end** of the process, when the
etiqueta is printed. In between, the stock chosen for the preparación is
**reserved**: nobody else can use it.

## Flow (toma workspace, `/preparaciones/recetas/[recetaId]`)

Every step asks for re-authentication (`requireRecentReauth`, same window as the
confirmation, `ReauthAwareForm` in the UI).

| Ítem | Action | Command | What it writes |
|---|---|---|---|
| Pendiente | "Continuar" → **"Reservar stock"** (same form as before: partidas, enrase manual, motivo de apertura adicional) | `preparaciones.reservarStock` (`modules/preparaciones/application/reservar-stock-preparacion.ts`) | preparación INICIADA (receta estado unchanged, but not editable while it lives) + `fsj.reserva_stock` rows. No `movimiento_stock`, no asiento. |
| Stock reservado | **"Modificar reserva"** (same dialog and form, prefilled with the current reserva: partidas per línea, enrase manual quantity, motivo) | `preparaciones.modificarReserva` (`modificar-reserva-stock.ts`; read: `preparaciones.modificacionDeReserva`, `get-modificacion-de-reserva.ts`) | REPLACES the preparación's reservas (same preparación, still INICIADA, nothing discarded). Audited as MODIFICAR with the old and the new reserva. |
| Stock reservado | **"Registrar pérdida"** (reserved partida, cantidad, motivo ROTURA/DERRAME, optional observación, DT co-firma) | `preparaciones.registrarPerdida` (`registrar-perdida-reserva.ts`; DT list: `preparaciones.perdida.dtParaCoFirma`) | ONE transaction: an AJUSTE (`registrarAjusteEnTx`, stock module) with `movimiento_stock.preparacion_id` = the preparación, which may consume its own reserva; then the reserva is re-planned (see R9). |
| Stock reservado | **"Liberar reserva"** | `preparaciones.liberarReserva` (`liberar-reserva-stock.ts`) | deletes the reservas, preparación → DESCARTADA (motivo "Reserva de stock liberada."). The ítem is Pendiente again; the receta is editable again if no other ítem has a live preparación. |
| Stock reservado | **"Imprimir etiqueta"** | `preparaciones.confirmarReserva` (`confirmar-reserva-stock.ts`) | ONE transaction: confirmation built from the reservas (`confirmarPreparacionEnTx`: egresos, asiento_recetario, asiento_contralor, CONFIRMADA + vencimiento, receta PENDIENTE_PREPARACION → EN_PREPARACION with its first confirmed ítem and → PREPARADA with its last), reservas deleted, etiqueta generated. The client then opens the existing size dialog / PDF. |

Item labels: Pendiente / Stock reservado / Confirmada. An INICIADA preparación
**without** reservas (from before 0071, or the ficha técnica screen's
"Preparar") keeps the old behaviour: "Confirmación en curso", link to
`/preparaciones/[id]`.

## Rules

| # | Rule | Enforced in |
|---|---|---|
| R1 | A reserva is validated exactly like its confirmation: líneas match the ficha, chosen partidas locked (id order) and re-read, split computed by the system (`proponerRepartoActivo` / manual `proponerReparto`), expiry, stock, INV-S15 desvío, INV-S18 motivo. | `planificarConsumoEnTx` (`confirmar-preparacion.ts`), shared by both. |
| R2 | One `reserva_stock` row per chosen partida of each línea, with the quantity the split takes from it (0 = chosen but not needed). The línea's `cantidad_manual` and `motivo_apertura_adicional` are repeated on its rows. | `reservarStockPreparacion`. |
| R3 | Stock reserved by **other** INICIADA preparaciones is not available: partida choice, the system's proposal, the confirmation's fresh-balance check, the toma workspace's "partidas para pesar" and the stock por droga (`v_stock_droga`). A preparación's own reservas stay available to it. | `reservadoPorOtrasSql` (`preparacion-repository.ts`: `listPartidasElegiblesDroga`, `getPartidasFrescas`); `fsj.v_stock_droga` (0071). |
| R4 | A reserva only counts while its preparación is INICIADA. Confirming or discarding the preparación (from any screen) deletes its reservas in the same transaction. | Availability SQL joins `preparacion.estado = 'INICIADA'`; `confirmarPreparacionEnTx`, `descartarPreparacionEnTx`. |
| R5 | "Imprimir etiqueta" revalidates against fresh balances. If the stock changed (an ajuste, an expired partida...) the confirmation's message explains it and nothing persists; the reserva stays, to be released and done again. | `confirmarPreparacionEnTx` (unchanged checks). |
| R6 | Starting/reserving a preparación does NOT move the receta's estado; the receta moves PENDIENTE_PREPARACION → EN_PREPARACION only at its first confirmation ("Imprimir etiqueta", or `/preparaciones/[id]`'s "Confirmar"). Both start paths (toma "Reservar stock" and the ficha screen's "Preparar") behave the same. INV-R08 (no backward transitions) is untouched. | `iniciarPreparacionEnTx` (no estado move), `confirmarPreparacionEnTx` step 8. |
| R6b | Editing a receta is blocked by a LIVE preparación (INICIADA or CONFIRMADA) of any of its fichas, not by a DESCARTADA one. So a receta with stock reserved is not editable (release the reserva first), and after "Liberar reserva" it is editable again. After editing, a new ficha version is generated as always; the discarded preparación keeps pointing at the old ficha. | App: `existeFichaConPreparacionParaReceta` / `recetasConFichaConPreparacion` (`p.estado <> 'DESCARTADA'`), `editarReceta`, the edit buttons of `/recetas/[id]`, `/recetas/[id]/editar` and the toma workspace. DB: INV-R11 `fsj.receta_assert_editable` (migration 0030, revised by 0072 to ignore DESCARTADA). |
| R1b | "Modificar reserva" validates the new choice with the same `planificarConsumoEnTx`; the preparación's OWN current reservas count as available to it (they are being replaced), other preparaciones' do not. Locks: preparación, then partidas (id order). | `modificarReservaStock`. |
| R8 | A normal ajuste can only consume the FREE part of a partida: saldo físico − stock reserved by preparaciones INICIADA. Otherwise: "Hay X reservados en preparación (receta Nº …): solo podés ajustar Y." (in the unit entered). Reservas are read after the partida lock (a reserva is only written under that lock). | `registrarAjusteEnTx` + `getReservadoEnPreparacion` (`modules/stock`). |
| R9 | "Registrar pérdida": locks preparación → receta → every reserved partida (id order, then the single partida again -- re-entrant), so it can not deadlock with reservar/imprimir. The partida must be one the preparación reserves. The AJUSTE may consume the preparación's OWN reserva, never another's. Then the same choice is re-planned (`planificarConsumoEnTx`): if it still covers the receta, the reserva rows are rewritten with the new split (same partidas, amounts updated); if not, the pérdida persists, the old rows stay and the ítem shows "La reserva ya no alcanza: modificá la reserva" until "Modificar reserva" fixes it ("Imprimir etiqueta" fails with the stock message meanwhile). | `registrarPerdidaReserva`; flag `reservaAlcanza` in the toma read (`getRecetaDeToma`: every reserved quantity ≤ saldo − other reservas and the partida not expired). |
| R10 | A pérdida is an AJUSTE like any other: it needs a DT's authorization (INV-S08/INV-U05: `autorizado_por_id` = DT vigente, checked by the DB), so its form carries the same co-firma as the stock ajuste (verified in its own transaction, then the internal command -- FIX 4 structure). The DT's password is the only credential asked: no operator re-authentication (user decision, 2026-10-08). INV-L08 (contralor) behaves exactly as for a normal ajuste: the same INSERT, the same deferred DB check. Permiso: `preparaciones.confirmar`, not `stock.ajuste.registrar`. | `verificarCoFirmaPerdidaCommand` (own instance over `verificarCoFirmaDtEnTx`), `registrarPerdidaInternalCommand`. |
| R11 | Reserved stock is SHOWN next to the physical saldo (informational): "Reservado en preparación" column in the partidas listing (`/stock/partidas`), the partida detail, the ajuste screen (saldo físico / reservado with its recetas / libre para ajustar) and stock valorizado (page column + last CSV column `CantidadReservada`). Stock valorizado keeps valuing the PHYSICAL saldo. | `reservadoPorPartida` / `getReservadoEnPreparacion` (`partida-repository.ts`), `getPartida` (`PartidaDetalle`), `listValorizado`. |
| R7 | Permisos: reservar and modificar = `preparaciones.confirmar` (reservar also `preparaciones.iniciar`); liberar = `preparaciones.descartar`; imprimir = `preparaciones.confirmar` + `etiquetas.generar` (+ `etiquetas.imprimir` for the PDF). Each step audited in its own transaction (CREAR / MODIFICAR / DESCARTAR / CONFIRMAR on the preparación). | The three commands. |

## Invariants preserved

- **INV-P04** (deferred, CONFIRMADA ⇔ asiento_recetario), **INV-L08** (deferred,
  controlled-drug egreso ⇔ asiento_contralor; EGRESO contralor needs
  `asiento_recetario_id`), **INV-L01** (libro immutability): untouched. The
  confirmation is the same code in one transaction; it only moved from
  "Continuar" to "Imprimir etiqueta". The reserva writes nothing those
  invariants govern.

## Decisions

- One table (`reserva_stock`) with the línea's data repeated per row, instead of
  a per-línea table: simplest; the app writes and reads them together.
- The reserva keeps every chosen partida (even with cantidad 0) so the
  confirmation re-validates the same choice (INV-S15/S18 depend on it).
- `confirmarPreparacionDeFicha` (create + confirm in one step) was replaced by
  `reservarStockPreparacion` (same file history, renamed).
- A closed jornada (`cierre_diario`) does not block reserving, only printing.
- Recetas that were moved to EN_PREPARACION by a start before this change stay
  there (no backward transition): a discard on them does not make them
  editable.
- The receta lock in `iniciarPreparacionEnTx` is still taken after the
  preparación INSERT (unchanged order); `editarReceta` re-checks live
  preparaciones under its own receta lock.

## Open

- **Contralor and ajustes (pre-existing, not changed here):** neither the stock
  ajuste nor the pérdida writes an `asiento_contralor` AJUSTE row, while the
  DB's deferred INV-L08 requires one for a controlled droga once the contralor
  is active. So an ajuste/pérdida of a controlled droga with the contralor
  active fails at commit today -- for both, identically. Needs its own change.
- Pérdida motivos are ROTURA and DERRAME only (`domain/perdida.ts`).
- No schema change for the pérdida: `movimiento_stock.preparacion_id` is
  nullable with its tenant composite FK since migrations 0008/0013 (the only
  CHECK makes it required for EGRESO_PREPARACION). Readers that join
  movimientos to preparaciones by `preparacion_id` filter on
  `tipo = 'EGRESO_PREPARACION'` (droga historial, INV-S12) except the
  proveedor trayectoria, which lists the preparaciones that touched a partida
  -- a pérdida's preparación now shows there too.
- Stock valorizado PDF (`valorizado-pdf.ts`) does not have the reserved
  column (fixed layout); page and CSV do.
- Cotizaciones (`modules/precios`) use stock only to COST an ítem (which
  partidas FEFO would draw from and their costo unitario) and show no
  quantities; they were left alone. Their "Incompleta: stock insuficiente"
  flag is computed over the physical saldo, so it ignores reservas -- a
  pricing estimate, not a reservation (INV-R02); change only if wanted.
- No expiry for a reserva: an abandoned one blocks stock until released.

## Not verified

No tests were run or written for this change (unit, DB, browser), and the
migration was not applied to any database. Existing unit tests that mock
`preparacion-repository` (`tests/unit/preparaciones-*`) do not mock the new
repository functions and may need updating.

# Reserva de stock de una preparación

Status: implemented 2026-10-08 (migrations 0071, 0072; units fix R12: 0073); receta-level
"Imprimir etiquetas" replaced the per-ítem one 2026-10-14 (R13, R17, no schema change). Rollback:
`docs/rollbacks/reserva-stock-preparacion.md` (R12: `docs/rollbacks/stock-unidad-base-droga.md`).

## Goal

The lab has more internal steps after weighing. The libro recetario (and the
stock descuento) must be written only at the **end** of the process, when the
etiquetas are printed. In between, the stock chosen for the preparación is
**reserved**: nobody else can use it.

## Flow (toma workspace, `/preparaciones/recetas/[recetaId]`)

Every step asks for re-authentication (`requireRecentReauth`, same window as the
confirmation, `ReauthAwareForm` in the UI).

| Ítem | Action | Command | What it writes |
|---|---|---|---|
| Pendiente | **"Marcar como preparada"** (button and the dialog's submit; formerly "Continuar" → "Reservar stock"; same form as before: partidas, enrase manual, motivo de apertura adicional) | `preparaciones.reservarStock` (`modules/preparaciones/application/reservar-stock-preparacion.ts`) | preparación INICIADA (receta estado unchanged, but not editable while it lives) + `fsj.reserva_stock` rows. No `movimiento_stock`, no asiento. |
| Stock reservado | **"Modificar reserva"** (same dialog and form, prefilled with the current reserva: partidas per línea, enrase manual quantity, motivo) | `preparaciones.modificarReserva` (`modificar-reserva-stock.ts`; read: `preparaciones.modificacionDeReserva`, `get-modificacion-de-reserva.ts`) | REPLACES the preparación's reservas (same preparación, still INICIADA, nothing discarded). Audited as MODIFICAR with the old and the new reserva. |
| Stock reservado | **"Registrar pérdida"** (reserved partida, cantidad, motivo ROTURA/DERRAME, optional observación, DT co-firma) | `preparaciones.registrarPerdida` (`registrar-perdida-reserva.ts`; DT list: `preparaciones.perdida.dtParaCoFirma`) | ONE transaction: an AJUSTE (`registrarAjusteEnTx`, stock module) with `movimiento_stock.preparacion_id` = the preparación, which may consume its own reserva; then the reserva is re-planned (see R9). |
| Stock reservado | **"Liberar reserva"** | `preparaciones.liberarReserva` (`liberar-reserva-stock.ts`) | deletes the reservas, preparación → DESCARTADA (motivo "Reserva de stock liberada."). The ítem is Pendiente again; the receta is editable again if no other ítem has a live preparación. |
| Receta (every ítem not yet Confirmada is Stock reservado) | **"Imprimir etiquetas"**, ONE for the receta, below its last ítem, with the note "Al imprimir, se registran todos los ítems en el libro recetario y se descuenta el stock."; disabled ("Reservá el stock de todos los ítems para imprimir las etiquetas.") while an ítem is Pendiente or "Confirmación en curso". Replaces the former per-ítem "Imprimir etiqueta" (`preparaciones.confirmarReserva`, removed). | `preparaciones.confirmarReservasReceta` (`confirmar-reservas-receta.ts`; per ítem `confirmarDesdeReservasEnTx`, `confirmar-desde-reservas.ts`) | ONE transaction, every ítem in ítem order (see R13): confirmation built from its reservas (`confirmarPreparacionEnTx`: egresos, asiento_recetario, asiento_contralor, CONFIRMADA + vencimiento, receta → PREPARADA with the last ítem), reservas deleted, etiqueta generated. The client toasts the asiento numbers and opens **"Seleccionar etiquetas"** by itself (R17). |
| Receta (nothing left to confirm) | **"Imprimir etiquetas"** opens "Seleccionar etiquetas" directly (reprint; needs `etiquetas.imprimir`) | — (each row prints through the existing `GET /api/preparaciones/[id]/etiqueta/pdf?tamano=…`) | Nothing but the etiqueta's `impresa` flag, as any print. |

Item labels: Pendiente / Stock reservado / Confirmada. An INICIADA preparación
**without** reservas (from before 0071, or the ficha técnica screen's
former "Preparar", removed by R16) keeps the old behaviour: "Confirmación en curso", link to
`/preparaciones/[id]`.

## Rules

| # | Rule | Enforced in |
|---|---|---|
| R1 | A reserva is validated exactly like its confirmation: líneas match the ficha, chosen partidas locked (id order) and re-read, split computed by the system (`proponerRepartoActivo` / manual `proponerReparto`), expiry, stock, INV-S15 desvío, INV-S18 motivo. | `planificarConsumoEnTx` (`confirmar-preparacion.ts`), shared by both. |
| R2 | One `reserva_stock` row per chosen partida of each línea, with the quantity the split takes from it (0 = chosen but not needed). The línea's `cantidad_manual` and `motivo_apertura_adicional` are repeated on its rows. | `reservarStockPreparacion`. |
| R3 | Stock reserved by **other** INICIADA preparaciones is not available: partida choice, the system's proposal, the confirmation's fresh-balance check, the toma workspace's "partidas para pesar" and the stock por droga (`v_stock_droga`). A preparación's own reservas stay available to it. | `reservadoPorOtrasSql` (`preparacion-repository.ts`: `listPartidasElegiblesDroga`, `getPartidasFrescas`); `fsj.v_stock_droga` (0071). |
| R4 | A reserva only counts while its preparación is INICIADA. Confirming or discarding the preparación (from any screen) deletes its reservas in the same transaction. | Availability SQL joins `preparacion.estado = 'INICIADA'`; `confirmarPreparacionEnTx`, `descartarPreparacionEnTx`. |
| R5 | "Imprimir etiquetas" revalidates every ítem against fresh balances. If the stock changed (an ajuste, an expired partida...) the confirmation's message explains it (naming the ítem) and nothing persists; the reservas stay, to be modified or released and done again. | `confirmarPreparacionEnTx` (unchanged checks). |
| R6 | Starting/reserving a preparación does NOT move the receta's estado; the receta moves PENDIENTE_PREPARACION → EN_PREPARACION only at its first confirmation ("Imprimir etiquetas", or `/preparaciones/[id]`'s "Confirmar" for a preparación without reserva). The only start path is the toma's "Marcar como preparada" (R16). INV-R08 (no backward transitions) is untouched. | `iniciarPreparacionEnTx` (no estado move), `confirmarPreparacionEnTx` step 8. |
| R6b | Editing a receta is blocked by a LIVE preparación (INICIADA or CONFIRMADA) of any of its fichas, not by a DESCARTADA one. So a receta with stock reserved is not editable (release the reserva first), and after "Liberar reserva" it is editable again. After editing, a new ficha version is generated as always; the discarded preparación keeps pointing at the old ficha. | App: `existeFichaConPreparacionParaReceta` / `recetasConFichaConPreparacion` (`p.estado <> 'DESCARTADA'`), `editarReceta`, the edit buttons of `/recetas/[id]`, `/recetas/[id]/editar` and the toma workspace. DB: INV-R11 `fsj.receta_assert_editable` (migration 0030, revised by 0072 to ignore DESCARTADA). |
| R1b | "Modificar reserva" validates the new choice with the same `planificarConsumoEnTx`; the preparación's OWN current reservas count as available to it (they are being replaced), other preparaciones' do not. Locks: preparación, then partidas (id order). | `modificarReservaStock`. |
| R8 | A normal ajuste can only consume the FREE part of a partida: saldo físico − stock reserved by preparaciones INICIADA. Otherwise: "Hay X reservados en preparación (receta Nº …): solo podés ajustar Y." (in the unit entered). Reservas are read after the partida lock (a reserva is only written under that lock). | `registrarAjusteEnTx` + `getReservadoEnPreparacion` (`modules/stock`). |
| R9 | "Registrar pérdida": locks preparación → receta → every reserved partida (id order, then the single partida again -- re-entrant), so it can not deadlock with reservar/imprimir. The partida must be one the preparación reserves. The AJUSTE may consume the preparación's OWN reserva, never another's. Then the same choice is re-planned (`planificarConsumoEnTx`): if it still covers the receta, the reserva rows are rewritten with the new split (same partidas, amounts updated); if not, the pérdida persists, the old rows stay and the ítem shows "La reserva ya no alcanza: modificá la reserva" until "Modificar reserva" fixes it ("Imprimir etiquetas" fails with the stock message meanwhile). | `registrarPerdidaReserva`; flag `reservaAlcanza` in the toma read (`getRecetaDeToma`: every reserved quantity ≤ saldo − other reservas and the partida not expired). |
| R10 | A pérdida is an AJUSTE like any other: it needs a DT's authorization (INV-S08/INV-U05: `autorizado_por_id` = DT vigente, checked by the DB), so its form carries the same co-firma as the stock ajuste (verified in its own transaction, then the internal command -- FIX 4 structure). The DT's password is the only credential asked: no operator re-authentication (user decision, 2026-10-08). INV-L08 (contralor) behaves exactly as for a normal ajuste: the same INSERT, the same deferred DB check. Permiso: `preparaciones.confirmar`, not `stock.ajuste.registrar`. | `verificarCoFirmaPerdidaCommand` (own instance over `verificarCoFirmaDtEnTx`), `registrarPerdidaInternalCommand`. |
| R11 | Reserved stock is SHOWN next to the physical saldo (informational): "Reservado en preparación" column in the partidas listing (`/partidas`), the partida detail, the ajuste screen (saldo físico / reservado with its recetas / libre para ajustar) and stock valorizado (page column + last CSV column `CantidadReservada`). Stock valorizado keeps valuing the PHYSICAL saldo. | `reservadoPorPartida` / `getReservadoEnPreparacion` (`partida-repository.ts`), `getPartida` (`PartidaDetalle`), `listValorizado`. |
| R12 | **Units.** Every stock quantity is in the **droga's unidad base** (`droga.unidad_base_id`, e.g. mg, mcg): partida saldo, `movimiento_stock`, `reserva_stock.cantidad`, `asiento_contralor`, the pérdida's cantidad and every stock check. A línea de pesaje (`cantidad_a_pesar`, `cantidad_teorica`) is in its **magnitud's base unit** (`unidad_medida.es_base`, e.g. g), and so is the enrase manual quantity the user types (the form labels it with the línea's symbol; `reserva_stock.cantidad_manual` keeps it as typed). The conversion happens at planning, once: the línea's quantity is converted into the droga's unidad base before the split (`fsj.convertir`'s arithmetic, `shared/decimal/convertir-unidad.ts`). The libro recetario (detalle and fórmula) and the "Stock insuficiente … faltan X" message stay in the línea's unit (950 g, not 950000 mg). A línea whose unit is of another magnitud than the droga's unidad base is refused with a clear message (no density conversion). The DB's INV-S12 compares in the droga's unidad base (migration 0073). Cotizaciones/presupuestos cost the same way (partidas and costo unitario in the droga's unidad base, faltante reported in the línea's unit). Displays label stock amounts with the droga's symbol (partidas para pesar "Disp.", reserved partidas and the pérdida form); the confirmation form's "Disponible"/"Propuesto" are display-only converted to a readable unit of the same chain (`formatCantidadesFila`/`formatCantidad` "auto": e.g. 999.999,55 mg → 1.000 g, 2 decimals, one unit for all partidas of a línea, exact value in the tooltip). | `planificarConsumoEnTx` (`confirmar-preparacion.ts`), `construirDatosConfirmacion`, `calcularCotizacion` (`modules/precios`); DB `fsj.linea_pesaje_validar_consumo` (0073). |
| R13 | **"Imprimir etiquetas" confirms the whole receta, all or nothing.** It runs only when EVERY ítem not yet CONFIRMADA holds a reserva: a Pendiente or "Confirmación en curso" ítem refuses the whole receta ("No se pueden imprimir las etiquetas: el ítem 2 no tiene stock reservado…", checked under the locks below; the UI disables the button with a note first). Ítems already CONFIRMADA (e.g. on their preparación's own screen) are skipped; none left → clear error. One transaction, so the asiento counter row (locked FOR UPDATE by the asiento_recetario trigger) is held from the first asiento to the commit: the receta's asientos are **consecutive**. If one ítem fails, nothing persists and the message names it ("Ítem 2: …"). Lock order preparación → receta → partidas (like "Registrar pérdida") with sets: every candidate preparación (id order, one statement), the receta, every reserved partida of all the ítems (id order, one statement, BEFORE the first asiento); the per-ítem confirmation re-locks rows it already holds. A reserva made between reading the candidates and locking the receta is not locked: the command refuses ("volvé a intentar"). Audited ONCE on the receta (CONFIRMAR) with each preparación's asiento Nº and etiqueta. There is NO per-ítem confirmation of a reserva (no command, no Server Action): no ítem can take an asiento outside the receta's run. Printing: "Seleccionar etiquetas" lists every CONFIRMADA ítem with its etiqueta, in ítem order ("Ítem N: nombre"), each with its own tamaño (first active size preselected) and its own "Imprimir", which opens that ítem's single-etiqueta PDF in a new tab (one click per tab, so no popup blocking); no active size → the "No hay tamaños de etiqueta activos…" note. | `confirmarReservasReceta`, `itemsSinReserva`/`mensajeItemsSinReserva` (`domain/toma.ts`); `EtiquetasDeReceta` (`ui/reserva-acciones.tsx`), `SeleccionarEtiquetasDialog` (`ui/imprimir-etiqueta-dialog.tsx`). |
| R14 | **A reserved preparación is confirmed only from the toma workspace.** `preparaciones.confirmar` (the `/preparaciones/[id]` screen's form) refuses a preparación that holds reservas, checked under its lock; the screen shows "Esta preparación tiene stock reservado" with a link to the receta instead of the confirm/descartar forms. So a reserved ítem always gets its etiqueta with its asiento and can take part in R13's consecutive numbering. | `confirmarPreparacionCommand` (`confirmar-preparacion.ts`), `getPreparacionParaPantalla.conReserva`, `app/(app)/preparaciones/[id]/page.tsx`. |
| R15 | **"Cancelar toma" only while every ítem is Pendiente.** The command refuses it when an ítem has a preparación INICIADA (reserved or not) or CONFIRMADA (already in the libro recetario); the toma workspace hides the button as soon as any ítem is not Pendiente. | `validarCancelarToma` (`domain/toma.ts`), toma page header. |
| R16 | **A preparación starts only from the toma workspace.** The ficha técnica screen's "Preparar" (`iniciarPreparacionAction` + `IniciarPreparacionForm`) was removed: it created an INICIADA preparación without reserva, confirmed one by one from `/preparaciones/[id]` outside R13, so its asiento could interleave with other recetas'. The ficha screen keeps "Continuar preparación" for an existing INICIADA one. `iniciarPreparacionCommand` stays (internal, no Server Action); `iniciarPreparacionEnTx` is what `reservarStockPreparacion` runs. | `app/(app)/recetas/[id]/items/[itemId]/ficha-tecnica/page.tsx`, `modules/preparaciones/ui/actions.ts`. |
| R17 | **The toma workspace stays on a taken PREPARADA receta.** "Imprimir etiquetas" moves the receta to PREPARADA, and its Server Action's revalidation re-renders the page in the same response: the page must not redirect then, or the print dialog never opens. A taken receta that is PENDIENTE_PREPARACION, EN_PREPARACION or PREPARADA shows the workspace (PREPARADA: read-only, every ítem Confirmada, no edit form, no "Cancelar toma", "Imprimir etiquetas" to reprint); any other estado (ENTREGADA, ANULADA…), or a PREPARADA receta nobody took, redirects to `/recetas/[id]`. Taking and cancelling still follow the lab estados only. | `ESTADOS_RECETA_VISIBLES_EN_TOMA` (`domain/toma.ts`), toma page. |
| R7 | Permisos: reservar and modificar = `preparaciones.confirmar` (reservar also `preparaciones.iniciar`); liberar = `preparaciones.descartar`; "Imprimir etiquetas" = `preparaciones.confirmar` + `etiquetas.generar` (+ `etiquetas.imprimir` for the dialog / PDF; without it the confirmation still runs, but no dialog). Each step audited in its own transaction (CREAR / MODIFICAR / DESCARTAR / CONFIRMAR on the preparación). | The three commands. |

## Invariants preserved

- **INV-P04** (deferred, CONFIRMADA ⇔ asiento_recetario), **INV-L08** (deferred,
  controlled-drug egreso ⇔ asiento_contralor; EGRESO contralor needs
  `asiento_recetario_id`), **INV-L01** (libro immutability): untouched. The
  confirmation is the same code in one transaction; it only moved from
  "Continuar" to "Imprimir etiquetas". The reserva writes nothing those
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

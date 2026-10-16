# Reserva de stock de una preparación

Status: implemented 2026-10-08 (migrations 0071, 0072; units fix R12: 0073); receta-level
"Imprimir etiquetas" replaced the per-ítem one 2026-10-14 (R13, R17, no schema change).
**2026-10-15: automatic reserva** (R1, R1b, R2, R9 revised: no partida choice, DT decision) and the
consistency fixes R18-R23 (migration 0077: at most one live preparación per ítem). Rollback:
`docs/rollbacks/reserva-stock-preparacion.md` (R12: `docs/rollbacks/stock-unidad-base-droga.md`).

## Goal

The lab has more internal steps after weighing. The libro recetario (and the
stock descuento) must be written only at the **end** of the process, when the
etiquetas are printed. In between, the stock the preparación will use is
**reserved**: nobody else can use it.

## Decision: automatic reserva (DT decision, 2026-10-15)

The Director Técnico found choosing partidas per línea tedious. The reserva is
made **automatically over ALL eligible partidas of the droga**, in the existing
consumption order: **abiertas first (oldest apertura first), then FEFO** (the
first to expire is consumed first) -- `ordenarParaConsumo` /
`proponerRepartoActivo`, INV-S13/S16/S19/S20. Not by ingreso date. Nobody picks
partidas any more: not when reserving, not when recalculating, not on
`/preparaciones/[id]`'s confirmation. The client never sends partida ids. Stock
control stays in the stock module (no new panel).

Eligible = the same as `listPartidasElegiblesDroga`: a partida of the línea's
droga with **available** balance (saldo físico − what OTHER INICIADA
preparaciones reserved, R3) and **not expired** on its vencimiento vigente
(INV-S10, reanálisis-aware).

## Flow (toma workspace, `/preparaciones/recetas/[recetaId]`)

Every step asks for re-authentication (`requireRecentReauth`, same window as the
confirmation, `ReauthAwareForm` in the UI).

| Ítem | Action | Command | What it writes |
|---|---|---|---|
| Pendiente, ficha vigente (R18) | **"Marcar como preparada"**. The ítem's card already shows, per línea, the partidas the reserva will take and how much of each ("Partidas para pesar", R21). It opens a dialog (a one-click path when nothing must be typed is PENDING) that shows the automatic plan read-only (lote, vencimiento, cantidad in a readable unit) and asks only the real enrase quantity (the plan of that línea follows it live) and -- only when INV-S18 asks for it -- the motivo de apertura adicional. A línea without enough stock shows its faltante (línea unit) and blocks the submit. | `preparaciones.reservarStock` (`modules/preparaciones/application/reservar-stock-preparacion.ts`) | preparación INICIADA (receta estado unchanged, but not editable while it lives) + `fsj.reserva_stock` rows (R2). No `movimiento_stock`, no asiento. |
| Pendiente, **"Ficha desactualizada"** (R18) | No "Marcar como preparada". With `fichas.generar`: "Generar ficha técnica" (a new version from the ítem's current data); without it: "Pedile a alguien con permiso para generar fichas técnicas que la genere." | `fichas.generar` | A new ficha version. |
| Stock reservado | **"Recalcular reserva"** (formerly "Modificar reserva"): re-plans the reserva automatically over every eligible partida; the preparación's own reservas count as available (R1b). From the toolbar: the same dialog, prefilled with the enrase quantity (and motivo) of the current reserva, both editable; one click from the "La reserva ya no alcanza" alert when the ficha has no enrase manual línea (R5). | `preparaciones.recalcularReserva` (`recalcular-reserva-stock.ts`; read: `preparaciones.recalculoDeReserva`, `get-recalculo-de-reserva.ts`) | REPLACES the preparación's reservas (same preparación, still INICIADA). Audited as MODIFICAR with the old and the new reserva. |
| Stock reservado | **"Registrar pérdida"** (reserved partida, cantidad, motivo ROTURA/DERRAME, optional observación, DT co-firma) | `preparaciones.registrarPerdida` (`registrar-perdida-reserva.ts`; DT list: `preparaciones.perdida.dtParaCoFirma`) | ONE transaction: an AJUSTE (`registrarAjusteEnTx`, stock module) with `movimiento_stock.preparacion_id` = the preparación, which may consume its own reserva; then the reserva is re-planned automatically over every eligible partida (R9). |
| Stock reservado | **"Liberar reserva"** | `preparaciones.liberarReserva` (`liberar-reserva-stock.ts`) | deletes the reservas, preparación → DESCARTADA (motivo "Reserva de stock liberada."). The ítem is Pendiente again; the receta is editable again if no other ítem has a live preparación. |
| Receta (every ítem not yet Confirmada is Stock reservado) | **"Imprimir etiquetas"**, ONE for the receta, below its last ítem, with the note "Al imprimir, se registran todos los ítems en el libro recetario y se descuenta el stock."; disabled ("Reservá el stock de todos los ítems para imprimir las etiquetas.") while an ítem is Pendiente or "Confirmación en curso", and ("Recalculá la reserva del ítem N para imprimir las etiquetas.") while a reserva no longer fits (R5). | `preparaciones.confirmarReservasReceta` (`confirmar-reservas-receta.ts`; per ítem `confirmarDesdeReservasEnTx`, `confirmar-desde-reservas.ts`) | ONE transaction, every ítem in ítem order (see R13): confirmation built from its reservas (`confirmarPreparacionEnTx`: egresos, asiento_recetario, asiento_contralor, CONFIRMADA + vencimiento, receta → PREPARADA with the last ítem), reservas deleted, etiqueta generated. The client toasts the asiento numbers and opens **"Seleccionar etiquetas"** by itself (R17). |
| Receta (nothing left to confirm) | **"Imprimir etiquetas"** opens "Seleccionar etiquetas" directly (reprint; needs `etiquetas.imprimir`). An ítem whose asiento was dejado sin efecto is listed disabled, with the reason (R22). | — (each row prints through the existing `GET /api/preparaciones/[id]/etiqueta/pdf?tamano=…`) | Nothing but the etiqueta's `impresa` flag, as any print. |

Item labels: Pendiente / Stock reservado / Confirmada. An INICIADA preparación
**without** reservas (from before 0071, or the ficha técnica screen's
former "Preparar", removed by R16) shows "Confirmación en curso", link to
`/preparaciones/[id]`, whose confirmation also plans automatically (R1).

## Rules

| # | Rule | Enforced in |
|---|---|---|
| R1 | **The split is always automatic.** For every línea: the candidates are ALL eligible partidas of its droga (available > 0, not expired), read, then **locked in one id-ordered statement** together with every other línea's candidates (`lockPartidasParaConfirmacion`), then re-read fresh; the split is `proponerRepartoActivo` (non-manual: active terms, purity per partida) or `proponerReparto` (enrase manual: the typed physical quantity), abiertas first then FEFO. Expiry, stock (all líneas' faltantes in one message, línea unit), INV-S15 desvío (`false` by construction: the split IS the system's proposal) and INV-S18 motivo are checked as before. Used by the reserva, "Recalcular reserva", "Registrar pérdida"'s re-plan and `/preparaciones/[id]`'s confirmation (`preparaciones.confirmar`). "Imprimir etiquetas" confirms from the stored reserva instead (`modo: "reservada"`): the same split recomputed over the reserved partidas against fresh balances, desvío and INV-S18 compared with the current proposal over every eligible partida. The number of partidas locked is the number of eligible partidas of the ficha's drogas (a handful in practice). | `planificarConsumoEnTx` (`confirmar-preparacion.ts`, `SeleccionDePartidas`); the split itself: `repartirLinea` (`domain/reparto-linea.ts`), shared with the dialog. |
| R1b | "Recalcular reserva" re-plans with R1; the preparación's OWN current reservas count as available to it (they are being replaced), other preparaciones' do not. The enrase quantity / motivo not sent default to the current reserva's. It refuses a preparación whose ficha is no longer the ítem's latest version or is desactualizada (R18): release the reserva and start again. Locks: preparación, then the candidate partidas (one id-ordered statement). | `recalcularReservaStock`. |
| R2 | One `reserva_stock` row per partida the automatic split draws from (cantidad > 0, droga's unidad base). The línea's `cantidad_manual` and `motivo_apertura_adicional` are repeated on its rows. Rows written before 2026-10-15 may still hold chosen-but-unneeded partidas with cantidad 0: the confirmation handles both. Since the reserved partidas ARE the system's proposal, the confirmation's INV-S15 desvío is false and INV-S18 holds unless the stock changed meanwhile (R5). | `reservasDelPlan` (`reservar-stock-preparacion.ts`). |
| R3 | Stock reserved by **other** INICIADA preparaciones is not available: the automatic plan, the confirmation's fresh-balance check, the toma workspace's "partidas para pesar" and the stock por droga (`v_stock_droga`). A preparación's own reservas stay available to it. | `reservadoPorOtrasSql` (`preparacion-repository.ts`: `listPartidasElegiblesDroga`, `getPartidasFrescas`); `fsj.v_stock_droga` (0071). |
| R4 | A reserva only counts while its preparación is INICIADA. Confirming or releasing the preparación deletes its reservas in the same transaction. | Availability SQL joins `preparacion.estado = 'INICIADA'`; `confirmarPreparacionEnTx`, `liberarReservaStock`. |
| R5 | "Imprimir etiquetas" revalidates every ítem against fresh balances and **never changes a reserva by itself**. If the stock changed (an ajuste, an expired partida, another partida opened...) the confirmation's message explains it naming the ítem, and nothing persists. The toma workspace flags such an ítem up front ("La reserva ya no alcanza…", `reservaAlcanza`: a reserved quantity above its partida's saldo − other reservas, or an expired partida) with a one-click **"Recalcular reserva"** on that ítem, and keeps "Imprimir etiquetas" disabled until it is recalculated. | `confirmarPreparacionEnTx` (unchanged checks); `reservaAlcanza` (`getRecetaDeToma`); `RecalcularReservaForm` / `EtiquetasDeReceta` (`ui/reserva-acciones.tsx`). |
| R6 | Starting/reserving a preparación does NOT move the receta's estado; the receta moves PENDIENTE_PREPARACION → EN_PREPARACION only at its first confirmation ("Imprimir etiquetas", or `/preparaciones/[id]`'s "Confirmar" for a preparación without reserva). The only start path is the toma's "Marcar como preparada" (R16). INV-R08 (no backward transitions) is untouched. | `iniciarPreparacionEnTx` (no estado move), `confirmarPreparacionEnTx` step 8. |
| R6b | Editing a receta is blocked by a LIVE preparación (INICIADA or CONFIRMADA) of any of its fichas, not by a DESCARTADA one. So a receta with stock reserved is not editable (release the reserva first), and after "Liberar reserva" it is editable again. After editing, a new ficha version is generated as always (only by someone with `fichas.generar`, R18); the discarded preparación keeps pointing at the old ficha. | App: `existeFichaConPreparacionParaReceta` / `recetasConFichaConPreparacion` (`p.estado <> 'DESCARTADA'`), `editarReceta`, the edit buttons of `/recetas/[id]`, `/recetas/[id]/editar` and the toma workspace. DB: INV-R11 `fsj.receta_assert_editable` (migration 0030, revised by 0072 to ignore DESCARTADA). |
| R8 | A normal ajuste can only consume the FREE part of a partida: saldo físico − stock reserved by preparaciones INICIADA. Otherwise: "Hay X reservados en preparación (receta Nº …): solo podés ajustar Y." (in the unit entered). Reservas are read after the partida lock (a reserva is only written under that lock). | `registrarAjusteEnTx` + `getReservadoEnPreparacion` (`modules/stock`). |
| R9 | "Registrar pérdida": locks preparación → receta → (every reserved partida ∪ every eligible partida of the ficha's drogas, ONE id-ordered statement), so the AJUSTE and the re-plan only re-lock rows it already holds and it can not deadlock with reservar/imprimir. The partida must be one the preparación reserves. The AJUSTE may consume the preparación's OWN reserva, never another's. Then the reserva is **re-planned automatically** (R1) over every eligible partida, with the reserva's enrase quantity/motivo: if the droga still has the stock, the rows are rewritten (possibly other partidas); only if the droga truly lacks it the pérdida persists, the old rows stay and the ítem shows "La reserva ya no alcanza" with "Recalcular reserva" (R5). | `registrarPerdidaReserva`. |
| R10 | A pérdida is an AJUSTE like any other: it needs a DT's authorization (INV-S08/INV-U05: `autorizado_por_id` = DT vigente, checked by the DB), so its form carries the same co-firma as the stock ajuste (verified in its own transaction, then the internal command -- FIX 4 structure). The DT's password is the only credential asked: no operator re-authentication (user decision, 2026-10-08). INV-L08 (contralor) behaves exactly as for a normal ajuste. Permiso: `preparaciones.confirmar`, not `stock.ajuste.registrar`. | `verificarCoFirmaPerdidaCommand`, `registrarPerdidaInternalCommand`. |
| R11 | Reserved stock is SHOWN next to the physical saldo (informational): "Reservado en preparación" column in the partidas listing (`/partidas`), the partida detail, the ajuste screen and stock valorizado (page column + last Excel column "Cantidad reservada"). Stock valorizado keeps valuing the PHYSICAL saldo. | `reservadoPorPartida` / `getReservadoEnPreparacion` (`partida-repository.ts`), `getPartida`, `listValorizado`. |
| R12 | **Units.** Every stock quantity is in the **droga's unidad base** (`droga.unidad_base_id`, e.g. mg, mcg): partida saldo, `movimiento_stock`, `reserva_stock.cantidad`, `asiento_contralor`, the pérdida's cantidad and every stock check. A línea de pesaje (`cantidad_a_pesar`, `cantidad_teorica`) is in its **magnitud's base unit** (`unidad_medida.es_base`, e.g. g), and so is the enrase manual quantity the user types (`reserva_stock.cantidad_manual` keeps it as typed). The conversion happens at planning, once (`shared/decimal/convertir-unidad.ts`). The libro recetario and the "Stock insuficiente … faltan X" message stay in the línea's unit. A línea whose unit is of another magnitud than the droga's unidad base is refused with a clear message. The DB's INV-S12 compares in the droga's unidad base (migration 0073). Displays: the dialog's and the card's quantities are display-only converted to a readable unit of the same chain (`formatCantidad` "auto"; exact value in the tooltip). | `planificarConsumoEnTx`, `construirDatosConfirmacion`, `asignacionDeLinea` (`partidas-para-pesar.ts`); DB `fsj.linea_pesaje_validar_consumo` (0073). |
| R13 | **"Imprimir etiquetas" confirms the whole receta, all or nothing.** It runs only when EVERY ítem not yet CONFIRMADA holds a reserva (checked under the locks below; the UI disables the button with a note first). Ítems already CONFIRMADA are skipped; none left → clear error. One transaction, and ONE asiento for the whole receta with all its ítems (D8, `docs/specs/libro-recetario-y-contralor.md`). If one ítem fails, nothing persists and the message names it ("Ítem 2: …"). Lock order preparación → receta → partidas with sets: every candidate preparación (id order, one statement), the receta, every reserved partida of all the ítems (id order, one statement, BEFORE the asiento); the per-ítem confirmation re-locks rows it already holds. A reserva made between reading the candidates and locking the receta is not locked: the command refuses ("volvé a intentar"). Audited ONCE on the receta (CONFIRMAR). There is NO per-ítem confirmation of a reserva. Printing: "Seleccionar etiquetas" lists every CONFIRMADA ítem with its etiqueta, in ítem order, each with its own tamaño and "Imprimir" (one tab per click). | `confirmarReservasReceta`, `itemsSinReserva`/`mensajeItemsSinReserva` (`domain/toma.ts`); `EtiquetasDeReceta`, `SeleccionarEtiquetasDialog`. |
| R14 | **A reserved preparación is confirmed only from the toma workspace.** `preparaciones.confirmar` refuses a preparación that holds reservas, checked under its lock; `/preparaciones/[id]` shows "Esta preparación tiene stock reservado" with a link to the receta. Likewise `preparaciones.descartar` (the `/preparaciones/[id]` "Descartar" form, no re-authentication) refuses it: "Tiene stock reservado: liberá la reserva desde la receta." -- a reserva is only released by "Liberar reserva" (re-authentication). | `confirmarPreparacionCommand`, `descartarPreparacionCommand`, `getPreparacionParaPantalla.conReserva`. |
| R15 | **"Cancelar toma" only while every ítem is Pendiente.** | `validarCancelarToma` (`domain/toma.ts`), toma page header. |
| R16 | **A preparación starts only from the toma workspace.** `iniciarPreparacionCommand` stays (internal, no Server Action); `iniciarPreparacionEnTx` is what `reservarStockPreparacion` runs. | `app/(app)/recetas/[id]/items/[itemId]/ficha-tecnica/page.tsx`, `modules/preparaciones/ui/actions.ts`. |
| R17 | **The toma workspace stays on a taken PREPARADA receta** (read-only, "Imprimir etiquetas" to reprint); any other estado redirects to `/recetas/[id]`. | `ESTADOS_RECETA_VISIBLES_EN_TOMA` (`domain/toma.ts`), toma page. |
| R18 | **No reserva on an out-of-date ficha.** A ficha is *vigente* for its ítem when (a) it is the ítem's LATEST version and (b) recomputing the ítem's líneas from its CURRENT data (componentes, cantidades, forma, total) with the current weighing parameters gives exactly its líneas (`mismasLineasPesaje`: droga, unit, enrase flag, teórica, exceso, a pesar). (b) is the same staleness rule the automatic regeneration after an edit already uses (`docs/specs/presupuesto-receta.md`, "Edición"), so "desactualizada" ⇔ generating would create a new version; a weighing parameter change (exceso, balanza) therefore also makes a ficha desactualizada, which is intended: the weights would differ. Chosen over timestamps because `item_receta` has no change timestamp, `editarReceta` rewrites every ítem (even unchanged ones) and a generation that started before an edit committed could carry an earlier timestamp. When the ítem's data no longer computes (V1-V9, a droga dada de baja) the ficha cannot be verified and counts as desactualizada, with the reason. The reserva refuses a non-vigente ficha ("La ficha técnica de este ítem está desactualizada…"); the toma workspace shows the ítem "Ficha desactualizada" with "Generar ficha técnica" (or the note for who lacks `fichas.generar`). Editing a receta still does NOT generate fichas for an editor without `fichas.generar` (GA2): a ficha is a FAR/DT act (plan §7) and the automatic generation runs after the edit's own transaction by design (a failed generation never rolls back the receta); the lab regenerates from the toma workspace. | `evaluarFichaDeItemEnTx` (`modules/elaboracion/application/estado-ficha.ts`), `iniciarPreparacionEnTx`, `recalcularReservaStock`, `getTomaReceta.fichaDesactualizada`, toma page. |
| R19 | **At most one live preparación per ítem.** Reserving checks, under the receta and ítem locks, that the ficha is the ítem's latest version and that the ÍTEM (any ficha version) has no INICIADA or CONFIRMADA preparación -- not only the ficha. DB backstop: partial unique index `uq_preparacion_item_viva` on `(tenant_id, item_receta_id) WHERE estado IN ('INICIADA','CONFIRMADA')` (migration 0077), next to INV-P02 (`uq_preparacion_ficha_activa`, per ficha) and INV-PRP-003 (`uq_preparacion_item_confirmada`). A stale dialog can no longer leave a second INICIADA holding stock forever. | `iniciarPreparacionEnTx` (`getPreparacionVivaDeItem`); migration 0077. |
| R20 | **No new ficha version while the ítem holds a live preparación.** `fichas.generar` refuses while an INICIADA preparación lives ("Este ítem tiene stock reservado: liberá la reserva antes de generar una nueva versión de su ficha técnica.") as it already did for CONFIRMADA; the ficha screen hides "Generar nueva versión" then. The toma workspace shows (and prints) the ficha of the ítem's live preparación, never just the latest version. | `generarFichaTecnica` (`modules/elaboracion`), ficha page `puedeGenerar`; `getRecetaDeToma` (`ficha` = the live preparación's, else the latest). |
| R21 | **"Partidas para pesar" shows the automatic assignment.** For a Pendiente ítem with a vigente ficha, every non-manual línea lists the partidas the reserva will take, in order, with the quantity of each (physical, purity-corrected, línea unit) and its expiry warning; a línea without enough stock shows its faltante; expired partidas with saldo are listed apart as not available. Computed with the same `repartirLinea` over the same candidates as R1 (each ítem on its own: two ítems of the same droga each show the full candidate set until the first is reserved). A reserved ítem lists its reservas instead. | `asignacionDeLinea` (`partidas-para-pesar.ts`), `LineasFichaTabla`. |
| R22 | **No etiqueta for a preparado no longer valid.** Generating, reading for print and the PDF route refuse a preparación whose SISTEMA asiento was dejado sin efecto (ANULADO, or it has a rectificativo -- the same "SIN_EFECTO" rule as the entregas' `estadoAsiento`) or whose receta is ANULADA, with a clear message; "Seleccionar etiquetas" lists such an ítem disabled with the reason. | `motivoEtiquetaNoImprimible` (`domain/etiqueta.ts`) over `getPreparacionParaEtiqueta` (`asientoSinEfecto`, `recetaEstado`); `generarEtiquetaEnTx`, `getEtiquetaParaImprimirQuery`; `getRecetaDeToma.etiquetaNoImprimible`. |
| R23 | **Lock order** (every path, outermost first): ficha advisory lock (reserva only) → preparación(es) (id order) → receta → item_receta (reserva only) → partidas (one id-ordered statement per command; later statements only re-lock). Reserva: ficha → receta → item → partidas (it inserts, never locks, a preparación). Recalcular: preparación → partidas. Pérdida: preparación → receta → partidas. Imprimir etiquetas: preparaciones → receta → partidas. `/preparaciones/[id]` confirmation: preparación → receta → partidas (the receta lock moved BEFORE the partidas, 2026-10-15). Other writers: `editarReceta` receta → item_receta; `anularReceta`, `tomarReceta`, `cancelarToma` receta; `generarFichaTecnica` item_receta. No path takes them in another order, so none can deadlock with another. | The commands above. |
| R24 | **The receta's estado is re-checked under its lock.** Reserving locks the receta BEFORE inserting the preparación and re-reads its estado: only PENDIENTE_PREPARACION / EN_PREPARACION (an ANULADA, PREPARADA or delivered receta is refused). A confirmation refuses a receta outside those estados too (it never writes an asiento for an ANULADA/terminal receta) instead of skipping the estado move. | `iniciarPreparacionEnTx`, `confirmarPreparacionEnTx`. |
| R7 | Permisos: reservar and recalcular = `preparaciones.confirmar` (reservar also `preparaciones.iniciar`); liberar = `preparaciones.descartar`; "Imprimir etiquetas" = `preparaciones.confirmar` + `etiquetas.generar` (+ `etiquetas.imprimir` for the dialog / PDF). Each step audited in its own transaction (CREAR / MODIFICAR / DESCARTAR / CONFIRMAR on the preparación). | The commands. |

## Invariants preserved

- **INV-P04** (deferred, CONFIRMADA ⇔ asiento_recetario), **INV-L08** (deferred,
  controlled-drug egreso ⇔ asiento_contralor), **INV-L01** (libro
  immutability): untouched. The reserva writes nothing those invariants govern.
- INV-S15 is still recorded per movimiento (`desvio_propuesta`); with the
  automatic plan it is only `true` when the stock changed between the reserva
  and "Imprimir etiquetas" in a way that moves the proposal.

## Decisions

- One table (`reserva_stock`) with the línea's data repeated per row.
- Automatic reserva over all eligible partidas, abiertas first then FEFO (DT,
  2026-10-15). The partida pickers, the client-sent partida ids and their
  schema were removed; only the enrase quantity and the INV-S18 motivo are
  typed. By construction (abiertas first) the automatic plan never opens a
  cerrada while the abiertas alone cover the línea, so INV-S18's motivo field
  normally never shows; it stays wired (server check + field shown when the
  rule says so) in case the rule or the order changes.
- `/preparaciones/[id]`'s confirmation of an INICIADA preparación without
  reserva plans automatically too (one planning rule everywhere).
- "Imprimir etiquetas" does not recalculate a reserva by itself (R5): the
  quantities the lab weighed must not change silently inside the
  transaction that writes the libro.
- A closed jornada (`cierre_diario`) does not block reserving, only printing.
- Recetas that were moved to EN_PREPARACION by a start before this change stay
  there (no backward transition).
- Ficha staleness by recomputation, not timestamps (R18).

## Open

- **Contralor and ajustes (pre-existing, not changed here):** neither the stock
  ajuste nor the pérdida writes an `asiento_contralor` AJUSTE row, while the
  DB's deferred INV-L08 requires one for a controlled droga once the contralor
  is active. Needs its own change.
- Pérdida motivos are ROTURA and DERRAME only (`domain/perdida.ts`).
- Stock valorizado PDF (`valorizado-pdf.ts`) does not have the reserved column; page and Excel export do.
- **Cotizaciones/presupuestos ignore reservas.** `modules/precios` uses stock
  only to COST an ítem (which partidas FEFO would draw from and their costo
  unitario) over the PHYSICAL saldo; its "Incompleta: stock insuficiente" flag
  ignores what preparaciones INICIADA reserved. A pricing estimate, not a
  reservation (INV-R02); `docs/specs/presupuesto-receta.md` says the same.
  Change only if wanted.
- No expiry for a reserva: an abandoned one blocks stock until released.
- Two líneas of the same droga in one ficha are planned independently against
  the same balances (pre-existing; the DB's INV-S02 refuses the overdraft at
  confirmation).

## Not verified

No tests were run or written for these changes (unit, DB, browser), and
migrations 0071-0077 were not applied by the agents that wrote them. Unit
tests that mock `preparacion-repository` (`tests/unit/preparaciones-*`) do
not mock the new repository functions and need updating.

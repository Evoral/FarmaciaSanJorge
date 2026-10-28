# Reserva de stock de una preparación

## Purpose

The lab has more internal steps after weighing. The libro recetario (and the
stock descuento) must be written only at the **end** of the process, when the
etiquetas are printed. In between, the stock the preparación will use is
**reserved**: nobody else can use it.

Implemented 2026-10-08; the reserva became automatic by DT decision on 2026-10-15 and a línea whose partidas
differ in purity asks for the lot since 2026-10-18 (see Status and "Decision: automatic reserva").

## Requirements

### Requirement: Toma workspace — no re-authentication

No step of the toma workspace (`/preparaciones/recetas/[recetaId]`) SHALL ask for re-authentication (user
decision, 2026-10-21; the session identifies who acts, or the PIN on a cuenta de sector). The UI keeps
`ReauthAwareForm` for its form handling.

#### Scenario: Marking an ítem as preparada

- **GIVEN** a user with the permisos to reserve
- **WHEN** the user marks an ítem as preparada in the toma workspace
- **THEN** no password is asked to re-authenticate the user

### Requirement: Toma workspace — Marcar como preparada offered

For a Pendiente ítem with a vigente ficha (R18), the toma workspace SHALL offer **"Marcar como preparada"**. The
ítem's card already shows, per línea, the partidas the reserva will take and how much of each ("Partidas para
pesar", R21).

#### Scenario: Pendiente ítem with a vigente ficha

- **GIVEN** a Pendiente ítem whose ficha is vigente
- **WHEN** the user opens the toma workspace
- **THEN** the ítem offers "Marcar como preparada"
- **AND** its card shows, per línea, the partidas the reserva will take and how much of each

### Requirement: Toma workspace — Marcar como preparada dialog

"Marcar como preparada" SHALL open a dialog (a one-click path is pending, see `## Pending`) that shows
the automatic plan read-only (lote, vencimiento, cantidad in a readable unit) and asks only the real enrase
quantity (the plan of that línea follows it live) and -- only when INV-S18 asks for it -- the motivo de apertura
adicional. A línea without enough stock shows its faltante (línea unit) and blocks the submit.

#### Scenario: Dialog with an enrase línea

- **GIVEN** a ficha with an enrase manual línea
- **WHEN** the user types the real enrase quantity in the dialog
- **THEN** the plan of that línea follows it live

#### Scenario: Línea without enough stock

- **WHEN** a línea of the dialog lacks stock
- **THEN** the dialog shows its faltante in the línea unit
- **AND** the submit is blocked

### Requirement: Toma workspace — what Marcar como preparada writes

"Marcar como preparada" SHALL write a preparación INICIADA (receta estado unchanged, but not editable while it
lives) + `fsj.reserva_stock` rows (R2). No `movimiento_stock`, no asiento.

#### Scenario: Ítem marked as preparada

- **WHEN** the user submits "Marcar como preparada"
- **THEN** a preparación INICIADA and its `fsj.reserva_stock` rows are written
- **AND** no `movimiento_stock` and no asiento are written
- **AND** the receta estado does not change

### Requirement: Toma workspace — Ficha desactualizada

For a Pendiente ítem whose ficha is **"Ficha desactualizada"** (R18), the toma workspace SHALL NOT offer "Marcar
como preparada". With `fichas.generar`: "Generar ficha técnica" (a new version from the ítem's current data);
without it: "Pedile a alguien con permiso para generar fichas técnicas que la genere." `fichas.generar` writes a
new ficha version.

#### Scenario: User with fichas.generar

- **GIVEN** a Pendiente ítem with a desactualizada ficha and a user with `fichas.generar`
- **WHEN** the user opens the toma workspace
- **THEN** the ítem offers "Generar ficha técnica" and not "Marcar como preparada"

#### Scenario: User without fichas.generar

- **GIVEN** a Pendiente ítem with a desactualizada ficha and a user without `fichas.generar`
- **WHEN** the user opens the toma workspace
- **THEN** the ítem shows "Pedile a alguien con permiso para generar fichas técnicas que la genere."

### Requirement: Toma workspace — Recalcular reserva

For a Stock reservado ítem, **"Recalcular reserva"** (formerly "Modificar reserva") SHALL re-plan the reserva
automatically over every eligible partida; the preparación's own reservas count as available (R1b). From the
toolbar: the same dialog, prefilled with the enrase quantity (and motivo) of the current reserva, both editable;
one click from the "La reserva ya no alcanza" alert when the ficha has no enrase manual línea (R5).

#### Scenario: Recalcular from the toolbar

- **GIVEN** a Stock reservado ítem
- **WHEN** the user opens "Recalcular reserva" from the toolbar
- **THEN** the dialog is prefilled with the enrase quantity and motivo of the current reserva, both editable

#### Scenario: Recalcular from the alert

- **GIVEN** a Stock reservado ítem flagged "La reserva ya no alcanza" whose ficha has no enrase manual línea
- **WHEN** the user clicks "Recalcular reserva" in the alert
- **THEN** the reserva is re-planned in one click

### Requirement: Toma workspace — what Recalcular reserva writes

"Recalcular reserva" SHALL REPLACE the preparación's reservas (same preparación, still INICIADA). Audited as
MODIFICAR with the old and the new reserva.

#### Scenario: Reserva recalculated

- **WHEN** a reserva is recalculated
- **THEN** the preparación's reservas are replaced and the preparación stays INICIADA
- **AND** it is audited as MODIFICAR with the old and the new reserva

### Requirement: Toma workspace — Registrar pérdida

For a Stock reservado ítem, **"Registrar pérdida"** (reserved partida, cantidad, motivo ROTURA/DERRAME, optional
observación, DT co-firma) SHALL write, in ONE transaction, an AJUSTE (`registrarAjusteEnTx`, stock module) with
`movimiento_stock.preparacion_id` = the preparación, which may consume its own reserva; then the reserva is
re-planned automatically over every eligible partida (R9).

#### Scenario: Pérdida registered

- **GIVEN** a Stock reservado ítem
- **WHEN** the user registers a pérdida on a reserved partida with motivo ROTURA and the DT co-firma
- **THEN** one transaction writes an AJUSTE with `movimiento_stock.preparacion_id` = the preparación
- **AND** re-plans the reserva automatically over every eligible partida

### Requirement: Toma workspace — Liberar reserva

For a Stock reservado ítem, **"Liberar reserva"** SHALL delete the reservas, preparación → DESCARTADA (motivo
"Reserva de stock liberada."). The ítem is Pendiente again; the receta is editable again if no other ítem has a
live preparación.

#### Scenario: Reserva released

- **GIVEN** a receta whose only live preparación is the one of this ítem
- **WHEN** the user releases its reserva
- **THEN** the reservas are deleted and the preparación is DESCARTADA with motivo "Reserva de stock liberada."
- **AND** the ítem is Pendiente and the receta is editable again

### Requirement: Toma workspace — Imprimir etiquetas button

For the receta (every ítem not yet Confirmada is Stock reservado), the toma workspace SHALL offer **"Imprimir
etiquetas"**, ONE for the receta, below its last ítem, with the note "Al imprimir, se registran todos los ítems
en el libro recetario y se descuenta el stock.".

#### Scenario: Every ítem reserved

- **GIVEN** a receta whose every ítem not yet Confirmada is Stock reservado
- **WHEN** the user opens the toma workspace
- **THEN** one "Imprimir etiquetas" is shown below the last ítem
- **AND** it carries the note "Al imprimir, se registran todos los ítems en el libro recetario y se descuenta el stock."

### Requirement: Toma workspace — Imprimir etiquetas disabled

"Imprimir etiquetas" SHALL be disabled ("Reservá el stock de todos los ítems para imprimir las etiquetas.") while
an ítem is Pendiente or "Confirmación en curso", and ("Recalculá la reserva del ítem N para imprimir las
etiquetas.") while a reserva no longer fits (R5).

#### Scenario: An ítem still Pendiente

- **GIVEN** a receta with an ítem Pendiente
- **WHEN** the user opens the toma workspace
- **THEN** "Imprimir etiquetas" is disabled with "Reservá el stock de todos los ítems para imprimir las etiquetas."

#### Scenario: A reserva that no longer fits

- **GIVEN** a receta whose ítem 2 holds a reserva that no longer fits
- **WHEN** the user opens the toma workspace
- **THEN** "Imprimir etiquetas" is disabled with "Recalculá la reserva del ítem 2 para imprimir las etiquetas."

### Requirement: Toma workspace — what Imprimir etiquetas writes

"Imprimir etiquetas" SHALL write, in ONE transaction, every ítem in ítem order (see R13): confirmation built from
its reservas (`confirmarPreparacionEnTx`: egresos, asiento_recetario, asiento_contralor, CONFIRMADA + vencimiento,
receta → PREPARADA with the last ítem), reservas deleted, etiqueta generated.

#### Scenario: Receta printed

- **GIVEN** a receta whose every ítem not yet Confirmada is Stock reservado
- **WHEN** the user prints its etiquetas
- **THEN** one transaction confirms every ítem in ítem order from its reservas, deletes the reservas and generates the etiquetas
- **AND** the receta becomes PREPARADA with the last ítem

### Requirement: Toma workspace — after Imprimir etiquetas

The client SHALL toast the asiento numbers and the dialog's single "Imprimir" (size, vencimiento and position per
ítem, chosen before confirming) opens every etiqueta in ONE PDF (`openspec/specs/hoja-etiquetas/spec.md` R14).

#### Scenario: Confirmation succeeds

- **GIVEN** size, vencimiento and position chosen per ítem before confirming
- **WHEN** the confirmation succeeds
- **THEN** the client toasts the asiento numbers
- **AND** every etiqueta opens in ONE PDF

### Requirement: Toma workspace — reprint

For a receta with nothing left to confirm, **"Imprimir etiquetas"** SHALL open "Seleccionar etiquetas" directly
(reprint; needs `etiquetas.imprimir`). An ítem whose asiento was dejado sin efecto is listed disabled, with the
reason (R22). It writes nothing but the etiqueta's `impresa` flag, as any print.

#### Scenario: Reprinting

- **GIVEN** a receta with every ítem Confirmada and a user with `etiquetas.imprimir`
- **WHEN** the user clicks "Imprimir etiquetas"
- **THEN** "Seleccionar etiquetas" opens directly
- **AND** printing writes nothing but the etiqueta's `impresa` flag

### Requirement: Toma workspace — ítem labels

Ítem labels SHALL be Pendiente / Stock reservado / Confirmada. An INICIADA preparación **without** reservas (from
before 0071, or the ficha técnica screen's former "Preparar", removed by R16) shows "Confirmación en curso", link
to `/preparaciones/[id]`, whose confirmation also plans automatically (R1).

#### Scenario: INICIADA preparación without reservas

- **GIVEN** an ítem whose INICIADA preparación has no reservas
- **WHEN** the user opens the toma workspace
- **THEN** the ítem shows "Confirmación en curso" with a link to `/preparaciones/[id]`

### Requirement: R1 — Consumption order and eligible partidas

The automatic reserva SHALL take the partidas in the existing consumption order: abiertas first (oldest apertura
first), then FEFO (the first to expire is consumed first). Not by ingreso date. Eligible = the same as
`listPartidasElegiblesDroga`: a partida of the línea's droga with available balance (saldo físico − what OTHER
INICIADA preparaciones reserved, R3) and not expired on its vencimiento vigente (INV-S10, reanálisis-aware).

#### Scenario: Two abiertas

- **GIVEN** two eligible abiertas of the línea's droga, opened on different dates
- **WHEN** the línea is planned
- **THEN** the one with the oldest apertura is consumed first

#### Scenario: Two cerradas

- **GIVEN** two eligible cerradas and no abierta, the one that entered last expiring first
- **WHEN** the línea is planned
- **THEN** the one that expires first is consumed first, whatever the ingreso date

#### Scenario: Re-analysed partida

- **GIVEN** a partida whose printed date has passed and whose reanálisis date is after the jornada actual
- **WHEN** the línea is planned
- **THEN** the partida is eligible

### Requirement: R1 — Nobody picks partidas

Nobody SHALL pick partidas -- not when reserving, not when recalculating, not on `/preparaciones/[id]`'s
confirmation -- **except** for a línea whose eligible partidas declare different purities (R25): there the weight
depends on the lot, so the user marks the lot(s).

#### Scenario: Línea of equal purities

- **GIVEN** a línea whose eligible partidas declare the same purity
- **WHEN** the user reserves, recalculates or confirms on `/preparaciones/[id]`
- **THEN** the user picks no partida

#### Scenario: Línea of different purities

- **GIVEN** a línea whose eligible partidas declare different purities
- **WHEN** the user reserves
- **THEN** the user marks the lot(s)

### Requirement: R1 — Candidates and locks

**The split is always automatic.** For every línea: the candidates SHALL be ALL eligible partidas of its droga
(available > 0, not expired), read, then **locked in one id-ordered statement** together with every other línea's
candidates and the excipiente's candidate partidas (`lockPartidasParaConfirmacion`, `partidasAdicionales`;
security audit P3-02), then re-read fresh.

#### Scenario: Ficha with two líneas and an excipiente

- **WHEN** a ficha with two líneas and an excipiente is planned
- **THEN** the eligible partidas of both líneas and the excipiente's candidate partidas are locked in one id-ordered statement
- **AND** they are re-read fresh after the lock

### Requirement: R1 — The split and its checks

The split SHALL be `proponerRepartoActivo` (non-manual: active terms, purity per partida) or `proponerReparto`
(enrase manual: the typed physical quantity), abiertas first then FEFO. Expiry, stock (all líneas' faltantes in
one message, línea unit), INV-S15 desvío (`false` by construction: the split IS the system's proposal) and INV-S18
motivo are checked as before.

#### Scenario: Abierta and cerrada partidas

- **GIVEN** an abierta partida and a cerrada partida that expires earlier, both eligible
- **WHEN** a línea is planned
- **THEN** the abierta partida is consumed first

#### Scenario: Two líneas short of stock

- **WHEN** two líneas lack stock
- **THEN** both faltantes are reported in one message, each in its línea unit

### Requirement: R1 — Where the planning is used

This planning SHALL be used by the reserva, "Recalcular reserva", "Registrar pérdida"'s re-plan and
`/preparaciones/[id]`'s confirmation (`preparaciones.confirmar`). "Imprimir etiquetas" confirms from the stored
reserva instead (`modo: "reservada"`): the same split recomputed over the reserved partidas against fresh
balances, desvío and INV-S18 compared with the current proposal over every eligible partida.

#### Scenario: Imprimir etiquetas

- **WHEN** "Imprimir etiquetas" confirms an ítem
- **THEN** the split is recomputed over the reserved partidas against fresh balances
- **AND** desvío and INV-S18 are compared with the current proposal over every eligible partida

### Requirement: R1 — Partidas locked

The number of partidas locked SHALL be the number of eligible partidas of the ficha's drogas (a handful in
practice).

#### Scenario: Ficha whose drogas have three eligible partidas

- **GIVEN** a ficha whose drogas have three eligible partidas in all
- **WHEN** it is planned
- **THEN** three partidas are locked

### Requirement: R1b — Recalcular reserva counts its own reservas

"Recalcular reserva" SHALL re-plan with R1; the preparación's OWN current reservas count as available to it (they
are being replaced), other preparaciones' do not. The enrase quantity / motivo not sent default to the current
reserva's.

#### Scenario: Partida fully reserved by this preparación

- **GIVEN** a partida whose whole saldo is reserved by this preparación
- **WHEN** its reserva is recalculated
- **THEN** that saldo counts as available to it

#### Scenario: Enrase quantity not sent

- **WHEN** a recalculation is sent without the enrase quantity or motivo
- **THEN** the current reserva's are used

### Requirement: R1b — Out-of-date ficha and locks

"Recalcular reserva" SHALL refuse a preparación whose ficha is no longer the ítem's latest version or is
desactualizada (R18): release the reserva and start again. Locks: preparación, then the candidate partidas of the
líneas and of the excipiente (one id-ordered statement).

#### Scenario: Ficha desactualizada

- **GIVEN** a Stock reservado ítem whose ficha is desactualizada
- **WHEN** the user recalculates its reserva
- **THEN** it is refused

### Requirement: R2 — One row per partida drawn

One `reserva_stock` row SHALL be written per partida the automatic split draws from (cantidad > 0, droga's unidad
base). The línea's `cantidad_manual` and `motivo_apertura_adicional` are repeated on its rows.

#### Scenario: Línea drawn from two partidas

- **WHEN** the automatic split draws a línea from two partidas
- **THEN** two `reserva_stock` rows are written, each with cantidad > 0 in the droga's unidad base
- **AND** both carry the línea's `cantidad_manual` and `motivo_apertura_adicional`

### Requirement: R2 — Older rows and desvío

Rows written before 2026-10-15 may still hold chosen-but-unneeded partidas with cantidad 0: the confirmation SHALL
handle both. Since the reserved partidas ARE the system's proposal, the confirmation's INV-S15 desvío is false and
INV-S18 holds unless the stock changed meanwhile (R5).

#### Scenario: Row with cantidad 0 from before 2026-10-15

- **GIVEN** a reserva written before 2026-10-15 with a row of cantidad 0
- **WHEN** it is confirmed
- **THEN** the confirmation handles it

#### Scenario: Stock unchanged since the reserva

- **GIVEN** the stock did not change since the reserva
- **WHEN** it is confirmed
- **THEN** INV-S15 desvío is false

### Requirement: R3 — Reserved stock not available to others

Stock reserved by **other** INICIADA preparaciones SHALL NOT be available: the automatic plan, the confirmation's
fresh-balance check, the toma workspace's "partidas para pesar" and the stock por droga (`v_stock_droga`). A
preparación's own reservas stay available to it.

#### Scenario: Partida partly reserved by another preparación

- **GIVEN** a partida with saldo 1000 mg, 400 mg of it reserved by another INICIADA preparación
- **WHEN** a línea is planned
- **THEN** 600 mg of that partida are available to it

### Requirement: R4 — Reserva counts only while INICIADA

A reserva SHALL only count while its preparación is INICIADA. Confirming or releasing the preparación deletes its
reservas in the same transaction.

#### Scenario: Preparación confirmed

- **WHEN** a preparación with reservas is confirmed
- **THEN** its reservas are deleted in the same transaction

#### Scenario: Preparación released

- **WHEN** a preparación's reserva is released
- **THEN** its reservas are deleted in the same transaction

### Requirement: R5 — Imprimir etiquetas never changes a reserva

"Imprimir etiquetas" SHALL revalidate every ítem against fresh balances and **never change a reserva by itself**.
If the stock changed (an ajuste, an expired partida, another partida opened...) the confirmation's message
explains it naming the ítem, and nothing persists.

#### Scenario: Stock changed after the reserva

- **GIVEN** an ajuste reduced a reserved partida so that ítem 1's reserva no longer fits
- **WHEN** the user prints the etiquetas
- **THEN** the message explains it naming ítem 1
- **AND** nothing persists and the reserva is unchanged

### Requirement: R5 — La reserva ya no alcanza

The toma workspace SHALL flag up front an ítem whose reserva no longer fits the stock ("La reserva ya no alcanza…", `reservaAlcanza`: a reserved
quantity above its partida's saldo − other reservas, or an expired partida) with a one-click **"Recalcular
reserva"** on that ítem, and keep "Imprimir etiquetas" disabled until it is recalculated.

#### Scenario: Reserved quantity above the free saldo

- **GIVEN** 500 mg reserved on a partida with saldo 600 mg, 200 mg of it reserved by other preparaciones
- **WHEN** the toma workspace is shown
- **THEN** the ítem is flagged "La reserva ya no alcanza…" with "Recalcular reserva"
- **AND** "Imprimir etiquetas" stays disabled until it is recalculated

#### Scenario: Reserved partida expired

- **GIVEN** a reserved partida whose vencimiento vigente has passed
- **WHEN** the toma workspace is shown
- **THEN** the ítem is flagged "La reserva ya no alcanza…"

### Requirement: R6 — Receta estado moves at the first confirmation

Starting/reserving a preparación SHALL NOT move the receta's estado; the receta moves PENDIENTE_PREPARACION →
EN_PREPARACION only at its first confirmation ("Imprimir etiquetas", or `/preparaciones/[id]`'s "Confirmar" for a
preparación without reserva). The only start path is the toma's "Marcar como preparada" (R16). INV-R08 (no
backward transitions) is untouched.

#### Scenario: Reserving

- **GIVEN** a receta PENDIENTE_PREPARACION
- **WHEN** an ítem is marked as preparada
- **THEN** the receta stays PENDIENTE_PREPARACION

#### Scenario: First confirmation

- **GIVEN** a receta PENDIENTE_PREPARACION
- **WHEN** its first confirmation runs
- **THEN** the receta moves PENDIENTE_PREPARACION → EN_PREPARACION

### Requirement: R6b — A live preparación blocks editing

Editing a receta SHALL be blocked by a LIVE preparación (INICIADA or CONFIRMADA) of any of its fichas, not by a
DESCARTADA one. So a receta with stock reserved is not editable (release the reserva first), and after "Liberar
reserva" it is editable again.

#### Scenario: Receta with stock reserved

- **GIVEN** a receta with an INICIADA preparación holding stock
- **WHEN** a user tries to edit it
- **THEN** the edit is refused

#### Scenario: After Liberar reserva

- **GIVEN** a receta whose only preparación was DESCARTADA by "Liberar reserva"
- **WHEN** a user edits it
- **THEN** the edit is allowed

#### Scenario: Direct database delete

- **GIVEN** a receta PENDIENTE_PREPARACION with a live preparación
- **WHEN** one of its `item_receta` or `componente_item_receta` rows is deleted in the database bypassing the app
- **THEN** INV-R11 `fsj.receta_assert_editable` refuses it

### Requirement: R6b — After editing

After editing, a new ficha version SHALL be generated as always (only by someone with `fichas.generar`, R18); the
discarded preparación keeps pointing at the old ficha.

#### Scenario: Edit by a user with fichas.generar

- **GIVEN** a receta whose reserva was released and an editor with `fichas.generar`
- **WHEN** the editor edits the receta
- **THEN** a new ficha version is generated
- **AND** the discarded preparación keeps pointing at the old ficha

### Requirement: R8 — A normal ajuste consumes only the free part

A normal ajuste SHALL only consume the FREE part of a partida: saldo físico − stock reserved by preparaciones
INICIADA. Otherwise: "Hay X reservados en preparación (receta Nº …): solo podés ajustar Y." (in the unit entered).
Reservas are read after the partida lock (a reserva is only written under that lock).

#### Scenario: Ajuste larger than the free part

- **GIVEN** a partida with saldo físico 1000 mg, 300 mg of it reserved by an INICIADA preparación
- **WHEN** a user registers a normal ajuste of 800 mg
- **THEN** it is refused with "Hay X reservados en preparación (receta Nº …): solo podés ajustar Y." with X = 300 mg and Y = 700 mg

### Requirement: R9 — Locks of Registrar pérdida

"Registrar pérdida" SHALL lock preparación → receta → (every reserved partida ∪ every eligible partida of the
ficha's drogas and of the excipiente, ONE id-ordered statement), so the AJUSTE and the re-plan only re-lock rows it
already holds and it can not deadlock with reservar/imprimir.

#### Scenario: Pérdida registered

- **WHEN** a pérdida is registered
- **THEN** the preparación, then the receta, then every reserved and every eligible partida in one id-ordered statement are locked

### Requirement: R9 — Partida and reserva consumed

The partida of a pérdida MUST be one the preparación reserves. The AJUSTE may consume the preparación's OWN
reserva, never another's.

#### Scenario: Partida not reserved by the preparación

- **WHEN** a pérdida is registered on a partida the preparación does not reserve
- **THEN** it is refused

#### Scenario: Partida reserved by another preparación too

- **GIVEN** a reserved partida whose remaining saldo is reserved by another preparación
- **WHEN** the pérdida would consume that other reserva
- **THEN** it is refused

### Requirement: R9 — Re-plan after the pérdida

After the pérdida's AJUSTE, the reserva SHALL be **re-planned automatically** (R1) over every eligible partida, with the reserva's enrase
quantity/motivo: if the droga still has the stock, the rows are rewritten (possibly other partidas); only if the
droga truly lacks it the pérdida persists, the old rows stay and the ítem shows "La reserva ya no alcanza" with
"Recalcular reserva" (R5).

#### Scenario: Droga still has the stock

- **GIVEN** the droga has enough eligible stock after the pérdida
- **WHEN** the pérdida is registered
- **THEN** the reserva rows are rewritten, possibly over other partidas

#### Scenario: Droga lacks the stock

- **GIVEN** the droga does not have enough eligible stock after the pérdida
- **WHEN** the pérdida is registered
- **THEN** the pérdida persists and the old rows stay
- **AND** the ítem shows "La reserva ya no alcanza" with "Recalcular reserva"

### Requirement: R10 — A pérdida needs the DT's authorization

A pérdida SHALL be an AJUSTE like any other: it needs a DT's authorization (INV-S08/INV-U05: `autorizado_por_id` =
DT vigente, checked by the DB), so its form carries the same co-firma as the stock ajuste (verified in its own
transaction, then the internal command -- FIX 4 structure).

#### Scenario: Pérdida without a DT vigente as authorizer

- **WHEN** a pérdida reaches the database with an `autorizado_por_id` that is not a DT vigente
- **THEN** the DB refuses it

### Requirement: R10 — Credential and permiso

The DT's password SHALL be the only credential asked: no operator re-authentication (user decision, 2026-10-08).
INV-L08 (contralor) behaves exactly as for a normal ajuste. Permiso: `preparaciones.confirmar`, not
`stock.ajuste.registrar`.

#### Scenario: User with preparaciones.confirmar only

- **GIVEN** a user with `preparaciones.confirmar` and without `stock.ajuste.registrar`
- **WHEN** the user registers a pérdida with the DT's co-firma
- **THEN** it is registered
- **AND** only the DT's password was asked

### Requirement: R11 — Reserved stock shown

Reserved stock SHALL be SHOWN next to the physical saldo (informational): "Reservado en preparación" column in the
partidas listing (`/partidas`), the partida detail, the ajuste screen and stock valorizado (page column + last
Excel column "Cantidad reservada"). Stock valorizado keeps valuing the PHYSICAL saldo.

#### Scenario: Partida with stock reserved in the valorizado

- **GIVEN** a partida with stock reserved by an INICIADA preparación
- **WHEN** the stock valorizado is shown and exported to Excel
- **THEN** the reserved quantity is shown in its page column and in the last Excel column "Cantidad reservada"
- **AND** the partida is valued on its physical saldo

### Requirement: R12 — Stock quantities in the droga's unidad base

**Units.** Every stock quantity SHALL be in the **droga's unidad base** (`droga.unidad_base_id`, e.g. mg, mcg):
partida saldo, `movimiento_stock`, `reserva_stock.cantidad`, `asiento_contralor`, the pérdida's cantidad and every
stock check.

#### Scenario: Línea in g, droga in mg

- **GIVEN** a droga whose unidad base is mg and a línea of 1,5 g, either an enrase manual línea or one reserved from a partida of 100 % purity
- **WHEN** it is reserved from one partida
- **THEN** `reserva_stock.cantidad` is 1500 (mg)

### Requirement: R12 — Línea quantities in the magnitud's base unit

A línea de pesaje (`cantidad_a_pesar`, `cantidad_teorica`) SHALL be in its **magnitud's base unit**
(`unidad_medida.es_base`, e.g. g), and so is the enrase manual quantity the user types
(`reserva_stock.cantidad_manual` keeps it as typed). The conversion happens at planning, once
(`shared/decimal/convertir-unidad.ts`).

#### Scenario: Enrase quantity typed

- **WHEN** the user types the enrase manual quantity
- **THEN** `reserva_stock.cantidad_manual` keeps it as typed

### Requirement: R12 — Línea unit kept; other magnitud refused

The libro recetario and the "Stock insuficiente … faltan X" message SHALL stay in the línea's unit. A línea whose
unit is of another magnitud than the droga's unidad base is refused with a clear message. The DB's INV-S12
compares in the droga's unidad base (migration 0073).

#### Scenario: Faltante message

- **GIVEN** a línea in g of a droga whose unidad base is mg
- **WHEN** the stock is not enough
- **THEN** the "Stock insuficiente … faltan X" message gives X in g

#### Scenario: Línea of another magnitud

- **GIVEN** a línea in a volume unit of a droga whose unidad base is a mass unit
- **WHEN** it is planned
- **THEN** it is refused with a clear message

### Requirement: R12 — Displays

Displays: the dialog's and the card's quantities SHALL be display-only converted to a readable unit of the same
chain (`formatCantidad` "auto"; exact value in the tooltip).

#### Scenario: Quantity in the dialog

- **WHEN** the dialog shows a quantity
- **THEN** it is shown in a readable unit of the same chain
- **AND** the exact value is in the tooltip

### Requirement: R13 — Imprimir etiquetas confirms the whole receta

**"Imprimir etiquetas" confirms the whole receta, all or nothing.** It SHALL run only when EVERY ítem not yet
CONFIRMADA holds a reserva (checked under the locks below; the UI disables the button with a note first). Ítems
already CONFIRMADA are skipped; none left → clear error.

#### Scenario: An ítem without reserva

- **GIVEN** a receta with an ítem not yet CONFIRMADA that holds no reserva
- **WHEN** the confirmation runs
- **THEN** it is refused under the locks

#### Scenario: Nothing left to confirm

- **GIVEN** a receta whose ítems are all CONFIRMADA
- **WHEN** the confirmation runs
- **THEN** it fails with a clear error

### Requirement: R13 — One transaction, one asiento

"Imprimir etiquetas" SHALL run in one transaction, and write ONE asiento for the whole receta with all its ítems
(D8, `openspec/specs/libro-recetario-y-contralor/spec.md`). If one ítem fails, nothing persists and the message
names it ("Ítem 2: …").

#### Scenario: Two ítems confirmed

- **GIVEN** a receta with two reserved ítems
- **WHEN** its etiquetas are printed
- **THEN** one asiento with both ítems is written

#### Scenario: Ítem 2 fails

- **GIVEN** a receta with three reserved ítems
- **WHEN** ítem 2 fails during the confirmation
- **THEN** nothing persists
- **AND** the message names it ("Ítem 2: …")

### Requirement: R13 — Lock order of Imprimir etiquetas

Lock order SHALL be preparación → receta → partidas with sets: every candidate preparación (id order, one
statement), the receta, every reserved partida of all the ítems (id order, one statement, BEFORE the asiento); the
per-ítem confirmation re-locks rows it already holds. A reserva made between reading the candidates and locking
the receta is not locked: the command refuses ("volvé a intentar").

#### Scenario: Reserva made during the print

- **GIVEN** a reserva made between reading the candidates and locking the receta
- **WHEN** the command reaches the receta lock
- **THEN** it refuses ("volvé a intentar")

### Requirement: R13 — Audit and reprinting

"Imprimir etiquetas" SHALL be audited ONCE on the receta (CONFIRMAR). There is NO per-ítem confirmation of a
reserva. Reprinting: the "Imprimir etiquetas" dialog lists every CONFIRMADA ítem with its etiqueta, in ítem order,
each with its own tamaño and "Imprimir" (one tab per click).

#### Scenario: Receta printed

- **WHEN** the etiquetas of a receta are printed
- **THEN** one CONFIRMAR audit record is written on the receta

#### Scenario: Reprint dialog

- **GIVEN** a receta with CONFIRMADA ítems
- **WHEN** the user opens the "Imprimir etiquetas" dialog to reprint
- **THEN** it lists every CONFIRMADA ítem with its etiqueta, in ítem order, each with its own tamaño and "Imprimir"

### Requirement: R14 — Reserved preparación confirmed only from the toma workspace

**A reserved preparación is confirmed only from the toma workspace.** `preparaciones.confirmar` SHALL refuse a
preparación that holds reservas, checked under its lock; `/preparaciones/[id]` shows "Esta preparación tiene stock
reservado" with a link to the receta.

#### Scenario: Confirming a reserved preparación from its page

- **GIVEN** a preparación that holds reservas
- **WHEN** a user opens `/preparaciones/[id]`
- **THEN** it shows "Esta preparación tiene stock reservado" with a link to the receta

#### Scenario: Confirm command on a reserved preparación

- **GIVEN** a preparación that holds reservas
- **WHEN** `preparaciones.confirmar` runs on it
- **THEN** it is refused

### Requirement: R14 — Descartar refuses a reserved preparación

Likewise `preparaciones.descartar` (the `/preparaciones/[id]` "Descartar" form, no re-authentication) SHALL refuse
it: "Tiene stock reservado: liberá la reserva desde la receta." -- a reserva is only released by "Liberar
reserva".

#### Scenario: Descartar a reserved preparación

- **GIVEN** a preparación that holds reservas
- **WHEN** a user submits "Descartar" on `/preparaciones/[id]`
- **THEN** it is refused with "Tiene stock reservado: liberá la reserva desde la receta."

### Requirement: R15 — Cancelar toma

**"Cancelar toma" SHALL be allowed only while every ítem is Pendiente.**

#### Scenario: An ítem with stock reservado

- **GIVEN** a taken receta with an ítem Stock reservado
- **WHEN** the user tries "Cancelar toma"
- **THEN** it is not allowed

### Requirement: R16 — A preparación starts only from the toma workspace

**A preparación SHALL start only from the toma workspace.** `iniciarPreparacionCommand` stays (internal, no
Server Action); `iniciarPreparacionEnTx` is what `reservarStockPreparacion` runs.

#### Scenario: Ficha técnica screen

- **WHEN** a user opens the ficha técnica screen of an ítem
- **THEN** it offers no "Preparar"

### Requirement: R17 — Toma workspace on a PREPARADA receta

**The toma workspace SHALL stay on a taken PREPARADA receta** (read-only, "Imprimir etiquetas" to reprint); any
other estado redirects to `/recetas/[id]`.

#### Scenario: Taken PREPARADA receta

- **GIVEN** a taken receta PREPARADA
- **WHEN** a user opens its toma workspace
- **THEN** it is shown read-only with "Imprimir etiquetas" to reprint

#### Scenario: ANULADA receta

- **GIVEN** a receta ANULADA
- **WHEN** a user opens its toma workspace
- **THEN** the user is redirected to `/recetas/[id]`

### Requirement: R18 — Vigente ficha

**No reserva on an out-of-date ficha.** A ficha SHALL be *vigente* for its ítem when (a) it is the ítem's LATEST
version and (b) recomputing the ítem's líneas from its CURRENT data (componentes, cantidades, forma, total) with
the current weighing parameters gives exactly its líneas (`mismasLineasPesaje`: droga, unit, enrase flag, teórica,
exceso, a pesar).

#### Scenario: Older ficha version

- **GIVEN** an ítem with two ficha versions
- **WHEN** the older one is evaluated
- **THEN** it is not vigente

#### Scenario: Ítem data changed

- **GIVEN** an ítem whose cantidades changed after its latest ficha was generated
- **WHEN** the ficha is evaluated
- **THEN** it is not vigente

### Requirement: R18 — Same staleness rule as the regeneration

(b) SHALL be the same staleness rule the automatic regeneration after an edit already uses
(`openspec/specs/presupuesto-receta/spec.md`, "Edición"), so "desactualizada" ⇔ generating would create a new
version; a weighing parameter change (exceso, balanza) therefore also makes a ficha desactualizada, which is
intended: the weights would differ.

#### Scenario: Weighing parameter changed

- **GIVEN** a ficha generated before the exceso parameter changed
- **WHEN** the ficha is evaluated
- **THEN** it is desactualizada

### Requirement: R18 — Recomputation chosen over timestamps

Staleness SHALL be decided by recomputation, chosen over timestamps because `item_receta` has no change timestamp,
`editarReceta` rewrites every ítem (even unchanged ones) and a generation that started before an edit committed
could carry an earlier timestamp.

#### Scenario: Edit that leaves an ítem unchanged

- **GIVEN** a receta edit that rewrites an ítem without changing its data
- **WHEN** the ítem's latest ficha is evaluated
- **THEN** it stays vigente

### Requirement: R18 — Unverifiable ficha; refusal and toma display

When the ítem's data no longer computes (V1-V9, a droga dada de baja) the ficha cannot be verified and SHALL count
as desactualizada, with the reason. The reserva refuses a non-vigente ficha ("La ficha técnica de este ítem está
desactualizada…"); the toma workspace shows the ítem "Ficha desactualizada" with "Generar ficha técnica" (or the
note for who lacks `fichas.generar`).

#### Scenario: Droga dada de baja

- **GIVEN** an ítem with a droga dada de baja
- **WHEN** its ficha is evaluated
- **THEN** it counts as desactualizada, with the reason

#### Scenario: Reserving on a desactualizada ficha

- **GIVEN** an ítem whose ficha is desactualizada
- **WHEN** a reserva reaches the server
- **THEN** it is refused with "La ficha técnica de este ítem está desactualizada…"

### Requirement: R18 — Editing does not generate fichas without fichas.generar

Editing a receta SHALL still NOT generate fichas for an editor without `fichas.generar` (GA2): a ficha is a FAR/DT
act (plan §7) and the automatic generation runs after the edit's own transaction by design (a failed generation
never rolls back the receta); the lab regenerates from the toma workspace.

#### Scenario: Editor without fichas.generar

- **GIVEN** an editor without `fichas.generar`
- **WHEN** the editor edits a receta
- **THEN** no ficha is generated

### Requirement: R19 — At most one live preparación per ítem

**At most one live preparación per ítem.** Reserving SHALL check, under the receta and ítem locks, that the ficha
is the ítem's latest version and that the ÍTEM (any ficha version) has no INICIADA or CONFIRMADA preparación --
not only the ficha.

#### Scenario: Live preparación on an older ficha version

- **GIVEN** an ítem with an INICIADA preparación on an older ficha version
- **WHEN** a reserva is requested for the ítem
- **THEN** it is refused

#### Scenario: Stale dialog

- **GIVEN** an ítem already reserved from another tab
- **WHEN** a stale dialog submits a second reserva
- **THEN** it is refused

### Requirement: R19 — Database backstop

The DB backstop SHALL be the partial unique index `uq_preparacion_item_viva` on `(tenant_id, item_receta_id) WHERE
estado IN ('INICIADA','CONFIRMADA')` (migration 0077), next to INV-P02 (`uq_preparacion_ficha_activa`, per ficha)
and INV-PRP-003 (`uq_preparacion_item_confirmada`). A stale dialog can no longer leave a second INICIADA holding
stock forever.

#### Scenario: Second live preparación inserted

- **GIVEN** an ítem with an INICIADA preparación
- **WHEN** a second INICIADA preparación for the same ítem is inserted
- **THEN** `uq_preparacion_item_viva` refuses it

### Requirement: R20 — No new ficha version while a preparación lives

**No new ficha version while the ítem holds a live preparación.** `fichas.generar` SHALL refuse while an INICIADA
preparación lives ("Este ítem tiene stock reservado: liberá la reserva antes de generar una nueva versión de su
ficha técnica.") as it already did for CONFIRMADA; the ficha screen hides "Generar nueva versión" then.

#### Scenario: Generating with stock reserved

- **GIVEN** an ítem with an INICIADA preparación
- **WHEN** a user generates a new ficha version
- **THEN** it is refused with "Este ítem tiene stock reservado: liberá la reserva antes de generar una nueva versión de su ficha técnica."

#### Scenario: Ficha screen with stock reserved

- **GIVEN** an ítem with an INICIADA preparación
- **WHEN** a user opens its ficha screen
- **THEN** "Generar nueva versión" is hidden

### Requirement: R20 — Toma shows the live preparación's ficha

The toma workspace SHALL show (and print) the ficha of the ítem's live preparación, never just the latest version.

#### Scenario: Live preparación on an older ficha

- **GIVEN** an ítem whose live preparación uses an older ficha version
- **WHEN** the toma workspace is shown
- **THEN** it shows and prints that preparación's ficha

### Requirement: R21 — Partidas para pesar of a Pendiente ítem

**"Partidas para pesar" shows the automatic assignment.** For a Pendiente ítem with a vigente ficha, every
non-manual línea SHALL list the partidas the reserva will take, in order, with the quantity of each (physical,
purity-corrected, línea unit) and its expiry warning; a línea without enough stock shows its faltante; expired
partidas with saldo are listed apart as not available.

#### Scenario: Expired partida with saldo

- **GIVEN** a Pendiente ítem with a vigente ficha and an expired partida with saldo of a línea's droga
- **WHEN** the toma workspace is shown
- **THEN** that partida is listed apart as not available

#### Scenario: Línea without enough stock

- **GIVEN** a Pendiente ítem with a vigente ficha whose non-manual línea lacks stock
- **WHEN** the toma workspace is shown
- **THEN** the línea shows its faltante

### Requirement: R21 — Same computation; reserved ítem; draft preview

The assignment SHALL be computed with the same `repartirLinea` over the same candidates as R1 (each ítem on its
own: two ítems of the same droga each show the full candidate set until the first is reserved). A reserved ítem
lists its reservas instead. The draft ficha preview of an unsaved ítem (alta/edición) shows the same assignment
(2026-10-17).

#### Scenario: Two ítems of the same droga

- **GIVEN** two Pendiente ítems of the same droga
- **WHEN** the toma workspace is shown before either is reserved
- **THEN** each ítem shows the full candidate set

#### Scenario: Reserved ítem

- **GIVEN** a Stock reservado ítem
- **WHEN** the toma workspace is shown
- **THEN** its card lists its reservas

#### Scenario: Unsaved ítem

- **WHEN** the draft ficha preview of an unsaved ítem is shown in the alta or edición
- **THEN** it shows the same assignment

### Requirement: R22 — No etiqueta for a preparado no longer valid

**No etiqueta for a preparado no longer valid.** Generating, reading for print and the PDF route SHALL refuse a
preparación whose SISTEMA asiento was dejado sin efecto (ANULADO, or it has a rectificativo -- the same
"SIN_EFECTO" rule as the entregas' `estadoAsiento`) or whose receta is ANULADA, with a clear message; "Seleccionar
etiquetas" lists such an ítem disabled with the reason.

#### Scenario: Asiento anulado

- **GIVEN** a preparación whose SISTEMA asiento is ANULADO
- **WHEN** its etiqueta PDF is requested
- **THEN** it is refused with a clear message

#### Scenario: Seleccionar etiquetas

- **GIVEN** a receta with an ítem whose asiento has a rectificativo
- **WHEN** "Seleccionar etiquetas" is opened
- **THEN** that ítem is listed disabled with the reason

### Requirement: R23 — Lock order

**Lock order** (every path, outermost first) SHALL be: ficha advisory lock (reserva only) → preparación(es) (id
order) → receta → item_receta (reserva only) → partidas (one id-ordered statement per command; later statements
only re-lock).

#### Scenario: Any path

- **WHEN** any path of this spec takes locks
- **THEN** it takes them in that order, partidas in one id-ordered statement

### Requirement: R23 — Lock order per command

The commands SHALL lock as follows. Reserva: ficha → receta → item → partidas (it inserts, never locks, a
preparación). Recalcular: preparación → partidas. Pérdida: preparación → receta → partidas. Imprimir etiquetas:
preparaciones → receta → partidas. `/preparaciones/[id]` confirmation: preparación → receta → partidas (the
receta lock moved BEFORE the partidas, 2026-10-15).

#### Scenario: Confirmation from /preparaciones/[id]

- **WHEN** a preparación is confirmed from `/preparaciones/[id]`
- **THEN** it locks the preparación, then the receta, then the partidas

### Requirement: R23 — Other writers

Other writers SHALL lock: `editarReceta` receta → item_receta; `anularReceta`, `tomarReceta`, `cancelarToma`
receta; `generarFichaTecnica` item_receta. No path takes them in another order, so none can deadlock with another.

#### Scenario: Pérdida and Imprimir etiquetas at the same time

- **WHEN** a pérdida and "Imprimir etiquetas" run concurrently on the same receta
- **THEN** they do not deadlock

### Requirement: R24 — Receta estado re-checked under its lock

**The receta's estado is re-checked under its lock.** Reserving SHALL lock the receta BEFORE inserting the
preparación and re-read its estado: only PENDIENTE_PREPARACION / EN_PREPARACION (an ANULADA, PREPARADA or delivered
receta is refused). A confirmation refuses a receta outside those estados too (it never writes an asiento for an
ANULADA/terminal receta) instead of skipping the estado move.

#### Scenario: Receta annulled before the reserva commits

- **GIVEN** a receta that became ANULADA after the dialog opened
- **WHEN** the reserva runs
- **THEN** it is refused

#### Scenario: Confirmation of an ANULADA receta

- **GIVEN** a receta ANULADA with an INICIADA preparación
- **WHEN** a confirmation runs
- **THEN** it is refused and no asiento is written

### Requirement: R25 — Different purities: the user chooses the lot

**Different purities: the user chooses the lot** (DT decision, 2026-10-18). **Superseded in part by
`openspec/specs/pesada-real/spec.md` (P1, 2026-10-19): every línea now lists its lots, pre-checked with the
automatic plan's; the purity warning stays for this case.** This rule SHALL apply when a non-manual línea's
eligible partidas with balance declare different purities (`potencia_declarada`, NULL = 100 %): then the automatic
plan is not enough.

#### Scenario: Lot of 98 % and lot without potencia declarada

- **GIVEN** a non-manual línea whose eligible partidas with balance declare 98 % and NULL
- **WHEN** the dialog is shown
- **THEN** the purities count as different (NULL = 100 %) and the automatic plan is not enough

### Requirement: R25 — Why, and the lot checkboxes

The automatic plan is not enough because the lab weighing from another bottle than the plan's would get the dose
wrong. The reserva / recalcular / `/preparaciones/[id]` dialog SHALL then list those partidas (abiertas first, then
FEFO) with lote, vence, disponible and pureza as checkboxes, none checked (a recalculation pre-checks the current
reserva's), and block the submit until one is checked.

#### Scenario: Nothing checked

- **GIVEN** a línea whose eligible partidas differ in purity
- **WHEN** the reserva dialog opens
- **THEN** the partidas are listed with lote, vence, disponible and pureza, none checked
- **AND** the submit is blocked until one is checked

#### Scenario: Recalculation

- **GIVEN** a reserved línea whose eligible partidas differ in purity
- **WHEN** the recalcular dialog opens
- **THEN** the current reserva's partidas are pre-checked

### Requirement: R25 — Split over the checked lots

The split SHALL run over the checked ones only, in the same order: one that covers the línea is enough; with
several, the first is used up and the rest comes from the next; not enough -> faltante "en los lotes elegidos".

#### Scenario: Two checked lots

- **GIVEN** two checked lots and a first lot that does not cover the línea
- **WHEN** the split runs
- **THEN** the first lot is used up and the rest comes from the next

#### Scenario: Checked lots not enough

- **WHEN** the checked lots do not cover the línea
- **THEN** a faltante "en los lotes elegidos" is shown

### Requirement: R25 — Server handling of the chosen lots

The server SHALL apply `partidaIds` only for a non-manual línea whose eligible partidas with balance declare
different purities (ignored otherwise), leave out a chosen partida no longer
available and refuse when none is left ("elegí de qué lote se pesa"). INV-S15 desvío is compared with the proposal
over every eligible partida, INV-S18 as always.

#### Scenario: Lots sent for a línea of equal purities

- **GIVEN** a línea whose eligible partidas have equal purities
- **WHEN** `partidaIds` are sent for it
- **THEN** they are ignored

#### Scenario: No chosen lot left

- **GIVEN** a línea whose eligible partidas differ in purity
- **WHEN** none of the chosen partidas is still available
- **THEN** it is refused with "elegí de qué lote se pesa"

### Requirement: R25 — Defaults and exceptions

"Recalcular reserva" and "Registrar pérdida"'s re-plan (R9) SHALL default to the reserva's own partidas for a
non-manual línea whose eligible partidas with balance declare different purities. Equal purities, or an enrase manual línea (never purity-corrected), keep the automatic plan. The toma card
already shows "Pesar" per lot by purity (R21).

#### Scenario: Pérdida on a línea of different purities

- **GIVEN** a reserved línea whose eligible partidas differ in purity
- **WHEN** a pérdida re-plans the reserva
- **THEN** the re-plan uses the reserva's own partidas for that línea

#### Scenario: Enrase manual línea

- **GIVEN** an enrase manual línea whose partidas differ in purity
- **WHEN** the dialog is shown
- **THEN** the línea keeps the automatic plan

### Requirement: R26 — Marked as preparada listed in Confirmadas

**Marked as preparada = listed in Confirmadas until printed** (user decision, 2026-10-22). The /preparaciones
Confirmadas tab SHALL also list every INICIADA preparación that holds a reserva, badge "Sin imprimir", with
**"Editar preparación"** (opens the toma workspace, where "Liberar reserva" sends the ítem back to Pendiente, so
the receta is back in En curso, or "Imprimir etiquetas" continues; whoever prints may not be who prepared, so the
list names no stock action).

#### Scenario: Reserved preparación

- **GIVEN** an INICIADA preparación that holds a reserva
- **WHEN** a user opens the Confirmadas tab of /preparaciones
- **THEN** it is listed with the badge "Sin imprimir" and "Editar preparación"

#### Scenario: Released from Editar preparación

- **GIVEN** a reserved ítem opened through "Editar preparación"
- **WHEN** the user clicks "Liberar reserva"
- **THEN** the ítem is Pendiente and the receta is back in En curso

### Requirement: R26 — En curso and Imprimir

En curso SHALL list a receta only while an ítem is still to prepare (neither confirmed nor reserved): once every
ítem is reserved it leaves En curso and waits here (in the Confirmadas tab), one flow for whoever prints and **"Imprimir"**, which opens the
toma workspace with "Imprimir etiquetas" already open (`?imprimir=1`; stays closed while the button is disabled).

#### Scenario: Every ítem reserved

- **GIVEN** a receta whose every ítem is reserved
- **WHEN** a user opens /preparaciones
- **THEN** the receta is not in En curso and its preparaciones are in Confirmadas

#### Scenario: Imprimir from the list

- **WHEN** the user clicks "Imprimir" on a listed preparación
- **THEN** the toma workspace opens with "Imprimir etiquetas" already open

#### Scenario: Imprimir with the button disabled

- **GIVEN** a receta whose "Imprimir etiquetas" button is disabled
- **WHEN** the toma workspace opens with `?imprimir=1`
- **THEN** the dialog stays closed

### Requirement: R26 — Nothing confirmed from the list

Printing SHALL still confirm the WHOLE receta (R13); nothing is confirmed from the list. Once printed (CONFIRMADA,
asiento) there is no going back from this screen. "Sin etiqueta impresa" includes them.

#### Scenario: Sin etiqueta impresa

- **GIVEN** an INICIADA preparación that holds a reserva
- **WHEN** a user filters "Sin etiqueta impresa"
- **THEN** the preparación is included

### Requirement: R7 — Permisos and audit

Permisos SHALL be: reservar and recalcular = `preparaciones.confirmar` (reservar also `preparaciones.iniciar`);
liberar = `preparaciones.descartar`; "Imprimir etiquetas" = `preparaciones.confirmar` + `etiquetas.generar` (+
`etiquetas.imprimir` for the dialog / PDF). Each step audited in its own transaction (CREAR / MODIFICAR / DESCARTAR
/ CONFIRMAR on the preparación).

#### Scenario: Reserving without preparaciones.iniciar

- **GIVEN** a user with `preparaciones.confirmar` and without `preparaciones.iniciar`
- **WHEN** the user marks an ítem as preparada
- **THEN** it is refused

#### Scenario: Printing without etiquetas.generar

- **GIVEN** a user with `preparaciones.confirmar` and without `etiquetas.generar`
- **WHEN** the user prints the etiquetas of a receta
- **THEN** it is refused

#### Scenario: Releasing

- **GIVEN** a user with `preparaciones.descartar`
- **WHEN** the user releases a reserva
- **THEN** the preparación is DESCARTADA and the step is audited as DESCARTAR in its own transaction

## Status

Status: implemented 2026-10-08 (migrations 0071, 0072; units fix R12: 0073); receta-level
"Imprimir etiquetas" replaced the per-ítem one 2026-10-14 (R13, R17, no schema change).
**2026-10-15: automatic reserva** (R1, R1b, R2, R9 revised: no partida choice, DT decision) and the
consistency fixes R18-R23 (migration 0077: at most one live preparación per ítem). **2026-10-18:** a línea
whose partidas differ in purity asks which lot(s) to weigh from (R25, DT decision; no schema change). Rollback:
`docs/rollbacks/reserva-stock-preparacion.md` (R12: `docs/rollbacks/stock-unidad-base-droga.md`).

## Decision: automatic reserva (DT decision, 2026-10-15)

The Director Técnico found choosing partidas per línea tedious. The reserva is
made **automatically over ALL eligible partidas of the droga**, in the existing
consumption order: **abiertas first (oldest apertura first), then FEFO** (the
first to expire is consumed first) -- `ordenarParaConsumo` /
`proponerRepartoActivo`, INV-S13/S16/S19/S20. Not by ingreso date. Nobody picks
partidas -- not when reserving, not when recalculating, not on
`/preparaciones/[id]`'s confirmation -- **except** for a línea whose eligible
partidas declare different purities (R25): there the weight depends on the lot,
so the user marks the lot(s). Stock control stays in the stock module (no new
panel).

Eligible = the same as `listPartidasElegiblesDroga`: a partida of the línea's
droga with **available** balance (saldo físico − what OTHER INICIADA
preparaciones reserved, R3) and **not expired** on its vencimiento vigente
(INV-S10, reanálisis-aware).

## Pending

- Flow, "Marcar como preparada" dialog (requirement "Toma workspace — Marcar como preparada dialog"): a one-click
  path when nothing must be typed is PENDING.

## Flow commands

The "Command" column of the original Flow table (toma workspace, `/preparaciones/recetas/[recetaId]`), verbatim,
keyed by the requirement that now holds the rest of each row.

| Requirement | Command |
|---|---|
| Toma workspace — Marcar como preparada | `preparaciones.reservarStock` (`modules/preparaciones/application/reservar-stock-preparacion.ts`) |
| Toma workspace — Ficha desactualizada | `fichas.generar` |
| Toma workspace — Recalcular reserva | `preparaciones.recalcularReserva` (`recalcular-reserva-stock.ts`; read: `preparaciones.recalculoDeReserva`, `get-recalculo-de-reserva.ts`) |
| Toma workspace — Registrar pérdida | `preparaciones.registrarPerdida` (`registrar-perdida-reserva.ts`; DT list: `preparaciones.perdida.dtParaCoFirma`) |
| Toma workspace — Liberar reserva | `preparaciones.liberarReserva` (`liberar-reserva-stock.ts`) |
| Toma workspace — Imprimir etiquetas | `preparaciones.confirmarReservasReceta` (`confirmar-reservas-receta.ts`; per ítem `confirmarDesdeReservasEnTx`, `confirmar-desde-reservas.ts`) |
| Toma workspace — reprint | — (each row prints through the existing `GET /api/preparaciones/[id]/etiqueta/pdf?tamano=…`) |

## Enforcement

| # | Enforced in |
|---|---|
| R1 | `planificarConsumoEnTx` (`confirmar-preparacion.ts`, `SeleccionDePartidas`); the split itself: `repartirLinea` (`domain/reparto-linea.ts`), shared with the dialog. |
| R1b | `recalcularReservaStock`. |
| R2 | `reservasDelPlan` (`reservar-stock-preparacion.ts`). |
| R3 | `reservadoPorOtrasSql` (`preparacion-repository.ts`: `listPartidasElegiblesDroga`, `getPartidasFrescas`); `fsj.v_stock_droga` (0071). |
| R4 | Availability SQL joins `preparacion.estado = 'INICIADA'`; `confirmarPreparacionEnTx`, `liberarReservaStock`. |
| R5 | `confirmarPreparacionEnTx` (unchanged checks); `reservaAlcanza` (`getRecetaDeToma`); `RecalcularReservaForm` / `EtiquetasDeReceta` (`ui/reserva-acciones.tsx`). |
| R6 | `iniciarPreparacionEnTx` (no estado move), `confirmarPreparacionEnTx` step 8. |
| R6b | App: `existeFichaConPreparacionParaReceta` / `recetasConFichaConPreparacion` (`p.estado <> 'DESCARTADA'`), `editarReceta`, the edit buttons of `/recetas/[id]`, `/recetas/[id]/editar` and the toma workspace. DB: INV-R11 `fsj.receta_assert_editable` (migration 0030, revised by 0072 to ignore DESCARTADA). |
| R8 | `registrarAjusteEnTx` + `getReservadoEnPreparacion` (`modules/stock`). |
| R9 | `registrarPerdidaReserva`. |
| R10 | `verificarCoFirmaPerdidaCommand`, `registrarPerdidaInternalCommand`. |
| R11 | `reservadoPorPartida` / `getReservadoEnPreparacion` (`partida-repository.ts`), `getPartida`, `listValorizado`. |
| R12 | `planificarConsumoEnTx`, `construirDatosConfirmacion`, `asignacionDeLinea` (`partidas-para-pesar.ts`); DB `fsj.linea_pesaje_validar_consumo` (0073). |
| R13 | `confirmarReservasReceta`, `itemsSinReserva`/`mensajeItemsSinReserva` (`domain/toma.ts`); `EtiquetasDeReceta`, `SeleccionarEtiquetasDialog`. |
| R14 | `confirmarPreparacionCommand`, `descartarPreparacionCommand`, `getPreparacionParaPantalla.conReserva`. |
| R15 | `validarCancelarToma` (`domain/toma.ts`), toma page header. |
| R16 | `app/(app)/recetas/[id]/items/[itemId]/ficha-tecnica/page.tsx`, `modules/preparaciones/ui/actions.ts`. |
| R17 | `ESTADOS_RECETA_VISIBLES_EN_TOMA` (`domain/toma.ts`), toma page. |
| R18 | `evaluarFichaDeItemEnTx` (`modules/elaboracion/application/estado-ficha.ts`), `iniciarPreparacionEnTx`, `recalcularReservaStock`, `getTomaReceta.fichaDesactualizada`, toma page. |
| R19 | `iniciarPreparacionEnTx` (`getPreparacionVivaDeItem`); migration 0077. |
| R20 | `generarFichaTecnica` (`modules/elaboracion`), ficha page `puedeGenerar`; `getRecetaDeToma` (`ficha` = the live preparación's, else the latest). |
| R21 | `asignacionDeLinea` (`partidas-para-pesar.ts`), `LineasFichaTabla`; `previsualizarFichasQuery` (`previsualizar-fichas.ts`). |
| R22 | `motivoEtiquetaNoImprimible` (`domain/etiqueta.ts`) over `getPreparacionParaEtiqueta` (`asientoSinEfecto`, `recetaEstado`); `generarEtiquetaEnTx`, `getEtiquetaParaImprimirQuery`; `getRecetaDeToma.etiquetaNoImprimible`. |
| R23 | The commands above. |
| R24 | `iniciarPreparacionEnTx`, `confirmarPreparacionEnTx`. |
| R25 | `requiereElegirPartida` (`domain/reparto-linea.ts`); `planificarConsumoEnTx` (`lineaEntradaInput.partidaIds`); `entradasDeReserva` (`recalcular-reserva-stock.ts`); `ElegirLotes` (`ui/confirmar-form.tsx`); `parseEntradas` (`ui/actions.ts`, field `partidas_<lineaId>`). |
| R26 | `listPreparaciones` (`wherePestana`, `preparacion-repository.ts`); `/preparaciones` `AccionFila`; `hrefImprimirEtiquetas` (`domain/toma.ts`); `EtiquetasDeReceta.abrirAlMontar`. |
| R7 | The commands. |

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

- ~~Contralor and ajustes~~ **Closed 2026-10-23 (audit P3-01):** `registrarAjusteEnTx` (ajuste, pérdida,
  vencimiento) writes the `asiento_contralor` AJUSTE of a controlled droga once the contralor is active.
- Pérdida motivos are ROTURA and DERRAME only (`domain/perdida.ts`).
- Stock valorizado PDF (`valorizado-pdf.ts`) does not have the reserved column; page and Excel export do.
- **Cotizaciones/presupuestos ignore reservas.** `modules/precios` uses stock
  only to COST an ítem (which partidas FEFO would draw from and their costo
  unitario) over the PHYSICAL saldo; its "Incompleta: stock insuficiente" flag
  ignores what preparaciones INICIADA reserved. A pricing estimate, not a
  reservation (INV-R02); `openspec/specs/presupuesto-receta/spec.md` says the same.
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

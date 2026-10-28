# Pesada real

## Purpose

The lab weighs by hand. What the balance shows never matches the computed
`cantidadAPesar` exactly, and stock, contralor and libro drifted from the real
bottle because they always used the theoretical weight. Now the "Marcar como
preparada" form (and "Recalcular reserva", `/preparaciones/[id]`'s
confirmation) records the **real weighing** of every non-manual línea, and that
is what is consumed.

Implemented 2026-10-19 (migration 0088); on 2026-10-19 the lots and the real weighing moved into the ficha técnica
itself (migrations 0090, 0091, P8-P12). See `## Status`.

## Requirements

### Requirement: Real weighing of every non-manual línea

The "Marcar como preparada" form (and "Recalcular reserva", `/preparaciones/[id]`'s confirmation) SHALL record the
**real weighing** of every non-manual línea, and that is what is consumed.

#### Scenario: Non-manual línea confirmed

- **WHEN** a preparación with a non-manual línea is marked as preparada
- **THEN** the línea's real weighing is recorded
- **AND** the real weighing is what is consumed

### Requirement: P1 — Lot choice for every línea

**Lot choice for every línea.** The form SHALL list the droga's eligible partidas (abiertas first, then FEFO) as
checkboxes, pre-checked with the automatic plan's (the oldest first; an enrase manual línea: the first one to
consume; a recalculation: the current reserva's).

#### Scenario: Línea with several eligible partidas

- **GIVEN** a línea whose droga has an abierta partida and two cerradas
- **WHEN** the form opens
- **THEN** it lists the abierta first, then the cerradas in FEFO order, as checkboxes
- **AND** the automatic plan's partidas are pre-checked, the oldest first

#### Scenario: Enrase manual línea

- **WHEN** the form opens for an enrase manual línea
- **THEN** the first partida to consume is pre-checked

#### Scenario: Recalculation

- **WHEN** the form opens for "Recalcular reserva"
- **THEN** the current reserva's partidas are pre-checked

### Requirement: P1 — Split over the checked lots and purity warning

The split of a línea SHALL run over the checked partidas of the P1 lot choice, in that order
(abiertas first, then FEFO). When the partidas differ in purity the block warns that the weight depends on the lot
(R25 of `openspec/specs/reserva-stock-preparacion/spec.md`).

#### Scenario: Two lots checked

- **GIVEN** two checked partidas of a línea
- **WHEN** the línea is split
- **THEN** it runs over those two, in the listed order

#### Scenario: Lots of different purity

- **WHEN** the listed partidas of a línea differ in purity
- **THEN** the block warns that the weight depends on the lot

### Requirement: P2 — Pesada real field

Every non-manual línea SHALL have a **Pesada real field**, in the línea unit, prefilled with the expected PHYSICAL
weight of the checked lots (purity-corrected) rounded **half-up** to `precision_balanza` (GRAMO; only MASA líneas --
a volumen/unidades línea is not rounded): 0,0455 g → 0,046 g, 0,0454 g → 0,045 g. It follows the lots until the user
types.

#### Scenario: Prefill rounded half-up

- **GIVEN** `precision_balanza` 0,001 g and a MASA línea
- **WHEN** the expected physical weight of the checked lots is 0,0455 g
- **THEN** the field is prefilled with 0,046 g
- **AND** with an expected 0,0454 g it is prefilled with 0,045 g

#### Scenario: Volumen línea

- **WHEN** the field of a volumen or unidades línea is prefilled
- **THEN** the expected weight is not rounded

#### Scenario: Lots changed before typing

- **GIVEN** the user has not typed in the field
- **WHEN** the user changes the checked lots
- **THEN** the field follows the new lots' expected weight

#### Scenario: Lots changed after typing

- **GIVEN** the user typed a pesada real
- **WHEN** the user changes the checked lots
- **THEN** the typed value is kept

### Requirement: P3 — Tolerance

**Tolerance.** The margen SHALL be `max(esperada × tolerancia_pesada_porcentaje / 100, one balance division)`.
`|real − esperada| ≤ margen` is accepted. The margen is never smaller than one balance division.

#### Scenario: Small línea on a coarse balance

- **GIVEN** `tolerancia_pesada_porcentaje` 5 % and a 1 mg balance
- **WHEN** a 9 mg línea is weighed
- **THEN** the margen is 1 mg (9 × 5 / 100 = 0,45 mg is smaller than one division): it accepts ±1 mg (±11 %)

#### Scenario: Deviation equal to the margen

- **GIVEN** `tolerancia_pesada_porcentaje` 5 %, a 0,001 g balance and an esperada of 1,000 g (margen 0,050 g)
- **WHEN** the real weighing is 1,050 g
- **THEN** it is accepted

### Requirement: P3 — Outside the tolerance

When `|real − esperada|` exceeds the P3 margen, the form SHALL show the deviation and the **DT co-firma** (same
block and verification as ajustes/pérdidas: the DT types their own password, failed attempts audited); without it
the server refuses with the deviation and the field marked.

#### Scenario: Pesada outside the margen

- **GIVEN** `tolerancia_pesada_porcentaje` 5 %, a 0,001 g balance and an esperada of 1,000 g (margen 0,050 g)
- **WHEN** the real weighing is 1,051 g
- **THEN** the form shows the deviation and the DT co-firma block

#### Scenario: No co-firma

- **GIVEN** a pesada real outside the margen
- **WHEN** it is sent without the DT co-firma
- **THEN** the server refuses with the deviation and the field marked

#### Scenario: Wrong DT password

- **GIVEN** a pesada real outside the margen
- **WHEN** the DT types a wrong password
- **THEN** the failed attempt is audited

### Requirement: P3 — Tolerance parameter

`tolerancia_pesada_porcentaje` SHALL default to **5 %** (USP <795> allows 90–110 % of the declared active for the
finished preparation; half of that margin is kept for the rest of the process). Editable in Parámetros.

#### Scenario: Default tolerance

- **GIVEN** a farmacia that never edited the parameter
- **WHEN** a pesada real is evaluated
- **THEN** the tolerance is 5 %

#### Scenario: Edited in Parámetros

- **WHEN** a user with `config.editar` edits `tolerancia_pesada_porcentaje` in Parámetros
- **THEN** later pesadas are evaluated with the new value

### Requirement: P4 — What is consumed

**What is consumed.** The real (physical) weight SHALL be consumed, drained over the checked lots in order
(`repartirPesadaReal`), each part keeping its partida's potencia. Stock (`movimiento_stock`), contralor
(`asiento_contralor`) and the libro's detalle use it.

#### Scenario: Real weight over two lots

- **GIVEN** a línea with two checked lots and a pesada real larger than what the first lot holds
- **WHEN** the preparación is confirmed
- **THEN** the real weight drains the first lot, then the second, each part with its partida's potencia
- **AND** stock, contralor and the libro's detalle use the real weight

### Requirement: P5 — Reserva

**Reserva.** `reserva_stock.cantidad_real` and `pesada_autorizada_por_id` SHALL keep the real weighing and the
co-firma until "Imprimir etiquetas". A recalculation or a pérdida's re-plan keeps the stored co-firma only while the
pesada real is the same; a new one outside the tolerance needs a new co-firma.

#### Scenario: Recalculation with the same pesada

- **GIVEN** a reserva with a co-signed pesada real
- **WHEN** "Recalcular reserva" runs with the same pesada real
- **THEN** the stored co-firma is kept

#### Scenario: New pesada outside the tolerance

- **GIVEN** a reserva with a co-signed pesada real
- **WHEN** a recalculation or a pérdida's re-plan brings a different pesada real outside the tolerance
- **THEN** it needs a new co-firma

### Requirement: P6 — Record

**Record.** The confirmation SHALL write one immutable `fsj.pesada_real` row per línea weighed for real: esperada,
real, margen, the DT (outside the margen; a DT vigente on the farmacia's jornada, `fsj.jornada_actual`, INV-U05 --
migration 0103) and who registered it.

#### Scenario: Línea weighed for real

- **WHEN** a preparación with a línea weighed for real is confirmed
- **THEN** one immutable `fsj.pesada_real` row records esperada, real, margen and who registered it

#### Scenario: Co-signed pesada

- **GIVEN** a pesada real outside the margen
- **WHEN** the confirmation is written
- **THEN** the row records the DT, who must be a DT vigente on the farmacia's jornada (`fsj.jornada_actual`)

### Requirement: P6 — Consumption check and audit

For a línea with a `fsj.pesada_real` row, INV-S12 SHALL check the línea's physical consumption equals
`cantidad_real`; a línea without a row keeps the 0073 rule (active consumption = `cantidad_a_pesar`). The audit of
reservar / recalcular lists the pesadas (`pesadasReales`).

#### Scenario: Consumption differs from the pesada real

- **GIVEN** a línea with a `fsj.pesada_real` row
- **WHEN** its physical consumption differs from `cantidad_real`
- **THEN** INV-S12 refuses it

#### Scenario: Línea without a row

- **WHEN** a línea without a `fsj.pesada_real` row is consumed
- **THEN** its active consumption must equal `cantidad_a_pesar`

#### Scenario: Audit of reservar

- **WHEN** a reserva with pesadas reales is made or recalculated
- **THEN** its audit lists the pesadas (`pesadasReales`)

### Requirement: P7 — Enrase manual líneas unchanged

Enrase manual líneas SHALL be unchanged: their typed quantity already is the real one; no tolerance.

#### Scenario: Enrase quantity typed

- **WHEN** the pharmacist types the quantity of an enrase manual línea
- **THEN** that quantity is the real one and no tolerance is checked

### Requirement: Weighing in the ficha

The pharmacist weighs and assembles step by step; leaving everything for the end risks forgetting a weighing. So
the toma workspace's ficha técnica (Pendiente ítem with a vigente ficha, user with `preparaciones.confirmar`) SHALL
be filled in while weighing, and the dialog only confirms (2026-10-19, migration 0090).

#### Scenario: Pendiente ítem with a vigente ficha

- **GIVEN** a user with `preparaciones.confirmar` and a Pendiente ítem with a vigente ficha
- **WHEN** the user opens the ítem in the toma workspace
- **THEN** the ficha técnica is filled in while weighing

### Requirement: P8 — Lot selector per línea

The toma workspace's ficha SHALL show a **lot selector per línea**, in consumption order (abiertas,
then FEFO), preselected with the automatic plan's lots (the oldest; two when the oldest does not cover). Each
option: lote and stock disponible (whole numbers, largest unit); plus the purity when the droga's lots declare one,
"abierta" and the date of a lot por vencer.

#### Scenario: Oldest lot covers the línea

- **WHEN** the oldest lot covers the línea
- **THEN** the selector is preselected with that lot

#### Scenario: Oldest lot does not cover

- **WHEN** the oldest lot does not cover the línea
- **THEN** two lots are preselected

#### Scenario: Option of an abierta lot por vencer

- **GIVEN** a droga whose lots declare a purity
- **WHEN** the selector lists an abierta lot por vencer
- **THEN** the option shows the lote, the stock disponible in whole numbers of the largest unit, the purity, "abierta" and its date

### Requirement: P8 — Agregar otro lote

In the P8 lot selector, "Agregar otro lote" SHALL add another lot when the chosen ones do not cover the línea (or
to split on purpose); the chosen lots are drained in consumption order whatever the order they were picked in
(P1/P4). "A pesar" shows the physical weight over the chosen lots (purity-corrected, rounded to the balance);
split over several lots, each lot's row shows its own share.

#### Scenario: Lots picked out of order

- **GIVEN** a línea where the user picked a newer lot and then added an older one
- **WHEN** the lots are drained
- **THEN** they are drained in consumption order (abiertas first, then FEFO)

#### Scenario: Lot with a different purity

- **GIVEN** 4,5 mg of active and one chosen lot at 0,1 %
- **WHEN** the línea is shown
- **THEN** "A pesar" shows one figure, 4.500 mg, and the lot's row shows none

### Requirement: P9 — Cantidad real pesada column

The ficha SHALL show a **"Cantidad real pesada" column**, right of "A pesar": the P2 field (prefilled, follows the
lots until typed; deviation and tolerance under it), or the enrase manual quantity (P7). The INV-S18 motivo shows
under the línea only when asked.

#### Scenario: Non-manual línea

- **WHEN** the ficha shows a non-manual línea
- **THEN** its "Cantidad real pesada" cell is the P2 field with the deviation and tolerance under it

#### Scenario: Enrase manual línea

- **WHEN** the ficha shows an enrase manual línea
- **THEN** its "Cantidad real pesada" cell is the enrase manual quantity

#### Scenario: INV-S18 motivo

- **WHEN** the INV-S18 motivo is asked for a línea
- **THEN** it shows under that línea, and not otherwise

### Requirement: P10 — Saved as it is filled in

The weighing in the ficha SHALL be **saved as it is filled in**: a lot change at once, a quantity or motivo when its
field is left (or Enter), one draft row per línea (`fsj.pesada_borrador`: lots in order, quantities in the línea's
unit). Survives a reload, another PC or another pharmacist; a regenerated ficha has new líneas and starts clean.

#### Scenario: Lot changed

- **WHEN** the user changes a línea's lot
- **THEN** the draft is saved at once

#### Scenario: Quantity typed

- **WHEN** the user leaves a quantity field (or presses Enter)
- **THEN** the draft is saved

#### Scenario: Another pharmacist opens the ficha

- **GIVEN** a ficha with saved drafts
- **WHEN** another pharmacist opens it from another PC
- **THEN** the lots and quantities are there

#### Scenario: Ficha regenerated

- **WHEN** the ficha is regenerated
- **THEN** its new líneas start clean

### Requirement: P10 — What a weighing draft writes and who saves it

A weighing draft (`fsj.pesada_borrador`) SHALL write no stock, libro or contralor; it is refused once the ítem has a
live preparación. Audited (MODIFICAR on the línea). Permiso `preparaciones.confirmar`, no re-authentication (like
the excipiente); operator PIN on a cuenta de sector.

#### Scenario: Draft saved

- **GIVEN** a user with `preparaciones.confirmar`
- **WHEN** the user saves a draft
- **THEN** no stock, libro or contralor is written, no re-authentication is asked, and it is audited as MODIFICAR on the línea

#### Scenario: Live preparación

- **GIVEN** an ítem with a live preparación
- **WHEN** a draft of one of its líneas is saved
- **THEN** it is refused

#### Scenario: Cuenta de sector

- **GIVEN** a cuenta de sector session
- **WHEN** a draft is saved
- **THEN** the operator PIN is asked

### Requirement: P11 — Marcar como preparada only confirms

"Marcar como preparada" **only confirms**: its dialog SHALL list each línea's lot(s) and real weighing, block while
a línea lacks stock in its lots, a lot or an enrase quantity, and add the DT co-firma when a pesada is outside the
tolerance (P3).

#### Scenario: Línea without a lot

- **WHEN** the dialog opens with a línea without a lot
- **THEN** it is blocked

#### Scenario: Pesada outside the tolerance

- **WHEN** the dialog opens with a pesada outside the tolerance
- **THEN** it adds the DT co-firma

#### Scenario: Everything weighed

- **WHEN** every línea has its lots, stock and quantities
- **THEN** the dialog lists each línea's lot(s) and real weighing

### Requirement: P11 — Fields sent and the full form

The "Marcar como preparada" dialog SHALL send the same fields as before to `reservarStock` -- which re-validates
everything under its locks (P1-P6 unchanged). "Recalcular reserva" and `/preparaciones/[id]` keep the full form.

#### Scenario: Stock changed after the draft

- **GIVEN** a draft whose lots looked enough when the dialog opened
- **WHEN** the dialog is confirmed
- **THEN** `reservarStock` re-validates everything under its locks

#### Scenario: Recalcular reserva

- **WHEN** "Recalcular reserva" or `/preparaciones/[id]`'s confirmation is opened
- **THEN** it shows the full form

### Requirement: P12 — Exceso % column hidden

The ficha's **"Exceso %" column** SHALL be **hidden** while no línea applied an exceso (`exceso_pesada_porcentaje` =
0 when it was generated); it appears by itself once Parámetros sets it above 0.

#### Scenario: Ficha generated without exceso

- **WHEN** the ficha was generated with `exceso_pesada_porcentaje` = 0
- **THEN** the "Exceso %" column is hidden

#### Scenario: Ficha generated with exceso

- **GIVEN** Parámetros sets `exceso_pesada_porcentaje` above 0
- **WHEN** a ficha is generated and shown
- **THEN** the "Exceso %" column appears

### Requirement: Triturados and diluciones

Triturados/diluciones SHALL be done in the moment (excipiente first, droga added up to a readable number): no
separate stock; the droga consumed is the real weighing. Weighing on top of excipiente does not improve the
resolution of the drug's own weight.

#### Scenario: Dilución in the moment

- **WHEN** a droga is diluted on top of excipiente while preparing
- **THEN** no separate stock is created and the droga consumed is its real weighing

## Status

Status: implemented 2026-10-19 (migration 0088). Rollback: `docs/rollbacks/pesada-real.md`.
**2026-10-19, pesada en la ficha** (migrations 0090, 0091): the lots and the real weighing moved from the "Marcar como
preparada" dialog into the ficha técnica itself, saved línea by línea (P8-P12). Rollback: `docs/rollbacks/pesada-borrador.md`.

## Pesada en la ficha (2026-10-19, migration 0090)

The pharmacist weighs and assembles step by step; leaving everything for the end risks forgetting a weighing. So the
toma workspace's ficha técnica (Pendiente ítem with a vigente ficha, user with `preparaciones.confirmar`) is filled in
while weighing, and the dialog only confirms.

## Enforcement

| # | Enforced in |
|---|---|
| P1 | `ElegirLotes`, `lotesPorDefecto` (`ui/confirmar-form.tsx`); `planificarConsumoEnTx` (`partidaIds`). |
| P2 | `pesadaDeLinea`, `PesadaReal` (`ui/confirmar-form.tsx`); `precisionDeLinea`, `redondearABalanza` (`domain/pesada-real.ts`). |
| P3 | `evaluarPesada` (`domain/pesada-real.ts`); `planificarConsumoEnTx`; `autorizacionDePesadaReal` (`application/co-firma-pesada-real.ts`); DB `pesada_real_tolerancia_check`. |
| P4 | `planificarConsumoEnTx`, `confirmarPreparacionEnTx`. |
| P5 | `reservasDelPlan`, `lineasDesdeReservas`, `entradasDeReserva`, `autorizacionesDeReserva`. |
| P6 | Migration 0088 (`fsj.linea_pesaje_validar_consumo`, `trg_pesada_real_validar_autorizacion`, its date fixed by 0103); `pesadasDelPlan`. |
| P7 | — |
| P8 | `PesajeTabla`, `FilasLinea` (`ui/pesaje-en-toma.tsx`) |
| P9 | `CantidadReal` (`ui/pesaje-en-toma.tsx`) |
| P10 | `guardarBorradorPesada` (`application/guardar-borrador-pesada.ts`); migration 0090 |
| P11 | `MarcarPreparadaDialog` (`ui/pesaje-en-toma.tsx`); `ui/confirmar-form.tsx` |
| P12 | `conExceso` (`ui/lineas-ficha-tabla.tsx`) |

## Decisions

- Tolerance default 5 %: no official per-weighing figure was found; the
  accepted reference is USP <795>'s 90–110 % for the finished preparation. The
  DT should confirm whether the Farmacopea Argentina sets another value.
- The margen is never smaller than one balance division: a 9 mg línea on a
  1 mg balance accepts ±1 mg (±11 %), the most the balance can tell.
- Triturados/diluciones are done in the moment (excipiente first, droga added
  up to a readable number): no separate stock; the droga consumed is the real
  weighing. Weighing on top of excipiente does not improve the resolution of
  the drug's own weight.

## Open

- The DT co-firma's vigency is checked by the DB on the confirmation's server
  date (same simplification as INV-U05 for ajustes).

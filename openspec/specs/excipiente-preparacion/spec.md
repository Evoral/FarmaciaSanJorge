# Excipiente de la preparación

## Purpose

The lab records the excipiente it used while it weighs, like the pesada real, and its stock must be real: the
excipiente is chosen from the catalog (no free text), with its quantity, and is descontado like the drogas.

Implemented 2026-10-19 (migration 0092); E9 is a user decision of 2026-10-22. See `## Status`.

## Requirements

### Requirement: E1 — In the ficha, before Marcar como preparada

**In the ficha, before "Marcar como preparada"**, a row "Excipiente" SHALL show under the líneas (Pendiente ítem
with the pesada en la ficha, `openspec/specs/pesada-real/spec.md` P8-P12), with a buscador of the vigente drogas of
**clase EXCIPIENTE** (type to filter; only a listed one can be chosen, like every buscador of the app).

#### Scenario: Pendiente ítem with the pesada en la ficha

- **WHEN** the ficha of a Pendiente ítem with the pesada en la ficha is shown
- **THEN** a row "Excipiente" shows under the líneas with a buscador of the vigente drogas of clase EXCIPIENTE

#### Scenario: Text that matches no excipiente

- **WHEN** the user types a text that is not a listed droga
- **THEN** it can not be chosen

#### Scenario: Droga of another clase

- **WHEN** the user searches a vigente droga of clase DROGA
- **THEN** the buscador does not list it

### Requirement: E1 — Excipiente quantity in the unidad base

The "Excipiente" row of E1 SHALL take the weight typed (the weight of the whole, or per unit; E1b) in the droga's
**unidad base**, in the "Cantidad real pesada" column. The excipiente is optional.

#### Scenario: Quantity typed

- **WHEN** the user chooses an excipiente
- **THEN** its weight is typed in the "Cantidad real pesada" column, in the droga's unidad base

#### Scenario: No excipiente

- **WHEN** the ítem is marked as preparada without an excipiente
- **THEN** nothing is refused for the missing excipiente

### Requirement: E1b — c.s.p.: the weight typed minus the drogas

The user SHALL type the weight of the whole, not the excipiente's. The excipiente to weigh SHALL be that weight minus the ficha's drogas (their cantidad a pesar): `total − drogas`, or `peso por unidad × unidades − drogas`. That quantity is shown in the toma ("A pesar"), printed in the ficha, reserved and descontado. A weight that does not exceed the drogas SHALL be refused. Code: `modules/preparaciones/domain/excipiente-por-unidad.ts`.

#### Scenario: c.s.p.

- **GIVEN** 30 cápsulas of ½ dosis (15 dosis) with Minoxidil 5 mg per dosis (0,075 g)
- **WHEN** the user types Total (c.s.p.) 12 g of Ludipress
- **THEN** the excipiente to weigh is 11,925 g

#### Scenario: Weight below the drogas

- **WHEN** the weight typed does not exceed the drogas
- **THEN** the toma warns and Marcar como preparada is refused

### Requirement: E1c — Por unidad

Formas counted by units (CAPSULA, COMPRIMIDO, OVULO, SUPOSITORIO) MAY type it por unidad ("Por cápsula": one cápsula's weight, even when a cápsula holds half a dosis) or Total (c.s.p.); other formas only the total; never per dosis. Typed por unidad the ficha SHALL print "= 0,3975 g por cápsula" under the total and the libro's fórmula carries the excipiente per dosis ("Ludipress 0,795 g c.s.p."), as c.s.p. "Ludipress c.s.p.".

#### Scenario: Por cápsula

- **GIVEN** the same ítem
- **WHEN** the user types Por cápsula 0,4 g of Ludipress
- **THEN** the excipiente to weigh is 0,4 g × 30 − 0,075 g = 11,925 g (0,3975 g por cápsula) and the libro reads "Ludipress 0,795 g c.s.p."

### Requirement: E1d — Nothing subtracted when not a weight

When the excipiente or any droga of the ficha is not a weight (a volume, units, an enrase manual) nothing SHALL be subtracted: the weight typed is the excipiente's (an enrase) and the toma says so.

#### Scenario: A droga that is not a weight

- **WHEN** a droga of the ficha is in mL or an enrase manual
- **THEN** nothing is subtracted and the toma says so

### Requirement: E2 — Saved as it is filled in

The excipiente SHALL be **saved as it is filled in**: the choice at once, the quantity when left (or Enter); one
draft per ficha técnica (`fsj.excipiente_borrador`). Refused once the ítem has a live preparación. Audited
(MODIFICAR on the ficha).

#### Scenario: Excipiente chosen

- **WHEN** the user chooses an excipiente
- **THEN** the draft is saved at once and audited as MODIFICAR on the ficha

#### Scenario: Quantity left

- **WHEN** the user leaves the quantity field (or presses Enter)
- **THEN** the quantity is saved in the ficha técnica's one draft

#### Scenario: Live preparación

- **GIVEN** an ítem with a live preparación
- **WHEN** its excipiente draft is saved
- **THEN** it is refused

### Requirement: E3 — Quantity required once chosen

The excipiente's **quantity (weight) is required once chosen**: with an excipiente chosen and no quantity, "Marcar como preparada" SHALL be
blocked ("Falta la cantidad del excipiente") and the server refuses it.

#### Scenario: Excipiente without quantity

- **GIVEN** an excipiente chosen without a quantity
- **WHEN** the user tries "Marcar como preparada"
- **THEN** it is blocked with "Falta la cantidad del excipiente"

#### Scenario: Request sent without the quantity

- **GIVEN** an excipiente chosen without a quantity
- **WHEN** the reserva reaches the server
- **THEN** the server refuses it

### Requirement: E4 — Reserved with the drogas

The excipiente SHALL be **reserved with the drogas**, oldest lot first, automatic (abiertas, then FEFO; physical,
no purity correction -- `repartirLinea` as an enrase), over the stock not reserved by others. A shortfall refuses
the reserva with what is missing. The preparación keeps the droga, the quantity (after subtracting the drogas, E1b) and the fórmula's text ("Ludipress 0,795 g" per dosis, "Ludipress" as c.s.p., `excipiente_texto`).

#### Scenario: Excipiente reserved

- **GIVEN** an excipiente with an abierta lot and a cerrada lot
- **WHEN** the ítem is marked as preparada
- **THEN** the excipiente is reserved from the abierta first, its physical quantity without purity correction
- **AND** the preparación keeps the droga, the quantity and the fórmula's text ("Ludipress 12,5 g")

#### Scenario: Excipiente short of stock

- **WHEN** the stock of the excipiente not reserved by others does not cover its quantity
- **THEN** the reserva is refused with what is missing

### Requirement: E5 — Re-planned

The excipiente's reserva SHALL be **re-planned** by "Recalcular reserva" and "Registrar pérdida" (a pérdida may be
registered on the excipiente's lot); computed before anything is deleted, so a shortfall leaves the reserva as it
was.

#### Scenario: Pérdida on the excipiente's lot

- **WHEN** a pérdida is registered on the excipiente's lot
- **THEN** the excipiente's reserva is re-planned

#### Scenario: Shortfall on re-plan

- **WHEN** a recalculation finds the excipiente short of stock
- **THEN** the reserva stays as it was

### Requirement: E6 — Descontado at Imprimir etiquetas

The excipiente SHALL be **descontado at "Imprimir etiquetas"**: EGRESO_PREPARACION over its reserved lots, in the
same transaction as the líneas. Never contralor (an EXCIPIENTE can not be controlled, 0063). In the libro it is in
the **fórmula** ("excipiente utilizado"), not a detalle line (insumos are left out of the detalle, as before).

#### Scenario: Receta printed

- **WHEN** "Imprimir etiquetas" confirms a preparación with an excipiente
- **THEN** an EGRESO_PREPARACION over its reserved lots is written in the same transaction as the líneas
- **AND** no contralor is written for it
- **AND** the libro shows it in the fórmula ("excipiente utilizado"), not as a detalle line

### Requirement: E7 — No línea de pesaje

The excipiente SHALL have **no línea de pesaje**: fichas are immutable and the prescription is not altered, so its
reserva and egreso have `linea_pesaje_id` NULL -- allowed by the DB ONLY for the preparación's excipiente (the
partida's droga = `preparacion.excipiente_droga_id`, a droga of clase EXCIPIENTE) or one of its insumos (migration
0110, `openspec/specs/insumos-preparacion/spec.md` I10). A droga is never both, so the excipiente's línea-less rows
are the ones of its droga.

#### Scenario: Excipiente reserva

- **WHEN** the excipiente is reserved and consumed
- **THEN** its reserva and egreso have `linea_pesaje_id` NULL and the ficha is not changed

#### Scenario: Another droga without a línea

- **WHEN** a reserva or egreso with `linea_pesaje_id` NULL is written for a partida whose droga is neither the preparación's `excipiente_droga_id` nor one of its insumos
- **THEN** the DB refuses it

### Requirement: E8 — Read-only once reserved

The excipiente SHALL be **read-only once reserved** ("Excipiente utilizado: …"); to change it, "Liberar reserva" and
mark it again. "Liberar reserva" releases its stock with the rest.

#### Scenario: Reserved ítem

- **WHEN** the toma shows an ítem whose reserva includes an excipiente
- **THEN** it shows "Excipiente utilizado: …" read-only

#### Scenario: Liberar reserva

- **WHEN** the user runs "Liberar reserva"
- **THEN** the excipiente's stock is released with the rest

### Requirement: E9 — Second chance in Marcar como preparada

**Second chance in "Marcar como preparada"** (user decision, 2026-10-22): when the dialog opens with no excipiente
added in the ficha, it SHALL show the same buscador (clase EXCIPIENTE only) and quantity field; what is chosen there
is the same draft as the ficha's row (saved the same way). With an excipiente already added the dialog lists it
read-only, as before.

#### Scenario: No excipiente in the ficha

- **WHEN** "Marcar como preparada" opens with no excipiente added in the ficha
- **THEN** it shows the buscador (clase EXCIPIENTE only) and the quantity field
- **AND** what is chosen there is saved as the ficha's draft

#### Scenario: Excipiente already added

- **WHEN** "Marcar como preparada" opens with an excipiente added in the ficha
- **THEN** the dialog lists it read-only

### Requirement: Excipiente lot always automatic

The excipiente's lot SHALL always be automatic, oldest first (owner decision 2026-10-19: it is an excipiente, no lot
choice needed).

#### Scenario: No lot selector

- **WHEN** the user records the excipiente
- **THEN** no lot can be chosen

### Requirement: Excipiente unit

The excipiente's unit SHALL be the droga's unidad base (no unit selector).

#### Scenario: Quantity field

- **WHEN** the user types the excipiente's weight
- **THEN** it is in the droga's unidad base and no unit can be chosen

### Requirement: Reservations made before 0092

Reservations made before 0092 SHALL keep their free-text excipiente; they show it read-only.

#### Scenario: Older reserva

- **GIVEN** a reserva made before migration 0092 with a free-text excipiente
- **WHEN** the toma shows it
- **THEN** the free text is shown read-only

## Status

Status: implemented 2026-10-19 (migration 0092). Rollback: `docs/rollbacks/excipiente-preparacion.md`.
Replaces the free-text "Excipiente utilizado" of a reserved ítem (migration 0083). E7 modified 2026-10-29 by change
`insumos-preparacion` (migration 0110): the material and insumos adicionales below the excipiente.

## Enforcement

| # | Enforced in |
|---|---|
| E1 | `FilaExcipiente` (`ui/pesaje-en-toma.tsx`) |
| E2 | `guardarExcipienteBorrador`; migration 0092 |
| E3 | `MarcarPreparadaDialog`; `reservarStock` input |
| E4 | `reservarExcipienteEnTx` (`application/excipiente-preparacion.ts`) |
| E5 | `replanificarExcipienteEnTx`, `guardarReservaExcipienteEnTx` |
| E6 | `consumirExcipienteEnTx`; `confirmarPreparacionEnTx` |
| E7 | Migration 0092 triggers (relaxed by 0110 for the insumos) |
| E8 | Toma page |
| E9 | `MarcarPreparadaDialog`, `BuscadorExcipiente` / `CantidadExcipiente` (`ui/pesaje-en-toma.tsx`) |

## Decisions

- Lot: always automatic, oldest first (owner decision 2026-10-19: it is an excipiente, no lot choice needed).
- Unit: the droga's unidad base (no unit selector).
- Reservations made before 0092 keep their free-text excipiente; they show it read-only.

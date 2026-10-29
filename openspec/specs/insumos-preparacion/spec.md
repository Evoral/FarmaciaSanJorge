# Insumos de la preparación (material e insumos adicionales)

## Purpose

Next to the excipiente (`openspec/specs/excipiente-preparacion/spec.md`), the lab records the other insumos it used
-- the cápsula type, the frasco, an extra excipiente -- chosen from the catalog with their quantity, and their stock
is real: reserved and descontado with the drogas, with exactly the excipiente's mechanics.

User decision 2026-10-29. Implemented by change `openspec/changes/insumos-preparacion/` (migration 0110). See `## Status`.

## Requirements

### Requirement: I1 — Material row in the ficha

Under the "Excipiente" row of the ficha (Pendiente ítem with the pesada en la ficha), a row "Material" SHALL show
with a buscador of the vigente drogas of **clase MATERIAL** only (found by their sinónimos too; only a listed one can
be chosen) and its quantity in the "Cantidad real pesada" column, in the droga's **unidad base**, whose symbol is
taken from the chosen droga (never hardcoded). The material is optional.

#### Scenario: Material chosen

- **WHEN** the user chooses a material in the "Material" row
- **THEN** its quantity is typed in the droga's unidad base, shown with that unidad's symbol

#### Scenario: Droga of another clase

- **WHEN** the user searches a vigente droga of clase DROGA or EXCIPIENTE in the "Material" row
- **THEN** the buscador does not list it

### Requirement: I2 — Cápsulas pre-fill

When the ítem's forma is CAPSULA, the "Material" row's quantity SHALL be **pre-filled with the ítem's number of
cápsulas**, with no material chosen: the user picks the cápsula type to confirm it. A quantity without a material MUST
be ignored: nothing is reserved nor descontado for it and it never blocks "Marcar como preparada".

#### Scenario: Ítem of 60 cápsulas

- **GIVEN** an ítem of forma CAPSULA with 60 cápsulas
- **WHEN** its ficha is shown
- **THEN** the "Material" row's quantity shows 60 and no material is chosen

#### Scenario: No cápsula chosen

- **GIVEN** the cápsulas' quantity pre-filled and no material chosen
- **WHEN** the ítem is marked as preparada
- **THEN** nothing is refused and no material stock is reserved

### Requirement: I3 — Agregar insumo

An "Agregar insumo" button SHALL add rows, any number, each with a buscador of the vigente drogas of **clase
EXCIPIENTE or MATERIAL** and its own quantity in that droga's unidad base. Each row can be removed while the ítem is
not reserved.

#### Scenario: Extra insumo

- **WHEN** the user presses "Agregar insumo" and chooses a droga of clase EXCIPIENTE or MATERIAL
- **THEN** a row with that droga and its quantity field (in its unidad base) is added

#### Scenario: Row removed

- **WHEN** the user removes an insumo row before reserving
- **THEN** it is no longer in the draft and nothing is reserved for it

### Requirement: I4 — Saved as it is filled in

The material and the insumos adicionales SHALL be **saved as they are filled in** (a droga chosen or a row removed at
once, a quantity when left or on Enter), the whole list per ficha técnica (`fsj.insumo_borrador`), refused once the
ítem has a live preparación, audited as MODIFICAR on the ficha.

#### Scenario: Insumo chosen

- **WHEN** the user chooses the material or an insumo adicional
- **THEN** the ficha's insumos draft is saved at once and audited as MODIFICAR on the ficha

#### Scenario: Live preparación

- **GIVEN** an ítem with a live preparación
- **WHEN** its insumos draft is saved
- **THEN** it is refused

### Requirement: I5 — Quantity required once chosen

Once a material or an insumo adicional is chosen its quantity is required (editable): with a chosen one and no valid
quantity, "Marcar como preparada" SHALL be blocked ("Falta la cantidad del material" / "Falta la cantidad de un
insumo") and the server refuses it.

#### Scenario: Material without quantity

- **GIVEN** a material chosen without a quantity
- **WHEN** the user tries "Marcar como preparada"
- **THEN** it is blocked with "Falta la cantidad del material"

#### Scenario: Request sent without the quantity

- **GIVEN** an insumo chosen without a quantity
- **WHEN** the reserva reaches the server
- **THEN** the server refuses it

### Requirement: I6 — Reserved with the drogas

Each chosen insumo SHALL be **reserved with the drogas** at "Marcar como preparada", oldest lot first, automatic
(abiertas, then FEFO; physical, no purity correction), over the stock not reserved by others; a shortfall refuses the
reserva with what is missing. The preparación keeps each insumo's droga, quantity, kind and text
(`fsj.insumo_preparacion`). The droga MUST be vigente and of the admitted clase (Material: MATERIAL; adicional:
EXCIPIENTE or MATERIAL), and there is at most one material.

#### Scenario: Insumo reserved

- **GIVEN** a material with an abierta lot and a cerrada lot
- **WHEN** the ítem is marked as preparada
- **THEN** the material is reserved from the abierta first
- **AND** the preparación keeps its droga, quantity and text

#### Scenario: Insumo short of stock

- **WHEN** the stock of an insumo not reserved by others does not cover its quantity
- **THEN** the reserva is refused with what is missing

### Requirement: I7 — Re-planned

The insumos' reservas SHALL be **re-planned** by "Recalcular reserva" and "Registrar pérdida" (a pérdida may be
registered on an insumo's lot), computed before anything is deleted, so a shortfall leaves the reserva as it was.

#### Scenario: Pérdida on an insumo's lot

- **WHEN** a pérdida is registered on the material's lot
- **THEN** the material's reserva is re-planned

#### Scenario: Shortfall on re-plan

- **WHEN** a recalculation finds an insumo short of stock
- **THEN** the reserva stays as it was

### Requirement: I8 — A droga once

The same droga MUST NOT appear twice across the excipiente, the material and the insumos adicionales: the server
SHALL refuse it with a clear message (draft save and reserva), so a reserva without línea maps to exactly one of them.
The buscadores do not offer a droga already used in another row.

#### Scenario: Insumo equal to the excipiente

- **GIVEN** Ludipress chosen as excipiente
- **WHEN** Ludipress is sent as an insumo adicional
- **THEN** it is refused with "Ludipress ya está elegido como excipiente: no lo cargues también como material o insumo."

#### Scenario: Same insumo twice

- **WHEN** the same droga is sent in two insumo rows
- **THEN** it is refused asking to leave it in one row with the total quantity

### Requirement: I9 — Descontado at Imprimir etiquetas

Each insumo SHALL be **descontado at "Imprimir etiquetas"**: EGRESO_PREPARACION over its reserved lots, in the same
transaction as the líneas, never contralor. In the libro the material never appears; an insumo adicional of clase
EXCIPIENTE is in the **fórmula** next to the excipiente utilizado ("Aerosil 0,5 g"); none is a detalle line.

#### Scenario: Receta printed

- **WHEN** "Imprimir etiquetas" confirms a preparación with a material and an EXCIPIENTE adicional
- **THEN** an EGRESO_PREPARACION over each one's reserved lots is written in the same transaction as the líneas
- **AND** no contralor is written for them
- **AND** the fórmula shows the adicional after the excipiente, and the material nowhere in the libro

### Requirement: I10 — No línea de pesaje

The insumos SHALL have **no línea de pesaje**: their reserva and egreso have `linea_pesaje_id` NULL, allowed by the DB
only for the preparación's excipiente or one of its `insumo_preparacion` drogas (clase EXCIPIENTE or MATERIAL, never
DROGA).

#### Scenario: Insumo reserva

- **WHEN** an insumo is reserved and consumed
- **THEN** its reserva and egreso have `linea_pesaje_id` NULL and the ficha is not changed

#### Scenario: Another droga without a línea

- **WHEN** a reserva or egreso with `linea_pesaje_id` NULL is written for a partida whose droga is neither the excipiente nor an insumo of the preparación
- **THEN** the DB refuses it

### Requirement: I11 — Read-only once reserved

The insumos SHALL be **read-only once reserved** ("Material utilizado: …", "Insumos adicionales: …"); to change them,
"Liberar reserva" and mark the ítem again. "Liberar reserva" releases their stock with the rest.

#### Scenario: Reserved ítem

- **WHEN** the toma shows an ítem whose reserva includes a material
- **THEN** it shows "Material utilizado: …" read-only

#### Scenario: Liberar reserva

- **WHEN** the user runs "Liberar reserva"
- **THEN** the insumos' stock is released with the rest

### Requirement: I12 — Second chance in Marcar como preparada

The "Marcar como preparada" dialog SHALL list read-only the insumos already chosen in the ficha when it opened; a
Material not chosen yet shows its buscador (clase MATERIAL only) and quantity, and "Agregar insumo" adds rows there
too. What is chosen there is the same draft as the ficha's rows, saved the same way.

#### Scenario: No cápsula chosen in the ficha

- **GIVEN** a CAPSULA ítem whose material was not chosen in the ficha
- **WHEN** "Marcar como preparada" opens
- **THEN** it shows the material's buscador with the cápsulas' quantity
- **AND** what is chosen there is saved as the ficha's draft

#### Scenario: Insumo already added

- **WHEN** "Marcar como preparada" opens with an insumo adicional added in the ficha
- **THEN** the dialog lists it read-only

## Status

Status: implemented 2026-10-29 (migration 0110), pending verification. Rollback: `docs/rollbacks/insumos-preparacion.md`.

## Enforcement

| # | Enforced in |
|---|---|
| I1 | `FilasInsumos`, `BuscadorInsumo`, `CantidadInsumo` (`ui/pesaje-en-toma.tsx`); `listInsumosParaToma` |
| I2 | `cantidadCapsulas` (`domain/insumo.ts`); `filasInsumoIniciales`; `reservarStockAction` sends only rows with a droga |
| I3 | `FilasInsumos`, `AgregarInsumo` (`ui/pesaje-en-toma.tsx`) |
| I4 | `guardarInsumosBorrador`; migration 0110 (`fsj.insumo_borrador`) |
| I5 | `MarcarPreparadaDialog`; `reservarStock` input (`decimalString`), `validarInsumosEnTx` |
| I6 | `reservarInsumosEnTx`, `validarInsumosEnTx` (`application/insumos-preparacion.ts`); migration 0110 trigger and partial unique index |
| I7 | `replanificarInsumosEnTx`, `guardarReservaInsumosEnTx`; `registrarPerdidaReserva` |
| I8 | `validarInsumosEnTx`, `guardarExcipienteBorrador`, `reservarExcipienteEnTx`; migration 0110 (`insumo_preparacion_droga_key`, trigger) |
| I9 | `consumirInsumosEnTx`; `getItemPrescriptoDePreparacion`, `formatearFormulaPrescripcion` |
| I10 | Migration 0110 (`validar_reserva_excipiente`, `validar_egreso_excipiente`) |
| I11 | Toma page; `liberarReservaStock` (deletes every reserva of the preparación) |
| I12 | `MarcarPreparadaDialog`, `InsumoFijo`, `InsumoEnDialogo` (`ui/pesaje-en-toma.tsx`) |

## Decisions

- Lot: always automatic, oldest first, like the excipiente.
- Unit: the droga's unidad base, its symbol from the droga (materials are in `u`).
- The libro's fórmula lists an EXCIPIENTE adicional as "Aerosil 0,5 g" (its quantity, no "c.s.p."), right after the
  excipiente's "c.s.p." line; a MATERIAL adicional never appears.
- The draft is saved as a whole list (replace), not row by row.

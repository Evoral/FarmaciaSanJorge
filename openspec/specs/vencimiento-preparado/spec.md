# Vencimiento del preparado

## Purpose

The etiqueta used to print a blank "Vence: ______" to fill in by hand. A
preparado now expires a fixed number of calendar months after its
elaboración, and the etiqueta prints it as `Vence: MM/YY` (e.g. `Vence: 03/27`).

Since 2026-10-21 the pharmacist chooses, per ítem and when confirming, a **tipo
de vencimiento**: the estándar (the months above) or one of the shorter limits
for aqueous preparados without a monograph (normativa de preparados magistrales
no estériles: an aqueous preparado without conservante lasts at most 14 days in
the fridge, one with conservante at most 35 days).

Implemented 2026-10-07 (migration 0068, resolves the "Vencimiento" bullet of DP-28); tipo de vencimiento (R9-R14)
implemented 2026-10-21 (migration 0096). See `## Status`.

## Requirements

### Requirement: R1 — Date from the confirmation's jornada

`fecha_vencimiento` SHALL be the **jornada of the confirmation** + the duration of the chosen tipo (R9); for
`ESTANDAR`, `meses_vencimiento_preparado` calendar months. The jornada is the tenant-local date
(`fsj.jornada_actual`), never the server's.

#### Scenario: Estándar with the default 3 months

- **GIVEN** `meses_vencimiento_preparado` 3 and a confirmation on jornada 2026-10-07
- **WHEN** the preparación is confirmed with tipo `ESTANDAR`
- **THEN** `fecha_vencimiento` is 2027-01-07

#### Scenario: Server date differs from the jornada

- **GIVEN** the server's date differs from the tenant's `fsj.jornada_actual`
- **WHEN** a preparación is confirmed
- **THEN** the date is counted from `fsj.jornada_actual`

### Requirement: Counted from the confirmation's jornada, not iniciada_en

The expiry SHALL be **counted from the confirmation's jornada**, not from `iniciada_en`: the elaboración that
matters legally is the one the libro recetario records.

#### Scenario: Preparación started on an earlier day

- **GIVEN** a preparación iniciada on one jornada and confirmed on a later one
- **WHEN** it is confirmed
- **THEN** the expiry counts from the confirmation's jornada

### Requirement: R2 — Adding months clamps to the last day

Adding months SHALL keep the day of the month and **clamp to the last day** of a shorter target month: 2026-01-31
+ 1 → 2026-02-28; 2028-11-30 + 3 → 2029-02-28; 2027-11-29 + 3 → 2028-02-29.

#### Scenario: End of January plus one month

- **WHEN** 1 month is added to 2026-01-31
- **THEN** the result is 2026-02-28

#### Scenario: Into a non-leap February

- **WHEN** 3 months are added to 2028-11-30
- **THEN** the result is 2029-02-28

#### Scenario: Into a leap February

- **WHEN** 3 months are added to 2027-11-29
- **THEN** the result is 2028-02-29

### Requirement: R3 — Months parameter

`meses_vencimiento_preparado` SHALL be a per-tenant parameter: integer between 1 and **60**
(`MESES_VENCIMIENTO_PREPARADO_MAX`), default **3**. A tenant without the row (or with an unusable or out-of-range
value) falls back to 3.

#### Scenario: Value above the cap

- **WHEN** a user with `config.editar` sets `meses_vencimiento_preparado` to 61
- **THEN** it is refused

#### Scenario: Tenant without the row

- **GIVEN** a tenant without a `meses_vencimiento_preparado` row
- **WHEN** a preparación is confirmed with tipo `ESTANDAR`
- **THEN** 3 months are used

#### Scenario: Out-of-range stored value

- **GIVEN** a stored `meses_vencimiento_preparado` out of the 1–60 range
- **WHEN** it is read
- **THEN** 3 is used

### Requirement: Cap enforced on edit and on read

The 60-month cap (`MESES_VENCIMIENTO_PREPARADO_MAX`) SHALL apply both in the admin validator and when reading the
row: an uncapped value could push the date out of Postgres' `date` range and make every confirmation fail.

#### Scenario: Row above the cap

- **GIVEN** a `meses_vencimiento_preparado` row above 60
- **WHEN** a preparación is confirmed
- **THEN** the value is not used as stored and the confirmation does not fail on the date

### Requirement: R4 — Snapshot

The date SHALL be a **snapshot** written on `preparacion.fecha_vencimiento` in the same UPDATE that sets `estado =
CONFIRMADA`. Changing the parameter later never changes an existing preparado, nor a reprinted etiqueta. Snapshot, not
derived at print time: deriving it from `confirmada_en` + the current parameter would silently move the date of
every printed or reprinted label whenever the pharmacist edits the parameter.

#### Scenario: Parameter edited after a confirmation

- **GIVEN** a preparado confirmed with `meses_vencimiento_preparado` 3
- **WHEN** the parameter is changed to 6 and the etiqueta is reprinted
- **THEN** the preparado keeps its date and the reprint prints it

### Requirement: R5 — Frozen after confirmation

After confirmation the date SHALL be frozen: it cannot be changed or cleared, and a preparación that is not
`CONFIRMADA` never carries one.

#### Scenario: Change after confirmation

- **GIVEN** a CONFIRMADA preparación with a `fecha_vencimiento`
- **WHEN** an UPDATE changes or clears it
- **THEN** it is refused

#### Scenario: Preparación not confirmed

- **WHEN** a preparación that is not `CONFIRMADA` is given a `fecha_vencimiento`
- **THEN** it is refused

### Requirement: R6 — No backfill before 0068

Preparaciones confirmed **before** 0068 SHALL have `fecha_vencimiento = NULL` and are **not** backfilled: a
regulatory date is not invented retroactively. Their etiqueta keeps printing the blank `Vence: ______` line, and
INV-P07 stops anyone from filling it in later.

#### Scenario: Old preparación reprinted

- **GIVEN** a preparación confirmed before migration 0068
- **WHEN** its etiqueta is printed
- **THEN** it prints `Vence: ______`

#### Scenario: Filling in an old date

- **GIVEN** a preparación confirmed before migration 0068
- **WHEN** an UPDATE sets its `fecha_vencimiento`
- **THEN** INV-P07 refuses it

### Requirement: R7 — Vence line format

The etiqueta SHALL print `Vence: MM/YY` (month and two-digit year of the stored date); with no date it prints
`Vence: ______`.

#### Scenario: Date stored

- **GIVEN** a stored date in March 2027
- **WHEN** the etiqueta is printed
- **THEN** it prints `Vence: 03/27`

#### Scenario: No date

- **WHEN** the etiqueta of a preparación without a date is printed
- **THEN** it prints `Vence: ______`

### Requirement: R7 — Every print lays out the persisted snapshot

The printed PDF and the persisted `etiqueta.contenido` text SHALL use the same value: every print (first or
reprint) lays out the PERSISTED `etiqueta.contenido` snapshot, parsed back (`parsearContenidoEtiqueta`, the exact
inverse of `formatearContenidoEtiqueta`), never a rebuild from live data (2026-10-15: a later change to the médico,
the DT or the farmacia's data no longer changes a reprint).

#### Scenario: Médico changed before a reprint

- **GIVEN** a printed etiqueta
- **WHEN** the médico's data changes and the etiqueta is reprinted
- **THEN** the reprint lays out the persisted `etiqueta.contenido`, with the old data

### Requirement: R7 — Older text layout

An etiqueta stored in an older text layout that does not parse SHALL be the only one rebuilt from the preparación's
data, as before.

#### Scenario: Unparseable snapshot

- **GIVEN** an etiqueta stored in an older text layout that does not parse
- **WHEN** it is reprinted
- **THEN** it is rebuilt from the preparación's data

### Requirement: R8 — Audit of the date

The confirmation's audit record SHALL include `fechaVencimiento`.

#### Scenario: Confirmation audited

- **WHEN** a preparación is confirmed
- **THEN** its audit record includes `fechaVencimiento`

### Requirement: R9 — Three tipos

There SHALL be three tipos: `ESTANDAR` = `meses_vencimiento_preparado` months (R3); `ACUOSA_CON_CONSERVANTE` = **35
days**; `ACUOSA_SIN_CONSERVANTE` = **14 days**. The day counts are regulatory constants, not tenant parameters: a
farmacia cannot lengthen them.

#### Scenario: Aqueous with conservante

- **WHEN** a preparación is confirmed on jornada 2026-10-21 with tipo `ACUOSA_CON_CONSERVANTE`
- **THEN** `fecha_vencimiento` is 2026-11-25 (35 days)

#### Scenario: Aqueous without conservante

- **WHEN** a preparación is confirmed on jornada 2026-10-21 with tipo `ACUOSA_SIN_CONSERVANTE`
- **THEN** `fecha_vencimiento` is 2026-11-04 (14 days)

#### Scenario: No parameter for the day counts

- **WHEN** a user with `config.editar` opens Parámetros
- **THEN** there is no parameter to lengthen the 35 or 14 days

### Requirement: R10 — Tipo chosen per ítem in the toma

The tipo SHALL be chosen **per ítem** where the preparación is confirmed. In the toma workspace, "Imprimir
etiquetas" opens ONE dialog (scrollable) listing every ítem still to confirm ("Ítem N: nombre"), each with, top to
bottom, "Tamaño de la etiqueta", "Vencimiento" and "Posición en la hoja".

#### Scenario: Receta with two ítems to confirm

- **WHEN** the user clicks "Imprimir etiquetas" on a receta with two ítems to confirm
- **THEN** one scrollable dialog lists "Ítem 1: nombre" and "Ítem 2: nombre"
- **AND** each shows "Tamaño de la etiqueta", "Vencimiento" and "Posición en la hoja", top to bottom

### Requirement: R10 — One Imprimir and the single-preparación form

In the toma's "Imprimir etiquetas" dialog, ONE "Imprimir" SHALL confirm every listed ítem (one asiento, D8) and
open every etiqueta in a single PDF (`openspec/specs/hoja-etiquetas/spec.md` R14). The confirmation form of
`/preparaciones/[id]` (one preparación) has one selector.

#### Scenario: Imprimir in the toma dialog

- **WHEN** the user clicks the dialog's "Imprimir"
- **THEN** every listed ítem is confirmed in one asiento and every etiqueta opens in a single PDF

#### Scenario: Confirmation from the preparación screen

- **WHEN** the user opens the confirmation form of `/preparaciones/[id]`
- **THEN** it has one tipo de vencimiento selector

### Requirement: R10 — Selector default and when it is offered

The tipo de vencimiento selector SHALL start on `ESTANDAR` for every forma farmacéutica; a missing value is
`ESTANDAR`. It is not offered when reserving or recalculating a reserva: nothing is dated then. A refused
confirmation keeps the chosen values (`ReauthAwareForm`).

#### Scenario: Jarabe

- **WHEN** the selector is shown for an ítem in jarabe
- **THEN** it starts on `ESTANDAR`

#### Scenario: Value missing

- **WHEN** a confirmation arrives without a tipo
- **THEN** the tipo is `ESTANDAR`

#### Scenario: Reserving

- **WHEN** the user reserves or recalculates a reserva
- **THEN** no tipo de vencimiento is asked

#### Scenario: Refused confirmation

- **GIVEN** the user chose `ACUOSA_SIN_CONSERVANTE`
- **WHEN** the confirmation is refused
- **THEN** the selector still shows `ACUOSA_SIN_CONSERVANTE`

### Requirement: R11 — Tipo snapshot

The tipo SHALL be snapshotted on `preparacion.tipo_vencimiento` in the same UPDATE as `fecha_vencimiento`, and
frozen with it (INV-P07 extended). A preparación confirmed before 0096 keeps `NULL` (no backfill, as R6).

#### Scenario: Tipo changed after confirmation

- **GIVEN** a CONFIRMADA preparación with a tipo
- **WHEN** an UPDATE changes its `tipo_vencimiento`
- **THEN** it is refused

#### Scenario: Preparación confirmed before 0096

- **GIVEN** a preparación confirmed before migration 0096
- **WHEN** it is read
- **THEN** its `tipo_vencimiento` is `NULL`

### Requirement: R12 — Day-based tipos print the day

A day-based tipo SHALL print the **day**: `Vence: DD/MM/YY` (`14` days can not be told apart in `MM/YY`).
`ESTANDAR` and a legacy `NULL` tipo keep `Vence: MM/YY`.

#### Scenario: Aqueous without conservante

- **GIVEN** tipo `ACUOSA_SIN_CONSERVANTE` and `fecha_vencimiento` 2026-11-04
- **WHEN** the etiqueta is printed
- **THEN** it prints `Vence: 04/11/26`

#### Scenario: Legacy tipo

- **GIVEN** a `NULL` tipo and a date in March 2027
- **WHEN** the etiqueta is printed
- **THEN** it prints `Vence: 03/27`

### Requirement: R13 — Storage note for the fridge

`ACUOSA_SIN_CONSERVANTE` SHALL print the storage note "Conservar en heladera (2 °C a 8 °C)" instead of "Conservar
en lugar fresco y seco".

#### Scenario: Aqueous without conservante

- **WHEN** an etiqueta with tipo `ACUOSA_SIN_CONSERVANTE` is printed
- **THEN** it prints "Conservar en heladera (2 °C a 8 °C)"

#### Scenario: Estándar

- **WHEN** an etiqueta with tipo `ESTANDAR` is printed
- **THEN** it prints "Conservar en lugar fresco y seco"

### Requirement: R14 — Audit of the tipo

The confirmation's audit record SHALL include `tipoVencimiento` next to `fechaVencimiento`.

#### Scenario: Confirmation audited

- **WHEN** a preparación is confirmed
- **THEN** its audit record includes `tipoVencimiento` and `fechaVencimiento`

## Status

Status: implemented 2026-10-07 (migration 0068). Resolves the "Vencimiento"
bullet of DP-28 (`docs/plan-implementacion.md`). Rollback:
`docs/rollbacks/preparacion-fecha-vencimiento.md`.
Tipo de vencimiento (R9-R14): implemented 2026-10-21 (migration 0096). Rollback:
`docs/rollbacks/tipo-vencimiento-preparado.md`.

## Enforcement

| # | Enforced in |
|---|---|
| R1 | `modules/preparaciones/application/confirmar-preparacion.ts` (`calcularVencimientoPorTipo(jornada, tipo, meses)`). |
| R2 | `modules/preparaciones/domain/vencimiento.ts` (pure integer arithmetic, no JS `Date`, so no timezone dependence). |
| R3 | `modules/parametros/domain/parametros-registry.ts` (validator, editable from Admin → Configuración → Parámetros (`app/(app)/admin/configuracion/parametros`)); seeded by `scripts/create-tenant.ts` and migration 0068 (existing tenants); fallback in `getMesesVencimientoPreparado` / `parseMesesVencimientoPreparado`. |
| R4 | `updatePreparacionConfirmada` (same transaction as the stock movements and the asiento). |
| R5 | DB: `INV-P07` in `fsj.preparacion_validar_update()` and CHECK `preparacion_fecha_vencimiento_check` (migration 0068). |
| R6 | Migration 0068 (no backfill); `formatearVenceEtiqueta(null)`. |
| R7 | `modules/preparaciones/domain/etiqueta.ts` (`formatearVenceEtiqueta`, `armarContenidoEtiqueta`, `parsearContenidoEtiqueta`); `getPreparacionParaEtiqueta` loads the date; `imprimirEtiquetaPdf`. |
| R8 | `confirmarPreparacionCommand` (`valorNuevo`) / `confirmarReservasRecetaCommand` (`valorNuevo.preparaciones[]`; the toma workspace confirms at "Imprimir etiquetas", openspec/specs/reserva-stock-preparacion/spec.md). |
| R9 | `modules/preparaciones/domain/vencimiento.ts` (`TIPOS_VENCIMIENTO_PREPARADO`, `DIAS_POR_TIPO_VENCIMIENTO`, `calcularVencimientoPorTipo`). |
| R10 | `modules/preparaciones/ui/tipo-vencimiento-select.tsx`, `reserva-acciones.tsx`, `confirmar-form.tsx`; `confirmarReservasRecetaCommand` (`tiposVencimiento`) / `confirmarPreparacionCommand` (`tipoVencimiento`). |
| R11 | `updatePreparacionConfirmada`; DB: `fsj.preparacion_validar_update()` and CHECK `preparacion_tipo_vencimiento_check` (migration 0096). |
| R12 | `formatearVenceEtiqueta(fecha, tipo)`. |
| R13 | `conservacionEtiqueta(tipo)` (`modules/preparaciones/domain/etiqueta.ts`). |
| R14 | `confirmarPreparacionCommand` / `confirmarReservasRecetaCommand`. |

## Decisions

- **Snapshot, not derived at print time.** Deriving it from `confirmada_en` +
  the current parameter would silently move the date of every printed or
  reprinted label whenever the pharmacist edits the parameter.
- **Counted from the confirmation's jornada**, not from `iniciada_en`: the
  elaboración that matters legally is the one the libro recetario records.
- **Nullable column + no backfill** over a "best effort" backfill from
  `confirmada_en` + 3 months, for the reason in R6.
- The parameter is capped at 60 months (`MESES_VENCIMIENTO_PREPARADO_MAX`),
  both in the admin validator and when reading the row: an uncapped value
  could push the date out of Postgres' `date` range and make every
  confirmation fail.

## Pending

- `DD/MM/YY` (R12) for day-based tipos is decided; `MM/YY` for `ESTANDAR` is
  still the farmacia's current label format.
- Not yet covered (second step): a especialidad medicinal used as materia prima
  caps the expiry at the lesser of 25% of its remaining shelf life and 6 months;
  the 90-day (non-aqueous) and 180-day (solid) limits are not offered as tipos.

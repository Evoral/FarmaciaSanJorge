# Vencimiento del preparado

Status: implemented 2026-10-07 (migration 0068). Resolves the "Vencimiento"
bullet of DP-28 (`docs/plan-implementacion.md`). Rollback:
`docs/rollbacks/preparacion-fecha-vencimiento.md`.
Tipo de vencimiento (R9-R14): implemented 2026-10-21 (migration 0096). Rollback:
`docs/rollbacks/tipo-vencimiento-preparado.md`.

## Goal

The etiqueta used to print a blank "Vence: ______" to fill in by hand. A
preparado now expires a fixed number of calendar months after its
elaboración, and the etiqueta prints it as `Vence: MM/YY` (e.g. `Vence: 03/27`).

Since 2026-10-21 the pharmacist chooses, per ítem and when confirming, a **tipo
de vencimiento**: the estándar (the months above) or one of the shorter limits
for aqueous preparados without a monograph (normativa de preparados magistrales
no estériles: an aqueous preparado without conservante lasts at most 14 days in
the fridge, one with conservante at most 35 days).

## Rules

| # | Rule | Enforced in |
|---|---|---|
| R1 | `fecha_vencimiento` = the **jornada of the confirmation** + the duration of the chosen tipo (R9); for `ESTANDAR`, `meses_vencimiento_preparado` calendar months. The jornada is the tenant-local date (`fsj.jornada_actual`), never the server's. | `modules/preparaciones/application/confirmar-preparacion.ts` (`calcularVencimientoPorTipo(jornada, tipo, meses)`). |
| R2 | Adding months keeps the day of the month and **clamps to the last day** of a shorter target month: 2026-01-31 + 1 → 2026-02-28; 2028-11-30 + 3 → 2029-02-28; 2027-11-29 + 3 → 2028-02-29. | `modules/preparaciones/domain/vencimiento.ts` (pure integer arithmetic, no JS `Date`, so no timezone dependence). |
| R3 | `meses_vencimiento_preparado` is a per-tenant parameter: integer between 1 and **60** (`MESES_VENCIMIENTO_PREPARADO_MAX`), default **3**. A tenant without the row (or with an unusable or out-of-range value) falls back to 3. | `modules/parametros/domain/parametros-registry.ts` (validator, editable from Admin → Configuración → Parámetros (`app/(app)/admin/configuracion/parametros`)); seeded by `scripts/create-tenant.ts` and migration 0068 (existing tenants); fallback in `getMesesVencimientoPreparado` / `parseMesesVencimientoPreparado`. |
| R4 | The date is a **snapshot** written on `preparacion.fecha_vencimiento` in the same UPDATE that sets `estado = CONFIRMADA`. Changing the parameter later never changes an existing preparado, nor a reprinted etiqueta. | `updatePreparacionConfirmada` (same transaction as the stock movements and the asiento). |
| R5 | After confirmation the date is frozen: it cannot be changed or cleared, and a preparación that is not `CONFIRMADA` never carries one. | DB: `INV-P07` in `fsj.preparacion_validar_update()` and CHECK `preparacion_fecha_vencimiento_check` (migration 0068). |
| R6 | Preparaciones confirmed **before** 0068 have `fecha_vencimiento = NULL` and are **not** backfilled: a regulatory date is not invented retroactively. Their etiqueta keeps printing the blank `Vence: ______` line, and INV-P07 stops anyone from filling it in later. | Migration 0068 (no backfill); `formatearVenceEtiqueta(null)`. |
| R7 | The etiqueta prints `Vence: MM/YY` (month and two-digit year of the stored date); with no date it prints `Vence: ______`. The printed PDF and the persisted `etiqueta.contenido` text use the same value: every print (first or reprint) lays out the PERSISTED `etiqueta.contenido` snapshot, parsed back (`parsearContenidoEtiqueta`, the exact inverse of `formatearContenidoEtiqueta`), never a rebuild from live data (2026-10-15: a later change to the médico, the DT or the farmacia's data no longer changes a reprint). Only an etiqueta stored in an older text layout that does not parse is rebuilt from the preparación's data, as before. | `modules/preparaciones/domain/etiqueta.ts` (`formatearVenceEtiqueta`, `armarContenidoEtiqueta`, `parsearContenidoEtiqueta`); `getPreparacionParaEtiqueta` loads the date; `imprimirEtiquetaPdf`. |
| R8 | The confirmation's audit record includes `fechaVencimiento`. | `confirmarPreparacionCommand` (`valorNuevo`) / `confirmarReservasRecetaCommand` (`valorNuevo.preparaciones[]`; the toma workspace confirms at "Imprimir etiquetas", openspec/specs/reserva-stock-preparacion/spec.md). |

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

### Tipo de vencimiento (migration 0096)

| # | Rule | Enforced in |
|---|---|---|
| R9 | Three tipos: `ESTANDAR` = `meses_vencimiento_preparado` months (R3); `ACUOSA_CON_CONSERVANTE` = **35 days**; `ACUOSA_SIN_CONSERVANTE` = **14 days**. The day counts are regulatory constants, not tenant parameters: a farmacia cannot lengthen them. | `modules/preparaciones/domain/vencimiento.ts` (`TIPOS_VENCIMIENTO_PREPARADO`, `DIAS_POR_TIPO_VENCIMIENTO`, `calcularVencimientoPorTipo`). |
| R10 | The tipo is chosen **per ítem** where the preparación is confirmed. In the toma workspace, "Imprimir etiquetas" opens ONE dialog (scrollable) listing every ítem still to confirm ("Ítem N: nombre"), each with, top to bottom, "Tamaño de la etiqueta", "Vencimiento" and "Posición en la hoja"; ONE "Imprimir" confirms them all (one asiento, D8) and opens every etiqueta in a single PDF (openspec/specs/hoja-etiquetas/spec.md R14). The confirmation form of `/preparaciones/[id]` (one preparación) has one selector. The selector starts on `ESTANDAR` for every forma farmacéutica; a missing value is `ESTANDAR`. It is not offered when reserving or recalculating a reserva: nothing is dated then. A refused confirmation keeps the chosen values (`ReauthAwareForm`). | `modules/preparaciones/ui/tipo-vencimiento-select.tsx`, `reserva-acciones.tsx`, `confirmar-form.tsx`; `confirmarReservasRecetaCommand` (`tiposVencimiento`) / `confirmarPreparacionCommand` (`tipoVencimiento`). |
| R11 | The tipo is snapshotted on `preparacion.tipo_vencimiento` in the same UPDATE as `fecha_vencimiento`, and frozen with it (INV-P07 extended). A preparación confirmed before 0096 keeps `NULL` (no backfill, as R6). | `updatePreparacionConfirmada`; DB: `fsj.preparacion_validar_update()` and CHECK `preparacion_tipo_vencimiento_check` (migration 0096). |
| R12 | A day-based tipo prints the **day**: `Vence: DD/MM/YY` (`14` days can not be told apart in `MM/YY`). `ESTANDAR` and a legacy `NULL` tipo keep `Vence: MM/YY`. | `formatearVenceEtiqueta(fecha, tipo)`. |
| R13 | `ACUOSA_SIN_CONSERVANTE` prints the storage note "Conservar en heladera (2 °C a 8 °C)" instead of "Conservar en lugar fresco y seco". | `conservacionEtiqueta(tipo)` (`modules/preparaciones/domain/etiqueta.ts`). |
| R14 | The confirmation's audit record includes `tipoVencimiento` next to `fechaVencimiento`. | `confirmarPreparacionCommand` / `confirmarReservasRecetaCommand`. |

## Pending

- `DD/MM/YY` (R12) for day-based tipos is decided; `MM/YY` for `ESTANDAR` is
  still the farmacia's current label format.
- Not yet covered (second step): a especialidad medicinal used as materia prima
  caps the expiry at the lesser of 25% of its remaining shelf life and 6 months;
  the 90-day (non-aqueous) and 180-day (solid) limits are not offered as tipos.

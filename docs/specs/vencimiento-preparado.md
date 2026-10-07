# Vencimiento del preparado

Status: implemented 2026-10-07 (migration 0068). Resolves the "Vencimiento"
bullet of DP-28 (`docs/plan-implementacion.md`). Rollback:
`docs/rollbacks/preparacion-fecha-vencimiento.md`.

## Goal

The etiqueta used to print a blank "Vence: ______" to fill in by hand. A
preparado now expires a fixed number of calendar months after its
elaboración, and the etiqueta prints it as `Vence: MM/YY` (e.g. `Vence: 03/27`).

## Rules

| # | Rule | Enforced in |
|---|---|---|
| R1 | `fecha_vencimiento` = the **jornada of the confirmation** + `meses_vencimiento_preparado` calendar months. The jornada is the tenant-local date (`fsj.jornada_actual`), never the server's. | `modules/preparaciones/application/confirmar-preparacion.ts` (`calcularVencimientoPreparado(jornada, meses)`). |
| R2 | Adding months keeps the day of the month and **clamps to the last day** of a shorter target month: 2026-01-31 + 1 → 2026-02-28; 2028-11-30 + 3 → 2029-02-28; 2027-11-29 + 3 → 2028-02-29. | `modules/preparaciones/domain/vencimiento.ts` (pure integer arithmetic, no JS `Date`, so no timezone dependence). |
| R3 | `meses_vencimiento_preparado` is a per-tenant parameter: integer between 1 and **60** (`MESES_VENCIMIENTO_PREPARADO_MAX`), default **3**. A tenant without the row (or with an unusable or out-of-range value) falls back to 3. | `modules/parametros/domain/parametros-registry.ts` (validator, editable from Admin → Configuración → Parámetros (`app/(app)/admin/configuracion/parametros`)); seeded by `scripts/create-tenant.ts` and migration 0068 (existing tenants); fallback in `getMesesVencimientoPreparado` / `parseMesesVencimientoPreparado`. |
| R4 | The date is a **snapshot** written on `preparacion.fecha_vencimiento` in the same UPDATE that sets `estado = CONFIRMADA`. Changing the parameter later never changes an existing preparado, nor a reprinted etiqueta. | `updatePreparacionConfirmada` (same transaction as the stock movements and the asiento). |
| R5 | After confirmation the date is frozen: it cannot be changed or cleared, and a preparación that is not `CONFIRMADA` never carries one. | DB: `INV-P07` in `fsj.preparacion_validar_update()` and CHECK `preparacion_fecha_vencimiento_check` (migration 0068). |
| R6 | Preparaciones confirmed **before** 0068 have `fecha_vencimiento = NULL` and are **not** backfilled: a regulatory date is not invented retroactively. Their etiqueta keeps printing the blank `Vence: ______` line, and INV-P07 stops anyone from filling it in later. | Migration 0068 (no backfill); `formatearVenceEtiqueta(null)`. |
| R7 | The etiqueta prints `Vence: MM/YY` (month and two-digit year of the stored date); with no date it prints `Vence: ______`. The printed PDF and the persisted `etiqueta.contenido` text use the same value. | `modules/preparaciones/domain/etiqueta.ts` (`formatearVenceEtiqueta`, `armarContenidoEtiqueta`); `getPreparacionParaEtiqueta` loads the date. |
| R8 | The confirmation's audit record includes `fechaVencimiento`. | `confirmarPreparacionCommand` / `confirmarPreparacionDeFichaCommand` (`valorNuevo`). |

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

- The pharmacist has not yet confirmed whether `MM/YY` is the final format of
  the printed date (it is isolated in `formatearVenceEtiqueta`).

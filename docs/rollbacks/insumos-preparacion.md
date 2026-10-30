# Rollback: insumos de la preparación (material + insumos adicionales)

Spec: `openspec/specs/insumos-preparacion/spec.md`. Change: `openspec/changes/insumos-preparacion/`. Migration 0110.

## What it added

| File | What |
|---|---|
| `prisma/migrations/20261029120000_0110_insumos_preparacion/migration.sql` | Enum `fsj.tipo_insumo`; table `fsj.insumo_preparacion` (+ INV-P08 / clase / not-the-excipiente trigger); 0092's línea-less reserva/egreso triggers relaxed to also accept an insumo's droga; table `fsj.insumo_borrador` (DELETE granted) |
| `prisma/rollbacks/0110_insumos_preparacion.down.sql` | Reverts it (see its header: release the reservas first; keep sections 1-2 if an insumo was already descontado) |
| `prisma/schema.prisma` | `enum TipoInsumo`, `model InsumoPreparacion`, `model InsumoBorrador` |

### New files (delete on rollback)
- `modules/preparaciones/domain/insumo.ts`
- `modules/preparaciones/application/insumos-preparacion.ts`
- `modules/preparaciones/application/guardar-insumos-borrador.ts`

### Changed code
- `application/excipiente-preparacion.ts`: `planificarSinLinea` exported; the excipiente's línea-less rows are now told apart by droga (`listReservasSinLinea` / `deleteReservasSinLinea` / `insertReservasSinLinea` replace the `*ReservasExcipiente` functions); `partidasReservadasExcipienteEnTx` became `partidasReservadasSinLineaEnTx`.
- `reservar-stock-preparacion.ts`, `recalcular-reserva-stock.ts`, `registrar-perdida-reserva.ts`, `confirmar-preparacion.ts`, `confirmar-reservas-receta.ts` (locks the línea-less partidas too): the insumo steps.
- `guardar-excipiente-borrador.ts`: refuses a droga already in the insumos draft.
- `datos-confirmacion.ts`, `get-confirmacion-de-ficha.ts`: the insumo options, draft and cápsulas pre-fill.
- `domain/formula-prescripcion.ts` + `getItemPrescriptoDePreparacion`: EXCIPIENTE adicionales in the fórmula.
- `infrastructure/preparacion-repository.ts`: insumo functions; `getDrogaExcipiente` returns the clase; toma data carries `insumos`.
- `ui/actions.ts`, `ui/pesaje-en-toma.tsx`: draft save, rows, "Agregar insumo", dialog second chance.
- `app/(app)/preparaciones/recetas/[recetaId]/page.tsx`: "Material utilizado" / "Insumos adicionales" read-only lines.
- `shared/labels/field-labels.ts`: `insumos` label. Test mocks in `tests/unit/preparaciones-{m3-lock-order,unidad-stock,asiento-receta}.test.ts`.

## How to revert

1. Release every reserva holding a material or an insumo adicional ("Liberar reserva").
2. Revert the code (the commit).
3. Apply `prisma/rollbacks/0110_insumos_preparacion.down.sql` as a NEW forward migration, in the same deploy. If an
   insumo was already descontado, keep its sections 1-2 (those egresos have no línea) -- see the file's header.
4. `npm run db:generate`.

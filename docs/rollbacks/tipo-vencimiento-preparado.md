# Rollback: Tipo de vencimiento del preparado

Spec: `docs/specs/vencimiento-preparado.md` R9-R14. The feature has a **schema change**
(migration `prisma/migrations/20261021090000_0096_tipo_vencimiento_preparado`), so it is
reverted as code + a new forward migration built from
`prisma/rollbacks/0096_tipo_vencimiento_preparado.down.sql`.

## What the down migration loses

- Every snapshotted `preparacion.tipo_vencimiento`. `fecha_vencimiento` (0068) stays, so
  an aqueous preparado keeps its 14/35-day date; an etiqueta rebuilt from data prints it
  as `Vence: MM/YY` with the generic storage note. The `etiqueta.contenido` text already
  persisted keeps the `DD/MM/YY` date and the heladera note it was generated with.
- INV-P07 goes back to covering `fecha_vencimiento` only (the 0068 body of
  `fsj.preparacion_validar_update()`).

## Order

1. Deploy the reverted code **first**: it neither reads nor writes `tipo_vencimiento`, and
   the column is nullable, so it runs fine against the 0096 schema.
2. Copy `prisma/rollbacks/0096_tipo_vencimiento_preparado.down.sql` into a NEW migration
   folder (next free number, a timestamp later than every existing one) and apply it.
   Never edit or delete the applied 0096 migration.
3. Revert the code (below), `npm run db:generate`, then `npm run typecheck`,
   `npm run lint`, `npm test`.

## New files (delete on rollback)

- `modules/preparaciones/ui/tipo-vencimiento-select.tsx`
- `prisma/rollbacks/0096_tipo_vencimiento_preparado.down.sql` and this file (optional)
- `prisma/migrations/20261021090000_0096_tipo_vencimiento_preparado/` (keep it once applied)

## Edited files (revert the tipo de vencimiento hunks)

- `prisma/schema.prisma`: enum `TipoVencimientoPreparado`, `tipoVencimiento` in `model Preparacion`.
- `modules/preparaciones/domain/vencimiento.ts`: `TIPOS_VENCIMIENTO_PREPARADO`, `DIAS_POR_TIPO_VENCIMIENTO`, `calcularVencimientoPorTipo`, labels.
- `modules/preparaciones/domain/etiqueta.ts`: `tipoVencimiento` in `DatosEtiqueta`, `formatearVenceEtiqueta(fecha, tipo)`, `conservacionEtiqueta`.
- `modules/preparaciones/infrastructure/preparacion-repository.ts`: the `tipoVencimiento` argument of `updatePreparacionConfirmada`, the select/field in `getPreparacionParaEtiqueta`.
- `modules/preparaciones/application/`: `confirmar-preparacion.ts`, `confirmar-desde-reservas.ts`, `confirmar-reservas-receta.ts`, `datos-confirmacion.ts`, `get-toma-receta.ts`.
- `modules/preparaciones/ui/`: `actions.ts`, `confirmar-form.tsx`, `reserva-acciones.tsx`; `app/(app)/preparaciones/recetas/[recetaId]/page.tsx`.
- `shared/errors/mensajes-invariantes.ts`: the `INV-P07` message text.

## Nothing to undo

- No permiso, role, route or parameter was added; no data is backfilled.

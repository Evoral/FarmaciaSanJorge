# Rollback: Vencimiento del preparado

Spec: `docs/specs/vencimiento-preparado.md`. The feature has a **schema change**
(migration `prisma/migrations/20261007120000_0068_preparacion_fecha_vencimiento`),
so it is reverted as code + a new forward migration built from
`prisma/rollbacks/0068_preparacion_fecha_vencimiento.down.sql`.

## What the down migration loses

- Every snapshotted `preparacion.fecha_vencimiento`. Reprinted etiquetas go back
  to the blank `Vence: ______` line. The `etiqueta.contenido` text already
  persisted keeps the date it was generated with.
- INV-P07 (the date is set once, at confirmation) and the CHECK
  `preparacion_fecha_vencimiento_check` disappear with the column.
  `fsj.preparacion_validar_update()` goes back to its migration 0013 body.
- Not lost: the `meses_vencimiento_preparado` rows in `fsj.parametro` stay
  (an orphan row is harmless; delete them by hand if wanted).

## Order

1. Deploy the reverted code **first**: it neither reads nor writes `fecha_vencimiento`, and the
   column is nullable, so it runs fine against the 0068 schema. Dropping the column
   while the current code is live makes every confirmation fail (`column "fecha_vencimiento"
   does not exist`).
2. Copy `prisma/rollbacks/0068_preparacion_fecha_vencimiento.down.sql` into a NEW
   migration folder (next free number, a timestamp later than every existing
   one) and apply it with `npm run db:migrate`. Never edit or delete the applied
   0068 migration (its checksum is in `public._prisma_migrations`).
3. Revert the code (below), `npm run db:generate`, then `npm run typecheck`,
   `npm run lint`, `npm test`.

## New files (delete on rollback)

- `modules/preparaciones/domain/vencimiento.ts`
- `tests/unit/preparaciones-vencimiento.test.ts`
- `docs/specs/vencimiento-preparado.md` and this file (optional)
- `prisma/migrations/20261007120000_0068_preparacion_fecha_vencimiento/` (keep it: applied migrations are history; the down migration undoes it. Delete it only if 0068 was never applied anywhere)

## Edited files (revert the vencimiento hunks)

- `prisma/schema.prisma`: `fechaVencimiento` in `model Preparacion`.
- `modules/parametros/domain/parametros-registry.ts`: `meses_vencimiento_preparado` in `PARAMETRO_CLAVES`, its validator and its `PARAMETROS_REGISTRY` entry.
- `modules/preparaciones/domain/etiqueta.ts`: `fechaVencimiento` in `DatosEtiqueta`, `formatearVenceEtiqueta`, and `armarContenidoEtiqueta` back to `vence: VENCE_ETIQUETA`.
- `modules/preparaciones/infrastructure/preparacion-repository.ts`: the extra `fechaVencimiento` argument of `updatePreparacionConfirmada`, `getMesesVencimientoPreparado`, and the `fechaVencimiento` select/field in `getPreparacionParaEtiqueta`.
- `modules/preparaciones/application/confirmar-preparacion.ts` (`ConfirmacionResultado`, the parameter read, `calcularVencimientoPreparado`, the audit field) and `confirmar-preparacion-de-ficha.ts` (return type, audit field).
- `shared/errors/mensajes-invariantes.ts`: the `INV-P07` message (keep it while the 0068 migration file exists: the global-messages test scans every migration).
- `scripts/create-tenant.ts`: the `meses_vencimiento_preparado` seed row and its comment.
- `docs/plan-implementacion.md`: the DP-28 "Vencimiento" bullet.
- Tests: `tests/unit/parametros-validacion.test.ts`, `preparaciones-etiqueta.test.ts`, `preparaciones-imprimir-etiqueta-pdf.test.ts`, `preparaciones-m3-lock-order.test.ts`, `preparaciones-authorization-matrix.test.ts`, `tests/db/preparacion-etiqueta.test.ts`, `tests/db/preparaciones-confirmar.test.ts`.

## Nothing to undo

- No permiso, role or route was added; the parameter is edited from the existing parameters screen.
- No data is backfilled: preparaciones confirmed before 0068 were never touched.

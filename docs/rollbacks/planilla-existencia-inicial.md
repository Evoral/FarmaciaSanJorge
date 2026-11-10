# Rollback: Planilla de existencia inicial

Spec: `openspec/changes/planilla-existencia-inicial/specs/existencia-inicial/spec.md`. The change introduces a **schema change** (migration `prisma/migrations/20261110120000_0124_planilla_existencia_inicial`), so it is reverted as code + a new forward migration built from `prisma/rollbacks/0124_planilla_existencia_inicial.down.sql`.

## When it can be rolled back

Only while **no corrección inicial movements exist** (`CORRECCION_INICIAL_SUMA` or `CORRECCION_INICIAL_RESTA`). Those movements adjust physical stock, and `movimiento_stock` is append-only: the down script aborts if it finds one. If corrections were already recorded, fix forward instead.

Rows in `fsj.relevamiento_fila` (the draft planilla) will be dropped by the rollback.

## What the down migration loses

- The planilla draft table `fsj.relevamiento_fila` and its unpassed rows.
- The permission `stock.relevamiento.editar`.
- `CORRECCION_INICIAL_SUMA` and `CORRECCION_INICIAL_RESTA` stay in `fsj.tipo_movimiento` (Postgres cannot drop enum values); with no rows using them, they are inert.

## Order

1. Deploy the reverted code **first**: it never writes `relevamiento_fila` nor the two new movement types.
2. Copy `prisma/rollbacks/0124_planilla_existencia_inicial.down.sql` into a NEW migration folder (next free number, a timestamp later than every existing one) and apply it. Never edit or delete the applied 0124 migration.
3. Revert the code (below), `npm run db:generate`, then `npm run typecheck`, `npm run lint`, `npm test`.

## Files affected (delivery 2)

- `prisma/migrations/20261110120000_0124_planilla_existencia_inicial/`
- `prisma/rollbacks/0124_planilla_existencia_inicial.down.sql`
- `prisma/schema.prisma`: `RelevamientoFila`, `CORRECCION_INICIAL_SUMA`, `CORRECCION_INICIAL_RESTA`
- `modules/auth/domain/permisos.ts`: `stock.relevamiento.editar`
- `modules/stock/domain/existencia-inicial.ts`
- `modules/stock/infrastructure/relevamiento-fila-repository.ts`
- `modules/stock/application/guardar-fila-relevamiento.ts`
- `modules/stock/application/quitar-fila-relevamiento.ts`
- `modules/stock/application/get-planilla-relevamiento.ts`
- `modules/stock/application/pasar-grupo-a-stock.ts`
- `modules/stock/application/resumen-relevamiento.ts`
- `modules/stock/application/cerrar-relevamiento-inicial.ts`
- `modules/stock/ui/actions.ts`
- `shared/labels/enum-labels.ts`
- Kardex & reports: `modules/stock/application/kardex-movimientos.ts`, `reporte-kardex.ts`, `app/(app)/reportes/kardex/page.tsx`, `app/api/stock/kardex/export/xlsx/route.ts`, `modules/proveedores/domain/trayectoria.ts`

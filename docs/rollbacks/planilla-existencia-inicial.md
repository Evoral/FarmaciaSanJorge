# Rollback: Planilla de existencia inicial

Spec: `openspec/changes/planilla-existencia-inicial/specs/existencia-inicial/spec.md`.
The change introduces schema migrations:
- `prisma/migrations/20261110120000_0124_planilla_existencia_inicial` (delivery 2)
- `prisma/migrations/20261111090000_0127_corregir_datos_existencia_inicial` (delivery 3)

They are reverted as code + a new forward migration built from the corresponding down SQL file:
- For rolling back delivery 3 only (0127): `prisma/rollbacks/0127_corregir_datos_existencia_inicial.down.sql`
- For rolling back the entire feature (0127 + 0124): apply `0127.down.sql` first, then `0124.down.sql`.

## When it can be rolled back

### Delivery 3 (Migration 0127)
Can be rolled back at any time. The down migration drops `fsj.partida_corregir_datos_inicial` and restores `fsj.partida_validar_update` to its 0124 version verbatim. Any corrected data remains valid in the database.

### Delivery 2 (Migration 0124)
Only while **no corrección inicial movements exist** (`CORRECCION_INICIAL_SUMA` or `CORRECCION_INICIAL_RESTA`). Those movements adjust physical stock, and `movimiento_stock` is append-only: the down script aborts if it finds one. If corrections were already recorded, fix forward instead.

Rows in `fsj.relevamiento_fila` (the draft planilla) will be dropped by the rollback.

## What the down migrations lose

- 0127: The database function `fsj.partida_corregir_datos_inicial` and the relaxation of INV-S23 for initial corrections.
- 0124: The planilla draft table `fsj.relevamiento_fila` and its unpassed rows; permission `stock.relevamiento.editar`; `CORRECCION_INICIAL_SUMA` and `CORRECCION_INICIAL_RESTA` stay in `fsj.tipo_movimiento` (Postgres cannot drop enum values; with no rows using them, they are inert).

## Order

1. Deploy the reverted code **first**: it never calls the corrected endpoints or writes `relevamiento_fila` / new movement types.
2. Copy `prisma/rollbacks/0127_corregir_datos_existencia_inicial.down.sql` (and `0124_planilla_existencia_inicial.down.sql` if rolling back both) into a NEW migration folder (next free number, a timestamp later than every existing one) and apply it. Never edit or delete applied migrations.
3. Revert the code, `npm run db:generate`, then `npm run typecheck`, `npm run lint`, `npm test`.

## Files affected (delivery 3)

- `prisma/migrations/20261111090000_0127_corregir_datos_existencia_inicial/`
- `prisma/rollbacks/0127_corregir_datos_existencia_inicial.down.sql`
- `modules/stock/application/corregir-cantidad-inicial.ts`
- `modules/stock/application/corregir-datos-partida-inicial.ts`
- `modules/stock/application/get-correcciones-relevamiento.ts`
- `modules/stock/domain/existencia-inicial.ts`
- `modules/stock/ui/actions.ts`
- `modules/stock/ui/planilla-existencia-inicial.tsx`
- `modules/stock/ui/relevamiento-inicial-panel.tsx`
- `app/(app)/partidas/existencia-inicial/page.tsx`

## Files affected (delivery 2)

Reverting the code of delivery 2 restores `modules/stock/application/ingresar-existencia-inicial.ts`, `modules/stock/ui/existencia-inicial-form.tsx`, and `ingresarExistenciaInicialAction` in `modules/stock/ui/actions.ts` (which were retired by this delivery).

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

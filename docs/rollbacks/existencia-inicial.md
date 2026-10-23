# Rollback: Existencia inicial

Spec: `docs/specs/existencia-inicial.md`. The feature has a **schema change** (migration
`prisma/migrations/20261023120000_0100_existencia_inicial`), so it is reverted as code + a new forward migration
built from `prisma/rollbacks/0100_existencia_inicial.down.sql`.

## When it can be rolled back

Only while **no partida de existencia inicial exists**. Those partidas are real stock (append-only partidas and
movements, maybe already consumed by preparaciones and printed in the libro): the down script aborts if it finds
one. With existencia inicial loaded, fix forward instead.

The APERTURA asientos written by a droga alta (R12) are ordinary contralor rows: they stay after a rollback and
remain valid (INV-L15 is unchanged).

## What the down migration loses

- The DT's close of the relevamiento (`tenant.relevamiento_inicial_cerrado_*`). Its audit row stays.
- `INGRESO_INICIAL` stays in `fsj.tipo_movimiento` (Postgres cannot drop an enum value); unused, it is inert.
- The `dias_relevamiento_inicial` parametro rows stay; nothing reads them.

## Order

1. Deploy the reverted code **first**: it never writes `origen` (default COMPRA) nor `INGRESO_INICIAL`, and always
   sends a proveedor, so it runs fine against the 0100 schema.
2. Copy `prisma/rollbacks/0100_existencia_inicial.down.sql` into a NEW migration folder (next free number, a
   timestamp later than every existing one) and apply it. Never edit or delete the applied 0100 migration.
3. Revert the code (below), `npm run db:generate`, then `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `modules/stock/domain/existencia-inicial.ts`
- `modules/stock/infrastructure/existencia-inicial-repository.ts`
- `modules/stock/application/ingresar-existencia-inicial.ts`, `cerrar-relevamiento-inicial.ts`
- `modules/stock/ui/existencia-inicial-form.tsx`, `relevamiento-inicial-panel.tsx`
- `modules/libro/application/registrar-apertura-contralor.ts`
- `modules/drogas/application/contralor-activo.ts`
- `docs/specs/existencia-inicial.md`, `prisma/rollbacks/0100_existencia_inicial.down.sql` and this file (optional)
- `prisma/migrations/20261023120000_0100_existencia_inicial/` (keep it once applied)

## Edited files (revert the existencia inicial hunks)

- `prisma/schema.prisma`: `INGRESO_INICIAL`, `enum OrigenPartida`, `Partida.origen`, optional `Partida.proveedorId` /
  `proveedor`, `Tenant.relevamientoInicialCerrado*`.
- `modules/stock/application/ingresar-partida.ts`: `origen`, optional proveedor, no vale for existencia inicial.
- `modules/stock/infrastructure/partida-repository.ts`: `NuevaPartidaInput.origen`, `existePartidaLote` with a null
  proveedor, nullable `proveedorId` in the read models, `ETIQUETA_SIN_PROVEEDOR` fallbacks and LEFT JOINs,
  `PartidaParaAccion.origen`.
- LEFT JOIN + `ETIQUETA_SIN_PROVEEDOR`: `modules/preparaciones/infrastructure/preparacion-repository.ts`
  (partidas elegibles), `modules/drogas/infrastructure/historial-repository.ts`.
- `shared/labels/enum-labels.ts`: `INGRESO_INICIAL`, `ORIGEN_PARTIDA_LABELS`, `ETIQUETA_SIN_PROVEEDOR`.
- Kardex: `modules/stock/application/kardex-movimientos.ts`, `reporte-kardex.ts`, `app/(app)/reportes/kardex/page.tsx`,
  `app/api/stock/kardex/export/xlsx/route.ts`; `modules/proveedores/domain/trayectoria.ts` (`TipoMovimientoValor`).
- `modules/stock/ui/actions.ts`: `ingresarExistenciaInicialAction`, `cerrarRelevamientoInicialAction`,
  `costoSugeridoExistenciaInicialAction`.
- `app/(app)/partidas/ingresar/page.tsx`: the relevamiento panel; `app/(app)/partidas/[id]/page.tsx`: the origin.
- `modules/parametros/domain/parametros-registry.ts` and `scripts/create-tenant.ts`: `dias_relevamiento_inicial`.
- R12: `modules/drogas/application/crear-droga.ts`, `editar-droga.ts`, `modules/drogas/ui/droga-form.tsx`,
  `actions.ts`, `nueva-droga-dialog.tsx`, `modules/costos-proveedor/ui/importar-lista.tsx`,
  `importar-lista-form.tsx`, `app/(app)/costos-proveedor/importar/page.tsx`, `app/(app)/catalogos/drogas/page.tsx`,
  `app/(app)/catalogos/drogas/[id]/page.tsx`, `modules/libro/infrastructure/contralor-repository.ts`
  (`insertAperturaContralor`, `tieneAperturaContralor`).
- `docs/specs/libro-recetario-y-contralor.md`: the RESUELTO note back to PENDIENTE.
- `tests/db/prisma-relation-loading-concurrency.test.ts`: the optional `proveedor` access.

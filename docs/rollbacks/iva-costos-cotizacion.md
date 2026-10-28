# Rollback: IVA en costos de proveedor y cotizaciones

Spec: `openspec/specs/costos-proveedor/spec.md` (R7a, R10, R25, R27, R31, R32) and
`openspec/specs/reglas-precio/spec.md` ("Costo de una preparación"). The feature has a **schema change** (migration
`prisma/migrations/20261026130000_0107_iva_costos_cotizacion`), so it is reverted as code + a new forward migration
built from `prisma/rollbacks/0107_iva_costos_cotizacion.down.sql`.

## What the down migration loses

- The alícuota and the prices with IVA of every costo de proveedor (the net `precio_informado` / `costo_unitario` are
  untouched, so the costos keep working net).
- `cotizacion.costo_insumos_con_iva`. Cotizaciones calculated after 0107 keep their `precio_final`, which already
  included IVA; their `detalle` JSON keeps `alicuotaIva` / `subtotalConIva`, harmless to the reverted readers.
- The `alicuota_iva_porcentaje` parametro rows.

## Order

The two sides are NOT compatible with each other: the reverted code inserts costos without the new `NOT NULL`
columns, and the current code reads them. Do it in one maintenance window, with no one saving costos or cotizaciones:

1. Copy `prisma/rollbacks/0107_iva_costos_cotizacion.down.sql` into a NEW migration folder (next free number, a
   timestamp later than every existing one) and apply it. Never edit or delete the applied 0107 migration.
2. Deploy the reverted code right after.
3. `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `prisma/rollbacks/0107_iva_costos_cotizacion.down.sql` and this file (optional)
- `prisma/migrations/20261026130000_0107_iva_costos_cotizacion/` (keep it once applied)

## Edited files (revert the IVA hunks)

- `prisma/schema.prisma`: `CostoProveedor.alicuotaIva` / `precioInformadoConIva` / `costoUnitarioConIva`,
  `Cotizacion.costoInsumosConIva`.
- `modules/costos-proveedor/domain/costo-proveedor.ts`: `ALICUOTA_IVA_POR_DEFECTO`, `alicuotaIvaSchema`,
  `parsearAlicuotaIva`, `aplicarIva`, `calcularConIva`, `alicuotaIva` in `filaCostoSchema` and `planVersionar`.
- `modules/costos-proveedor/domain/presentacion.ts`: `etiquetaPrecio` doc comment.
- `modules/costos-proveedor/infrastructure/costo-proveedor-repository.ts`: `getAlicuotaIvaPorDefecto` and the IVA
  fields of every read and of the insert.
- `modules/costos-proveedor/application/registrar-costos-proveedor.ts`: the alícuota resolution, insert and audit.
- `modules/costos-proveedor/application/costos-proveedor-para-cotizar.ts`: `alicuotaIvaParaCotizar`, IVA fields.
- `modules/costos-proveedor/application/listar-costos-vigentes.ts`: `alicuotaIvaPorDefecto`.
- `modules/costos-proveedor/ui/costo-form.tsx`, `ui/action-state.ts`, `ui/actions.ts`: the alícuota field and preview.
- `app/(app)/costos-proveedor/page.tsx`, `historial/page.tsx`, `nuevo/page.tsx`: the prices with IVA.
- `modules/precios/domain/calcular-cotizacion.ts`: `alicuotaIvaPartidas`, `subtotalConIva`, `costoInsumosConIva`
  and pricing on it.
- `modules/precios/application/cotizar-lineas.ts`, `calcular-cotizacion.ts`, `get-cotizacion-item.ts`,
  `modules/precios/infrastructure/cotizacion-repository.ts`: `costoInsumosConIva`.
- `modules/precios/ui/cotizacion-detalle.tsx`, `app/(app)/recetas/[id]/items/[itemId]/cotizacion/page.tsx`: the
  IVA figures.
- `modules/parametros/domain/parametros-registry.ts`, `scripts/create-tenant.ts`: `alicuota_iva_porcentaje`.
- `shared/labels/field-labels.ts`: `precioInformadoConIva`, `alicuotaIva`, `costoUnitarioConIva`.
- Tests: the `getAlicuotaIvaPorDefecto` mocks and IVA fixture fields in `tests/unit/costos-proveedor-*.test.ts`,
  `tests/unit/precios-cotizar-lineas-costo-proveedor.test.ts`, `tests/unit/recetas-presupuesto.test.ts`.

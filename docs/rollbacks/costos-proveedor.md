# Rollback: Costos de proveedores

Spec: `docs/specs/costos-proveedor.md`. The feature has a **schema change**
(migration `0077_costos_proveedor`, planned), so it is reverted as code + a new
forward migration built from `prisma/rollbacks/0077_costos_proveedor.down.sql`.

Written before implementation (stage E1); update the file lists below as each
stage lands.

## Soft rollback (no schema change)

Cotizaciones fall back to partida costing for every droga without a usable
costo de proveedor (R27). Dando de baja every vigente costo de proveedor (or
reverting only the `modules/precios` hunks) restores today's cotización
behaviour while keeping the data. Use this first if the problem is the prices
quoted, not the data.

## What the down migration loses

- Every costo de proveedor version (`fsj.costo_proveedor`) and every imported
  list header (`fsj.lista_precio_proveedor`), with their history.
- The permiso `costos.proveedor.gestionar` and its `rol_permiso` rows.
- Not lost:
  - `partida.costo_unitario` and every stock table: the feature never writes
    them (R34).
  - Calculated cotizaciones: `cotizacion.detalle` keeps `fuente` and
    `costoProveedor` as plain JSON. After the rollback the reverted UI reads a
    `PROVEEDOR` línea as a línea with no partidas (subtotal still shown).
  - Synonyms created with "recordar equivalencia" are ordinary `droga_alias`
    rows and stay.
  - Audit records stay.

Export the data first if it must be kept:

```sql
SELECT c.*, d.nombre AS droga, p.razon_social AS proveedor
FROM fsj.costo_proveedor c
JOIN fsj.droga d ON d.tenant_id = c.tenant_id AND d.id = c.droga_id
JOIN fsj.proveedor p ON p.tenant_id = c.tenant_id AND p.id = c.proveedor_id
ORDER BY c.tenant_id, d.nombre, p.razon_social, c.vigente_desde;
SELECT * FROM fsj.lista_precio_proveedor ORDER BY registrado_en;
```

## Order

1. Deploy the reverted code **first**: it does not read the new tables.
   Dropping them while the current code is live makes every cotización and
   presupuesto fail.
2. Copy `prisma/rollbacks/0077_costos_proveedor.down.sql` into a NEW migration
   folder (next free number, a timestamp later than every existing one) and
   apply it with `npm run db:migrate`. Never edit or delete the applied 0077
   migration.
3. `npm run db:generate`, `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `modules/costos-proveedor/**`
- `app/(app)/costos-proveedor/**`
- `docs/specs/costos-proveedor.md` and this file (optional)
- `prisma/migrations/<timestamp>_0077_costos_proveedor/` (keep it once applied; the down migration undoes it)
- New tests under `tests/unit/` and `tests/db/` for the module

## Edited files (revert the costos-proveedor hunks)

- `prisma/schema.prisma`: `model CostoProveedor`, `model ListaPrecioProveedor` and their back-relations.
- `modules/auth/domain/permisos.ts`: `costos.proveedor.gestionar`; `tests/db/auth-permisos.test.ts`.
- `modules/auditoria/domain/presentacion.ts`, `shared/labels/field-labels.ts`: new entities and labels.
- `modules/precios/domain/calcular-cotizacion.ts`, `modules/precios/application/cotizar-lineas.ts`, `calcular-cotizacion.ts`, `get-cotizacion-item.ts`, `modules/precios/ui/cotizacion-detalle.tsx`, `modules/recetas/ui/presupuesto-panel.tsx`.
- `app/(app)/layout.tsx`, `app/(app)/sidebar-nav.tsx`: the sidebar entry.
- `modules/README.md`, `docs/specs/presupuesto-receta.md`, `docs/specs/reglas-precio.md`.

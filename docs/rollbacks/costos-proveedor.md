# Rollback: Costos de proveedores

Spec: `docs/specs/costos-proveedor.md`. The feature has **two schema changes**
(migrations `0079_costos_proveedor` and `0080_lista_precio_formato_xls`), so it
is reverted as code + new forward migrations built from
`prisma/rollbacks/0080_lista_precio_formato_xls.down.sql` and then
`prisma/rollbacks/0079_costos_proveedor.down.sql`.

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

## Reverting only the .xls support (migration 0080)

Code: remove `leer-xls.server.ts` and `tests/unit/helpers/xls-builder.ts`, and
restore `XLSX`-only detection in `archivo-lista.ts` / `leer-lista-precios.ts` /
`importar-lista-precios.ts` (and the 1 MiB limit + 1_081_344 `bodySizeLimit`).
Data: the 0080 CHECK is wider than 0079's and harmless to older code, so the
recommended rollback is to **leave 0080 applied**. The down script
(`prisma/rollbacks/0080_lista_precio_formato_xls.down.sql`) restores
`CHECK (formato IN ('XLSX','PDF'))` and FAILS if any list was imported from a
.xls (`SELECT count(*) FROM fsj.lista_precio_proveedor WHERE formato = 'XLS'`):
the table is append-only, so those rows can not be relabelled by the app; the
script's header documents the owner-only workaround and why it is discouraged.

## Order

1. Deploy the reverted code **first**: it does not read the new tables.
   Dropping them while the current code is live makes every cotización and
   presupuesto fail.
2. If 0080 was applied, apply its down migration first (or skip it, see above),
   then copy `prisma/rollbacks/0079_costos_proveedor.down.sql` into a NEW migration
   folder (next free number, a timestamp later than every existing one) and
   apply it with `npm run db:migrate`. Never edit or delete the applied 0079 or
   0080 migrations. Forward order for the feature itself: **apply 0080 before
   deploying the .xls code** (an insert with formato `'XLS'` fails the 0079 CHECK).
3. `npm run db:generate`, `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `modules/costos-proveedor/**`
- `app/(app)/costos-proveedor/**`
- `docs/specs/costos-proveedor.md` and this file (optional)
- `prisma/migrations/<timestamp>_0079_costos_proveedor/` (keep it once applied; the down migration undoes it)
- `prisma/migrations/20261015180000_0080_lista_precio_formato_xls/` (same: keep it once applied) and `prisma/rollbacks/0080_lista_precio_formato_xls.down.sql`
- `.xls` support: `modules/costos-proveedor/infrastructure/leer-xls.server.ts`, `libro-hojas.ts` (shared reader shape, also used by `leer-xlsx.server.ts`), `tests/unit/helpers/xls-builder.ts`, `tests/unit/costos-proveedor-leer-xls.test.ts`
- New tests under `tests/unit/` and `tests/db/` for the module

## Edited files (revert the costos-proveedor hunks)

- `prisma/schema.prisma`: `model CostoProveedor`, `model ListaPrecioProveedor` and their back-relations.
- `modules/auth/domain/permisos.ts`: `costos.proveedor.gestionar` (no change to `tests/db/auth-permisos.test.ts`: a `gestion` permiso reaches ADMINISTRADOR by category and no predefined role holds it); `modules/usuarios/domain/roles.ts` (`costos` group label); `shared/errors/mensajes-invariantes.ts` (`INV-CP-001/002`); `tests/db/grants-finales.test.ts` (the two new tables).
- `shared/db/ahora-servidor.ts` is the former `ahoraServidor` of `modules/precios/infrastructure/regla-precio-repository.ts`, which now re-exports it; keep it on rollback (precios uses it).
- `modules/auditoria/domain/presentacion.ts`, `shared/labels/field-labels.ts`: new entities and labels.
- Stage E5 (cost source of cotizaciones/presupuestos; reverting only these restores today's quoting, the soft rollback): `modules/precios/domain/calcular-cotizacion.ts` (`costoProveedor`, `fuente`, `leerDetalleCotizacion`, `costearItem`), `modules/precios/application/cotizar-lineas.ts` (lookup + `costoProveedor` per línea), `modules/precios/application/get-cotizacion-item.ts` (reads the detalle through `leerDetalleCotizacion`), `modules/precios/ui/cotizacion-detalle.tsx`, `modules/precios/ui/actions.ts` (INCOMPLETA aviso wording), `modules/recetas/domain/presupuesto.ts` (`fuentes`), `modules/recetas/ui/presupuesto-panel.tsx`; plus `tests/unit/recetas-presupuesto.test.ts` (one mock: no costos) and `tests/db/regla-precio-cotizacion.test.ts` (R34 test).
- .xls support (0080): `modules/costos-proveedor/domain/archivo-lista.ts` (format detection, 4 MiB `MAX_LISTA_BYTES`, `LISTA_BODY_SIZE_LIMIT_BYTES`), `modules/costos-proveedor/application/leer-lista-precios.ts` and `importar-lista-precios.ts` (`formato` `XLS`), `modules/costos-proveedor/domain/importacion-lista.ts`, `modules/costos-proveedor/infrastructure/leer-xlsx.server.ts` (now returns `LibroHojas`), `costo-proveedor-repository.ts` (formato type), `modules/costos-proveedor/ui/importar-lista.tsx`, `app/(app)/costos-proveedor/importar/page.tsx` (copy), `next.config.ts` (`bodySizeLimit` 4_227_072), the comments in `modules/recetas/domain/archivo-receta-pdf.ts`, `prisma/schema.prisma` (doc comment), and the tests `archivo-receta-pdf`, `costos-proveedor-archivo`, `-leer-lista`, `-importar-lista` and `tests/db/costos-proveedor.test.ts` (the formato CHECK case). Rolling back the limit also means restoring the PDF-only `bodySizeLimit` assertion.
- `app/(app)/layout.tsx`, `app/(app)/sidebar-nav.tsx`: the sidebar entry.
- `modules/README.md`, `docs/specs/presupuesto-receta.md`, `docs/specs/reglas-precio.md`.

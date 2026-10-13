# Historial de partidas

Status: implemented 2026-10-13.

## Goal

A general, read-only list of **every partida of the tenant**, across all
drogas, regardless of saldo, so the user can find a lote, see which proveedor
it came from and its estado, and open its detail (`/stock/partidas/[id]`).
It is a history: agotadas are included by default.

Insumos (excipientes, materiales) are drogas with another `clase`
(migration 0063), so their partidas are listed too; there is no separate
insumo partida model.

The per-droga list (`/stock/partidas?drogaId=...`) is unchanged: it still
requires a droga and shows only partidas con saldo by default.

## Route, navigation, permission

- Route: `/stock/historial`. Breadcrumbs `Inicio › Stock › Partidas`, title
  "Partidas".
- Sidebar (`app/(app)/sidebar-nav.tsx`): "Partidas" entry between "Stock" and
  "Ajuste de Stock", under the same `stock.ver` condition. "Stock" is no longer
  highlighted on `/stock/historial` nor on `/stock/ingresar`.
- Partida management starts here: the header's "Nuevo ingreso" button
  (`stock.partida.ingresar`) opens `/stock/ingresar` (breadcrumbs
  `Inicio › Partidas › Nuevo ingreso`). `/stock` no longer offers the ingreso;
  its header only links to "Ajuste de Stock" (`/stock/ajustes`).
- Permission: `stock.ver`, enforced twice — the section guard
  `app/(app)/stock/layout.tsx` and the use case (`defineQuery`, `permiso:
  "stock.ver"`). The list exposes nothing the per-droga list and the kardex
  do not already show under the same permiso.

## Filters

All in the URL (GET `FilterForm`), combined with AND. The page drops any
invalid value (treated as "no filter"); the use case validates again with zod.

| Filter | Param | Rule |
|---|---|---|
| Droga | `drogaId` (uuid) | Autocomplete `KardexDrogaFiltro` (shared with `/reportes/kardex`). |
| Lote | `q` | Case-insensitive "contains" on `partida.lote`, max 100 chars. |
| Proveedor | `proveedorId` (uuid) | `<select>` of every proveedor that has at least one partida of the tenant (dados de baja included), by razón social. |
| Fecha de ingreso | `desde` / `hasta` (YYYY-MM-DD) | Inclusive jornadas in the tenant's `zona_horaria` (`fecha_ingreso` is a timestamptz), same rule as the kardex. An inverted range shows an alert and is ignored. |
| Solo con saldo | `saldo=1` | `cantidad_disponible > 0`. |
| Solo vencidas | `vencidas=1` | `fecha_vencimiento_vigente < fsj.jornada_actual(tenant)` (same predicate as the per-droga list). |
| Unificar unidades | `unidades=base` | Display only (`formatCantidadesFila`), kept on "Limpiar filtros". |

The proveedor list comes from the stock query itself (not from
`listProveedoresOpciones`, which requires `proveedores.gestionar`).

## Columns

Order: `fecha_ingreso DESC, id DESC`. Page size 20 (`?page=`, clamped to ≥ 1).

1. **Lote** — mono, link to `/stock/partidas/[id]`; proveedor under it on
   small screens.
2. **Droga** — link to `/stock/partidas?drogaId=...`.
3. **Proveedor** — hidden below `md`.
4. **Ingreso** — tenant calendar day of `fecha_ingreso`.
5. **Vencimiento** — the vencimiento VIGENTE, "No vence" when null, plus a
   "Reanalizada" note (original date in its title) when it differs from the
   original (docs/specs/reanalisis-partida.md).
6. **Saldo / Inicial** — in the droga's unidad base, auto-scaled unless
   "Unificar unidades".
7. **Estado** — "Vencida"/"Por vencer" badge only when the partida has saldo
   (`estadoVencimientoPartida`, same window as the stock alerts); "Agotada"
   when saldo is 0; "Abierta"/"Cerrada" always.
8. Chevron link to the detail.

The toolbar shows the total count. Empty states: "Todavía no hay partidas"
(no filters) vs "Sin resultados" with a "Limpiar filtros" link.

## Code

- Page: `app/(app)/stock/historial/page.tsx`
- Use case: `modules/stock/application/list-partidas.ts` (`listPartidas`,
  query name `stock.partidas.historial`)
- Repository: `modules/stock/infrastructure/partida-repository.ts`
  (`listPartidasHistorial`)
- Droga autocomplete: `modules/stock/ui/kardex-droga-filtro.tsx`
- Sidebar: `app/(app)/sidebar-nav.tsx`

No schema change, no migration. Rollback: delete the page, the use case and
the repository function, and revert the sidebar entry.

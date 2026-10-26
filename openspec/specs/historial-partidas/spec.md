# Historial de partidas

## Purpose

A general, read-only list of **every partida of the tenant**, across all drogas, regardless of saldo, so the user
can find a lote, see which proveedor it came from and its estado, and open its detail (`/partidas/[id]`).
Implemented 2026-10-13 (see Status).

## Requirements

### Requirement: Every partida of the tenant

The list SHALL be general and read-only and SHALL show **every partida of the tenant**, across all drogas,
regardless of saldo. It is a history: agotadas MUST be included by default.

#### Scenario: Agotada partida

- **GIVEN** a partida of the tenant with saldo 0
- **WHEN** the user opens `/partidas` with no filter
- **THEN** the partida is listed

### Requirement: Insumo partidas

Insumos (excipientes, materiales) are drogas with another `clase` (migration 0063), so their partidas SHALL be
listed too; there is no separate insumo partida model.

#### Scenario: Partida of an excipiente

- **GIVEN** a partida of a droga whose `clase` is an insumo
- **WHEN** the user opens `/partidas`
- **THEN** the partida is listed like any other

### Requirement: Per-droga list merged

The old per-droga list (`/stock/partidas`) was merged into this page: `/stock` SHALL link to
`/partidas?drogaId=...&saldo=1`, which is the same view (only partidas con saldo).

#### Scenario: Partidas of a droga from Stock

- **WHEN** the user follows a droga's partidas link from `/stock`
- **THEN** `/partidas?drogaId=...&saldo=1` opens, listing only that droga's partidas con saldo

### Requirement: Route

The list SHALL live at `/partidas`, with breadcrumbs `Inicio › Stock › Partidas` and title "Partidas".

#### Scenario: Opening the list

- **WHEN** the user opens `/partidas`
- **THEN** the page is titled "Partidas" with breadcrumbs `Inicio › Stock › Partidas`

### Requirement: Sidebar entry

The sidebar (`app/(app)/sidebar-nav.tsx`) SHALL have a "Partidas" entry between "Stock" and "Ajuste de Stock",
under the same `stock.ver` condition. "Stock" MUST no longer be highlighted on `/partidas` nor on
`/partidas/ingresar`.

#### Scenario: Sidebar on the partidas pages

- **GIVEN** a user with `stock.ver`
- **WHEN** the user is on `/partidas` or `/partidas/ingresar`
- **THEN** the sidebar shows "Partidas" between "Stock" and "Ajuste de Stock"
- **AND** "Stock" is not highlighted

### Requirement: Nuevo ingreso starts here

Partida management SHALL start here: the header's "Nuevo ingreso" button (`stock.partida.ingresar`) opens
`/partidas/ingresar` (breadcrumbs `Inicio › Partidas › Nuevo ingreso`). `/stock` MUST no longer offer the ingreso;
its header only links to "Ajuste de Stock" (`/stock/ajustes`).

#### Scenario: Starting an ingreso

- **GIVEN** a user with `stock.partida.ingresar`
- **WHEN** the user clicks "Nuevo ingreso" in the `/partidas` header
- **THEN** `/partidas/ingresar` opens with breadcrumbs `Inicio › Partidas › Nuevo ingreso`

#### Scenario: Stock header

- **WHEN** the user opens `/stock`
- **THEN** its header offers no ingreso and only links to "Ajuste de Stock" (`/stock/ajustes`)

### Requirement: Permission stock.ver

The permission SHALL be `stock.ver`, enforced twice — the section guard `app/(app)/stock/layout.tsx` and the use
case (`defineQuery`, `permiso: "stock.ver"`). The list exposes nothing the per-droga list and the kardex do not
already show under the same permiso.

#### Scenario: User without stock.ver

- **GIVEN** a user without `stock.ver`
- **WHEN** the user opens `/partidas` or calls the use case
- **THEN** access is refused

### Requirement: Filters in the URL

The filters listed under **Filters** SHALL all be in the URL (GET `FilterForm`), combined with AND, each with the
rule its row states. The page MUST drop any invalid value (treated as "no filter"); the use case validates again
with zod.

#### Scenario: Combined filters

- **WHEN** the user filters by a droga and "Solo con saldo"
- **THEN** only partidas of that droga with `cantidad_disponible > 0` are listed

#### Scenario: Invalid value

- **WHEN** the URL carries an invalid filter value (e.g. a `drogaId` that is not a uuid)
- **THEN** that filter is treated as "no filter"

#### Scenario: Inverted date range

- **WHEN** `desde` is later than `hasta`
- **THEN** an alert is shown and the range is ignored

### Requirement: Proveedor options

The proveedor list SHALL come from the stock query itself (not from `listProveedoresOpciones`, which requires
`proveedores.gestionar`).

#### Scenario: Proveedor filter without proveedores.gestionar

- **GIVEN** a user with `stock.ver` but without `proveedores.gestionar`
- **WHEN** the user opens the Proveedor filter
- **THEN** it lists every proveedor that has at least one partida of the tenant, dados de baja included

### Requirement: Order and page size

The list SHALL be ordered `fecha_ingreso DESC, id DESC`. Page size MUST be 20 (`?page=`, clamped to ≥ 1).

#### Scenario: Page below 1

- **WHEN** the URL carries `?page=0`
- **THEN** the first page of 20 partidas is shown, newest ingreso first

### Requirement: Columns

The list SHALL show the columns listed under **Columns**, in that order, each with the content its item states.

#### Scenario: Agotada partida

- **GIVEN** a partida with saldo 0
- **WHEN** it is listed
- **THEN** its Estado shows "Agotada" and "Abierta" or "Cerrada", and no "Vencida"/"Por vencer" badge

#### Scenario: Partida that does not expire

- **GIVEN** a partida whose vencimiento vigente is null
- **WHEN** it is listed
- **THEN** its Vencimiento reads "No vence"

#### Scenario: Reanalizada partida

- **GIVEN** a partida whose vencimiento vigente differs from the original
- **WHEN** it is listed
- **THEN** its Vencimiento shows the vigente date with a "Reanalizada" note carrying the original date in its title

### Requirement: Count and empty states

The toolbar SHALL show the total count. Empty states MUST be "Todavía no hay partidas" (no filters) vs "Sin
resultados" with a "Limpiar filtros" link.

#### Scenario: No partidas at all

- **GIVEN** a tenant with no partida
- **WHEN** the user opens `/partidas` with no filter
- **THEN** the page shows "Todavía no hay partidas"

#### Scenario: Filter with no match

- **WHEN** the filters match no partida
- **THEN** the page shows "Sin resultados" with a "Limpiar filtros" link

## Status

Status: implemented 2026-10-13.

## Filters

| Filter | Param | Rule |
|---|---|---|
| Droga | `drogaId` (uuid) | Autocomplete `KardexDrogaFiltro` (shared with `/reportes/kardex`). |
| Lote | `q` | Case-insensitive "contains" on `partida.lote`, max 100 chars. |
| Proveedor | `proveedorId` (uuid) | `<select>` of every proveedor that has at least one partida of the tenant (dados de baja included), by razón social. |
| Fecha de ingreso | `desde` / `hasta` (YYYY-MM-DD) | Inclusive jornadas in the tenant's `zona_horaria` (`fecha_ingreso` is a timestamptz), same rule as the kardex. An inverted range shows an alert and is ignored. |
| Solo con saldo | `saldo=1` | `cantidad_disponible > 0`. |
| Solo vencidas | `vencidas=1` | `fecha_vencimiento_vigente < fsj.jornada_actual(tenant)` (same predicate as the per-droga list). |
| Unificar unidades | `unidades=base` | Display only (`formatCantidadesFila`), kept on "Limpiar filtros". |

## Columns

1. **Lote** — mono, link to `/partidas/[id]`; proveedor under it on
   small screens.
2. **Droga** — link to `/partidas?drogaId=...`.
3. **Proveedor** — hidden below `md`.
4. **Ingreso** — tenant calendar day of `fecha_ingreso`.
5. **Vencimiento** — the vencimiento VIGENTE, "No vence" when null, plus a
   "Reanalizada" note (original date in its title) when it differs from the
   original (openspec/specs/reanalisis-partida/spec.md).
6. **Saldo / Inicial** — in the droga's unidad base, auto-scaled unless
   "Unificar unidades".
7. **Estado** — "Vencida"/"Por vencer" badge only when the partida has saldo
   (`estadoVencimientoPartida`, same window as the stock alerts); "Agotada"
   when saldo is 0; "Abierta"/"Cerrada" always.
8. Chevron link to the detail.

## Code

- Page: `app/(app)/partidas/page.tsx`
- Use case: `modules/stock/application/list-partidas.ts` (`listPartidas`,
  query name `stock.partidas.historial`)
- Repository: `modules/stock/infrastructure/partida-repository.ts`
  (`listPartidasHistorial`)
- Droga autocomplete: `modules/stock/ui/kardex-droga-filtro.tsx`
- Sidebar: `app/(app)/sidebar-nav.tsx`

No schema change, no migration. Rollback: delete the page, the use case and
the repository function, and revert the sidebar entry.

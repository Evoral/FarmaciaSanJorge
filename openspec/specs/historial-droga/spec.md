# Historial de la droga

## Purpose

From the droga catalog, a per-droga, read-only view of every receta that actually CONSUMED that droga, and from
which partida(s) it came. Sibling of `openspec/specs/trayectoria-proveedor/spec.md` (same patterns, same look).
Typical use: a lot recall — "lote X was bad, which recetas (and pacientes) got it?". Approved by user 2026-10-07
(see Status).

## Requirements

### Requirement: Consumed path only

The view SHALL show ONLY the consumed path (`Partida → MovimientoStock EGRESO_PREPARACION → Preparacion →
ItemReceta → Receta`, see **Key facts**), never the prescribed one (user decision): recetas still pending
preparation MUST be out.

#### Scenario: Receta prescribed but not prepared

- **GIVEN** a receta whose item prescribes the droga and has no confirmed preparación
- **WHEN** the user opens the droga's Historial
- **THEN** the receta is not listed

#### Scenario: Receta prepared from a partida

- **GIVEN** a confirmed preparación that wrote an EGRESO_PREPARACION from a partida of the droga
- **WHEN** the user opens the droga's Historial
- **THEN** the receta is listed with that partida

### Requirement: Datos and Historial tabs

`/catalogos/drogas/[id]` SHALL get two tabs, **Datos** (`/catalogos/drogas/[id]`, exact, the current
edit/baja/reactivar page) | **Historial** (`/catalogos/drogas/[id]/historial`), via a `DrogaTabs` component built
on `SectionTabs` (same as `app/(app)/proveedores/proveedor-tabs.tsx`), rendered by each page right under its
header.

#### Scenario: Datos is an exact match

- **WHEN** the user is on `/catalogos/drogas/[id]/historial`
- **THEN** the Historial tab is active and the Datos tab is not

### Requirement: Uuid guard

A new `app/(app)/catalogos/drogas/[id]/layout.tsx` SHALL be a uuid guard only (malformed id → 404), same as
`app/(app)/proveedores/[id]/layout.tsx`.

#### Scenario: Malformed id

- **WHEN** the user opens `/catalogos/drogas/not-a-uuid/historial`
- **THEN** the response is a 404

### Requirement: Historial only with recetas.crear

The Historial tab SHALL be rendered only when the session holds `recetas.crear`. Opening the historial URL without
it MUST redirect to the Datos tab (the page checks `can()` before calling the use case, so no ACCESO_DENEGADO row
is written for a link the UI never showed).

#### Scenario: Session without recetas.crear

- **GIVEN** a session with `drogas.editar` but without `recetas.crear`
- **WHEN** it opens the droga page
- **THEN** no Historial tab is shown

#### Scenario: Historial URL without recetas.crear

- **GIVEN** a session without `recetas.crear`
- **WHEN** it opens `/catalogos/drogas/[id]/historial`
- **THEN** it is redirected to the Datos tab
- **AND** no ACCESO_DENEGADO row is written

### Requirement: URL contents

The URL SHALL carry only the opaque droga UUID, `?page=` and the optional repeatable `?partida=<uuid>` filter.
Partida ids are not sensitive.

#### Scenario: Filtered page

- **WHEN** the user filters by two partidas and moves to page 2
- **THEN** the URL carries only the droga UUID, `page` and two `partida` params

### Requirement: Breadcrumbs

The breadcrumbs SHALL read `Inicio › Catálogos › Drogas › <droga> › Historial`.

#### Scenario: Opening the historial

- **WHEN** the user opens a droga's Historial
- **THEN** the breadcrumbs read `Inicio › Catálogos › Drogas › <droga> › Historial`

### Requirement: Lot tracing from the partida

The partida detail (`/partidas/[id]`) SHALL have a "Historial" header button that opens this page already filtered
by that partida (`?partida=<id>`). It MUST be shown only with `drogas.editar` + `recetas.crear` (the gates of this
page), so it never leads to a redirect (2026-10-19).

#### Scenario: Tracing a lote

- **GIVEN** a session with `drogas.editar` and `recetas.crear`
- **WHEN** the user clicks "Historial" on a partida's detail
- **THEN** the droga's Historial opens filtered by `?partida=<id>`

#### Scenario: Missing one of the gates

- **GIVEN** a session without `drogas.editar` or without `recetas.crear`
- **WHEN** it opens a partida's detail
- **THEN** the "Historial" button is not shown

### Requirement: Base access and use case permiso

Base access SHALL be the existing `catalogos/drogas/layout.tsx` guard (`drogas.editar`). The view exposes receta
data, so the use case MUST be a `defineQuery` on **`recetas.crear`**.

#### Scenario: Session without drogas.editar

- **GIVEN** a session without `drogas.editar`
- **WHEN** it opens `/catalogos/drogas/[id]/historial`
- **THEN** the `catalogos/drogas/layout.tsx` guard refuses it

### Requirement: Optional pieces gated with can()

Optional pieces SHALL be decided with `can()` inside the use case (never by calling other defineQuerys: a denial
writes ACCESO_DENEGADO), with the gates listed under **Permissions**. A piece the session cannot see MUST be
neither fetched nor rendered.

#### Scenario: Without pacientes.gestionar

- **GIVEN** a session with `recetas.crear` but without `pacientes.gestionar`
- **WHEN** it opens the Historial
- **THEN** the paciente name is not fetched and shows "—"

#### Scenario: Without stock.ver

- **GIVEN** a session without `stock.ver`
- **WHEN** it opens the Historial
- **THEN** no link to a partida in stock is rendered

### Requirement: Quantities without stock.ver

Without `stock.ver`, quantities SHALL show in the droga's unidad base, unconverted (same rule as the proveedor
historial: `getCatalogoUnidades` MUST be called only when the session holds it).

#### Scenario: Unconverted quantity

- **GIVEN** a session without `stock.ver`
- **WHEN** it opens the Historial
- **THEN** quantities show in the droga's unidad base
- **AND** `getCatalogoUnidades` is not called

### Requirement: Recetas table

The recetas SHALL be a `table.data-table` inside a `list-panel`, with a count line, an empty state and the standard
pagination bar. Each row MUST expand (`FilaDesplegable`, closed by default).

#### Scenario: Expanding a row

- **WHEN** the user opens the Historial
- **THEN** every row is closed
- **AND** clicking a row's toggle shows its expanded detail

### Requirement: One row per receta

There SHALL be **one row per receta** that has at least one EGRESO_PREPARACION of this droga, newest first by the
latest `preparacion.confirmada_en` among those movements (tie-break `receta.numero_interno DESC`).

#### Scenario: Receta prepared from two partidas

- **GIVEN** a receta that consumed the droga from two partidas
- **WHEN** the user opens the Historial
- **THEN** the receta appears in one row

#### Scenario: Same preparation time

- **GIVEN** two recetas whose latest `confirmada_en` is the same
- **WHEN** they are listed
- **THEN** the one with the higher `numero_interno` comes first

### Requirement: Columns

The row SHALL show the columns listed under **Columns**, with their source and notes. An ANULADA receta MUST still
show (the stock was consumed).

#### Scenario: Anulada receta

- **GIVEN** an ANULADA receta that consumed the droga
- **WHEN** the user opens the Historial
- **THEN** it is listed with its ANULADA status badge

### Requirement: Expanded detail

The expanded detail SHALL show one line per partida consumed by that receta — lote, proveedor (razón social),
vencimiento, and the quantity consumed from it (`SUM(cantidad)` grouped by partida). The detail also MUST have a
link to the receta (`/recetas/[id]`) and, with `stock.ver`, a link to each partida.

#### Scenario: Detail of a receta

- **GIVEN** a session with `stock.ver`
- **WHEN** the user expands a receta that consumed from two partidas
- **THEN** two lines show lote, proveedor, vencimiento and the quantity consumed from each
- **AND** the detail links to `/recetas/[id]` and to each partida

### Requirement: Quantities

Quantities SHALL never be summed across drogas. Here everything is one droga, so one unidad base. `cantidad` MUST
be the physical quantity already written by the confirmation (it includes the potencia correction).

#### Scenario: Potencia-corrected quantity

- **GIVEN** a confirmation that wrote a potencia-corrected `cantidad`
- **WHEN** the receta is listed
- **THEN** Consumido shows that written `cantidad`

### Requirement: Count line and empty states

The count line SHALL read "N receta(s)"; with a filter, "{filtradas} de {total} recetas". Empty states MUST be
"Esta droga todavía no se usó en ninguna preparación." / with a filter: "No hay recetas que hayan usado las
partidas seleccionadas."

#### Scenario: Droga never used

- **GIVEN** a droga with no EGRESO_PREPARACION
- **WHEN** the user opens its Historial
- **THEN** it shows "Esta droga todavía no se usó en ninguna preparación."

#### Scenario: Filter with no recetas

- **WHEN** an active filter matches no receta
- **THEN** it shows "No hay recetas que hayan usado las partidas seleccionadas."

### Requirement: No resumen block

There SHALL be no resumen block in v1.

#### Scenario: Opening the historial

- **WHEN** the user opens a droga's Historial
- **THEN** no resumen block is shown

### Requirement: Filtro por partida controls

The filter SHALL have the same UX and URL contract as the proveedor's "Filtrar por droga"
(`modules/proveedores/ui/trayectoria-filtro-drogas.tsx`): an autocomplete (`shared/ui/combobox`) over the partidas
NOT selected yet, plus one chip per selected partida (✕ removes it, accessible name "Quitar filtro <etiqueta>").
`page` MUST be dropped on every change.

#### Scenario: Removing a chip

- **GIVEN** two selected partidas on page 3
- **WHEN** the user clicks ✕ on one chip
- **THEN** only the other partida stays selected and `page` is dropped

### Requirement: Filter component of its own

The filter SHALL be a NEW component in `modules/drogas/ui/` (modules do not import each other's UI); only shared
pieces are reused.

#### Scenario: Component location

- **WHEN** the filter is rendered
- **THEN** it comes from `modules/drogas/ui/`, not from `modules/proveedores/ui/`

### Requirement: Partida options

The options SHALL be the droga's partidas that have at least one EGRESO_PREPARACION, labelled
`Lote <lote> · <proveedor> · vence dd/mm/aaaa` (insumos without vencimiento: "sin vencimiento"), ordered by
`fecha_ingreso DESC`.

#### Scenario: Partida never consumed

- **GIVEN** a partida of the droga with no EGRESO_PREPARACION
- **WHEN** the user opens the filter
- **THEN** it is not offered

#### Scenario: Insumo without vencimiento

- **GIVEN** a consumed partida with no vencimiento
- **WHEN** it is offered
- **THEN** its label ends with "sin vencimiento"

### Requirement: Parsing the partida filter

`parsearPartidaIds` (domain) SHALL take `searchParams.partida` as `string | string[] | undefined` and keep only
valid uuids (shared zod `uuid`), lowercase, dedupe in first-seen order, cap to `PARTIDAS_FILTRO_MAX` (20). The use
case input MUST be `partidaIds: z.array(uuid).max(20).default([])` (label in `shared/labels/field-labels.ts`).

#### Scenario: Messy params

- **WHEN** the URL carries an invalid id, an uppercase uuid and the same uuid in lowercase
- **THEN** the invalid id is dropped and one lowercase uuid is kept

#### Scenario: More than 20 ids

- **WHEN** the URL carries 25 valid distinct partida ids
- **THEN** only the first 20 are kept

### Requirement: Filter never trusted

The filter is **never trusted**: the repository SHALL apply only requested ids that are in the droga's option list.
A foreign or unknown id MUST be ignored, and a filter made only of such ids is no filter. The output carries
`partidasDisponibles` and `partidaIds` (the filter actually applied), which is what the UI renders.

#### Scenario: Partida of another droga

- **WHEN** the URL carries only the id of a partida of another droga
- **THEN** no filter is applied and every receta is listed

### Requirement: Filter selects recetas

A receta SHALL match when it consumed from ANY selected partida. The row's "Consumido" and the expanded detail MUST
still show EVERYTHING the receta consumed of this droga (all partidas). The filter selects recetas; it does not
trim them.

#### Scenario: Receta matching one selected partida

- **GIVEN** a receta that consumed from partidas A and B
- **WHEN** the user filters by A only
- **THEN** the receta is listed
- **AND** its Consumido and detail include what it consumed from B

## Status

Status: approved by user 2026-10-07 — implemented (see "Implementation notes" at the end).

## Key facts

Key facts (verified in the code):

- A droga reaches a receta two ways: prescribed (`ItemReceta →
  ComponenteItemReceta.drogaId`) and consumed (`Partida → MovimientoStock
  EGRESO_PREPARACION → Preparacion → ItemReceta → Receta`). Only the second
  one knows the partida. **This view shows ONLY the consumed path** (user
  decision): recetas still pending preparation are out.
- `EGRESO_PREPARACION` is written only when a preparación is confirmed
  (`modules/preparaciones/application/confirmar-preparacion.ts`). Discarding
  applies only to INICIADA and never touches stock
  (`descartar-preparacion.ts`). So the EGRESO_PREPARACION movements of the
  droga's partidas are, by themselves, the complete and exact source.

## Permissions

| Piece | Gate |
|---|---|
| Tab, recetas, partidas consumed, quantities | `recetas.crear` |
| Paciente name (otherwise "—") | `pacientes.gestionar` |
| Link to the partida in stock + unit conversion | `stock.ver` |

## Columns

| Column | Source | Notes |
|---|---|---|
| Nº | `receta.numero_interno` | |
| Preparada | latest `preparacion.confirmada_en` | tenant time zone |
| Paciente | `paciente.apellido, nombre` | only with `pacientes.gestionar` |
| Médico | `medico.apellido, nombre` | hidden on small screens |
| Consumido | `SUM(movimiento_stock.cantidad)` | this droga only, across all of the receta's items and partidas |
| Estado | `receta.estado` | status badge (an ANULADA receta still shows: the stock was consumed) |

## Technical design

- `modules/drogas/domain/historial.ts` — pure: types, `parsearPartidaIds`,
  option split helpers (`partidasSeleccionadas` / `partidasRestantes`),
  partida label, pagination (`calcularPaginacion`, small local copy, as in
  proveedores), `PAGE_MAX_HISTORIAL_DROGA`.
- `modules/drogas/infrastructure/historial-repository.ts` — raw SQL, tenant
  scoped everywhere, explicit columns:
  1. droga header (`id`, `nombre`, `fecha_baja`); null → 404.
  2. partida options: `partida p WHERE p.tenant_id = $t AND p.droga_id = $d
     AND EXISTS (movimiento_stock m WHERE m.tenant_id = $t AND m.partida_id =
     p.id AND m.tipo = 'EGRESO_PREPARACION')` + proveedor razón social.
  3. one page of recetas: from `movimiento_stock m JOIN partida p` (droga
     $d, optional `p.id = ANY($partidaIds)` applied through a receta-level
     `EXISTS`), `JOIN preparacion pr ON pr.id = m.preparacion_id JOIN
     item_receta ir JOIN receta r`, `GROUP BY r.id`, ORDER/LIMIT/OFFSET as
     above, plus its own `count(DISTINCT r.id)` (the pagination total, and
     the unfiltered total for the "de M" line when a filter is active).
     Paciente columns are selected only with `pacientes.gestionar`.
  4. detail for the page: `receta_id IN (page ids)` grouped by
     `(receta_id, partida_id)` with lote / proveedor / vencimiento.
  Every join also carries `tenant_id` (composite-key discipline).
- `modules/drogas/application/get-historial-droga.ts` — `defineQuery` on
  `recetas.crear`. Input `{ drogaId, page, partidaIds }`. Computes the `acceso`
  flags with `can()` and passes them to the repository.
- `modules/drogas/ui/historial-*.tsx` — row cells, expanded detail, filter.
- `app/(app)/catalogos/drogas/[id]/historial/page.tsx`, `[id]/layout.tsx`,
  `app/(app)/catalogos/drogas/droga-tabs.tsx`. The existing `[id]/page.tsx`
  renders `DrogaTabs` under its header.
- No logging of free-text fields or paciente data.

## Database

No migration expected. The query enters through the existing
`partida (tenant_id, droga_id)` index, then
`movimiento_stock (tenant_id, partida_id, registrado_en DESC)` per partida, and
from there by primary key to `preparacion`, `item_receta` and `receta`. If a
measurement on a seeded tenant shows otherwise, an additive index migration
(next free number, currently 0067) and its rollback go in a separate commit,
as in 0056.

## Testing

Unit tests with a fake `tx` (same style as the proveedor historial):
`parsearPartidaIds` (invalid, duplicates, case, cap), option split helpers,
partida label (with/without vencimiento), pagination clamp, use case gating
(no `pacientes.gestionar` → no paciente fields fetched; no `stock.ver` → no
partida links), foreign partida ids ignored. Typecheck and lint. The raw SQL
must be run once against a seeded tenant before it is relied on.

## Out of scope (v1)

- Recetas that prescribe the droga but are not prepared yet.
- Resumen block (counts, pacientes distintos, total consumido).
- Export (Excel/PDF) of the list for a recall.
- Filters other than partida (date range, paciente, médico).

## Implementation notes

Status: implemented 2026-10-07. Decisions taken while building it (none changes
the approved behavior; each is the narrowest reading of the spec).

- **Permiso codes.** `recetas.ver` / `pacientes.ver` are use-case NAMES, not
  permiso codes. The spec text above (Routes, Permissions table, Content,
  Technical design, Testing) was corrected to the real codes: `recetas.crear`
  (tab, page and the `drogas.historial` defineQuery, same as `/recetas/**`),
  `pacientes.gestionar` (paciente name) and `stock.ver` (partida link + unit
  catalog). `recetas.crear` is `operativo`, so the locked ADMINISTRADOR does not
  hold it implicitly. A single helper, `puedeVerHistorialDroga`, is the rule
  used by the tab and the page.
- **Page size** is 20 (spec silent).
- **Paciente column** is always present, "—" without `pacientes.gestionar`; the
  paciente statement is not even executed in that case.
- **`DrogaTabs`** renders nothing when the session cannot see the Historial.
- **Statements.** options, count (unfiltered + filtered total in one pass), page,
  detail and (optional) paciente names: one each, whatever the page size. The
  partida filter is ONE bound `uuid[]` and the SQL switches on
  `cardinality(...) = 0`; the page applies it with `HAVING bool_or(...)`, and the
  detail statement never receives it (the filter selects recetas, it does not trim
  them).
- **Labels.** `drogaId`, `page` and `partidaIds` already existed in
  `shared/labels/field-labels.ts`; nothing was added.
- **Options are not capped** (a droga's partidas with egresos is a small list; the
  Combobox shows at most 30 matches at once).
- **Not verified against Postgres.** Everything was verified with unit tests
  (fake `tx`), typecheck and lint. The raw SQL (count, page, detail, paciente
  names, options) has NOT been executed against a real database in this change,
  by instruction (`test:db` points at the single production database). Run it once
  against a seeded tenant before relying on it, including: an empty `{}` filter
  array bound as `uuid[]`, a receta with items of several partidas, and an ANULADA
  receta (it must still appear).

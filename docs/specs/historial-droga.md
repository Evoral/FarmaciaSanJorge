# Historial de la droga

Status: approved by user 2026-10-07 — not implemented yet.

## Goal

From the droga catalog, a per-droga, read-only view of every receta that
actually CONSUMED that droga, and from which partida(s) it came. Sibling of
`docs/specs/trayectoria-proveedor.md` (same patterns, same look). Typical use:
a lot recall — "lote X was bad, which recetas (and pacientes) got it?".

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

## Routes and navigation

- `/catalogos/drogas/[id]` gets two tabs, **Datos** (`/catalogos/drogas/[id]`,
  exact, the current edit/baja/reactivar page) | **Historial**
  (`/catalogos/drogas/[id]/historial`), via a `DrogaTabs` component built on
  `SectionTabs` (same as `app/(app)/proveedores/proveedor-tabs.tsx`), rendered
  by each page right under its header.
- New `app/(app)/catalogos/drogas/[id]/layout.tsx`: uuid guard only (malformed
  id → 404), same as `app/(app)/proveedores/[id]/layout.tsx`.
- The Historial tab is rendered only when the session holds `recetas.ver`.
  Opening the historial URL without it redirects to the Datos tab (the page
  checks `can()` before calling the use case, so no ACCESO_DENEGADO row is
  written for a link the UI never showed).
- URL carries only the opaque droga UUID, `?page=` and the optional repeatable
  `?partida=<uuid>` filter. Partida ids are not sensitive.
- Breadcrumbs: `Inicio › Catálogos › Drogas › <droga> › Historial`.

## Permissions

Base access: the existing `catalogos/drogas/layout.tsx` guard
(`drogas.editar`). The view exposes receta data, so the use case is a
`defineQuery` on **`recetas.ver`**. Optional pieces are decided with `can()`
inside the use case (never by calling other defineQuerys: a denial writes
ACCESO_DENEGADO). A piece the session cannot see is neither fetched nor
rendered.

| Piece | Gate |
|---|---|
| Tab, recetas, partidas consumed, quantities | `recetas.ver` |
| Paciente name (otherwise "—") | `pacientes.ver` |
| Link to the partida in stock + unit conversion | `stock.ver` |

Without `stock.ver`, quantities show in the droga's unidad base, unconverted
(same rule as the proveedor historial: `getCatalogoUnidades` is called only
when the session holds it).

## Content

**Recetas table** — `table.data-table` inside a `list-panel`, with a count
line, an empty state and the standard pagination bar. **One row per receta**
that has at least one EGRESO_PREPARACION of this droga, newest first by the
latest `preparacion.confirmada_en` among those movements (tie-break
`receta.numero_interno DESC`). Each row expands (`FilaDesplegable`, closed by
default).

Columns:

| Column | Source | Notes |
|---|---|---|
| Nº | `receta.numero_interno` | |
| Preparada | latest `preparacion.confirmada_en` | tenant time zone |
| Paciente | `paciente.apellido, nombre` | only with `pacientes.ver` |
| Médico | `medico.apellido, nombre` | hidden on small screens |
| Consumido | `SUM(movimiento_stock.cantidad)` | this droga only, across all of the receta's items and partidas |
| Estado | `receta.estado` | status badge (an ANULADA receta still shows: the stock was consumed) |

Expanded detail: one line per partida consumed by that receta — lote,
proveedor (razón social), vencimiento, and the quantity consumed from it
(`SUM(cantidad)` grouped by partida). The detail also has a link to the
receta (`/recetas/[id]`) and, with `stock.ver`, a link to each partida.

Quantities are never summed across drogas. Here everything is one droga, so
one unidad base. `cantidad` is the physical quantity already written by the
confirmation (it includes the potencia correction).

Count line: "N receta(s)". With a filter: "{filtradas} de {total} recetas".
Empty states: "Esta droga todavía no se usó en ninguna preparación." /
with a filter: "No hay recetas que hayan usado las partidas seleccionadas."

No resumen block in v1.

## Filtro por partida

- Same UX and URL contract as the proveedor's "Filtrar por droga"
  (`modules/proveedores/ui/trayectoria-filtro-drogas.tsx`): an autocomplete
  (`shared/ui/combobox`) over the partidas NOT selected yet, plus one chip per
  selected partida (✕ removes it, accessible name "Quitar filtro <etiqueta>").
  `page` is dropped on every change. It is a NEW component in
  `modules/drogas/ui/` (modules do not import each other's UI); only shared
  pieces are reused.
- Options: the droga's partidas that have at least one EGRESO_PREPARACION,
  labelled `Lote <lote> · <proveedor> · vence dd/mm/aaaa` (insumos without
  vencimiento: "sin vencimiento"), ordered by `fecha_ingreso DESC`.
- Parsing (`parsearPartidaIds`, domain): `searchParams.partida` is
  `string | string[] | undefined`; keep only valid uuids (shared zod `uuid`),
  lowercase, dedupe in first-seen order, cap to `PARTIDAS_FILTRO_MAX` (20).
  Use case input: `partidaIds: z.array(uuid).max(20).default([])` (label in
  `shared/labels/field-labels.ts`).
- **Never trusted.** The repository applies only requested ids that are in
  the droga's option list. A foreign or unknown id is ignored, and a filter
  made only of such ids is no filter. The output carries
  `partidasDisponibles` and `partidaIds` (the filter actually applied), which
  is what the UI renders.
- Semantics: a receta matches when it consumed from ANY selected partida.
  The row's "Consumido" and the expanded detail still show EVERYTHING the
  receta consumed of this droga (all partidas). The filter selects recetas;
  it does not trim them.

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
     Paciente columns are selected only with `pacientes.ver`.
  4. detail for the page: `receta_id IN (page ids)` grouped by
     `(receta_id, partida_id)` with lote / proveedor / vencimiento.
  Every join also carries `tenant_id` (composite-key discipline).
- `modules/drogas/application/get-historial-droga.ts` — `defineQuery` on
  `recetas.ver`. Input `{ drogaId, page, partidaIds }`. Computes the `acceso`
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
(no `pacientes.ver` → no paciente fields fetched; no `stock.ver` → no
partida links), foreign partida ids ignored. Typecheck and lint. The raw SQL
must be run once against a seeded tenant before it is relied on.

## Out of scope (v1)

- Recetas that prescribe the droga but are not prepared yet.
- Resumen block (counts, pacientes distintos, total consumido).
- Export (CSV/PDF) of the list for a recall.
- Filters other than partida (date range, paciente, médico).

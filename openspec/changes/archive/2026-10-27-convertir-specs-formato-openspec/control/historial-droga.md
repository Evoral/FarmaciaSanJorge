# Control table: historial-droga

Original: `git show b9c8838:openspec/specs/historial-droga/spec.md`.

The original rules have no IDs, so the requirements have none (design §1).

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status line (approved 2026-10-07, implemented) | `## Status` | — | Verbatim; approval date also in `## Purpose`. |
| Goal ¶1 (per-droga view, sibling, lot recall) | `## Purpose` | — | Verbatim. |
| Key facts (two paths, consumed only = user decision; EGRESO_PREPARACION complete source) | "Consumed path only" + `## Key facts` (verbatim) | "Receta prescribed but not prepared", "Receta prepared from a partida" (direct) | The rule is restated in the requirement and kept verbatim in Key facts. |
| Routes: two tabs via `DrogaTabs` / `SectionTabs` | "Datos and Historial tabs" | "Datos is an exact match" (**derived** from "exact") | — |
| Routes: `[id]/layout.tsx` uuid guard | "Uuid guard" | "Malformed id" (direct) | — |
| Routes: tab only with `recetas.crear`, redirect, no ACCESO_DENEGADO | "Historial only with recetas.crear" | "Session without recetas.crear" (direct), "Historial URL without recetas.crear" (direct) | — |
| Routes: URL contents | "URL contents" | "Filtered page" (direct) | — |
| Routes: breadcrumbs | "Breadcrumbs" | "Opening the historial" (direct) | — |
| Routes: lot tracing button (2026-10-19) | "Lot tracing from the partida" | "Tracing a lote" (direct), "Missing one of the gates" (**derived**) | — |
| Permissions ¶: base guard `drogas.editar`, `defineQuery` on `recetas.crear` | "Base access and use case permiso" | "Session without drogas.editar" (**derived**) | — |
| Permissions ¶: `can()` inside, never other defineQuerys; not fetched nor rendered; table | "Optional pieces gated with can()" + `## Permissions` (table verbatim) | "Without pacientes.gestionar", "Without stock.ver" (direct) | — |
| Permissions: without `stock.ver` unconverted, `getCatalogoUnidades` only with it | "Quantities without stock.ver" | "Unconverted quantity" (direct) | — |
| Content: table, list-panel, count, empty, pagination, `FilaDesplegable` | "Recetas table" | "Expanding a row" (**derived**: the click) | Split from the next row (500-character limit). |
| Content: one row per receta, order, tie-break | "One row per receta" | "Receta prepared from two partidas", "Same preparation time" (direct) | — |
| Columns table | "Columns" + `## Columns` (verbatim) | "Anulada receta" (direct) | — |
| Expanded detail | "Expanded detail" | "Detail of a receta" (direct) | — |
| Quantities never summed, one unidad base, potencia | "Quantities" | "Potencia-corrected quantity" (**derived**) | — |
| Count line, empty states | "Count line and empty states" | "Droga never used", "Filter with no recetas" (direct) | — |
| No resumen block in v1 | "No resumen block" | "Opening the historial" (direct) | — |
| Filtro: same UX as proveedor's, combobox, chips, `page` dropped | "Filtro por partida controls" | "Removing a chip" (direct) | — |
| Filtro: NEW component in `modules/drogas/ui/` | "Filter component of its own" | "Component location" (direct) | — |
| Filtro: options, label, order | "Partida options" | "Partida never consumed", "Insumo without vencimiento" (direct) | — |
| Filtro: parsing, zod input | "Parsing the partida filter" | "Messy params" (**derived**: combines valid-uuid, lowercase and dedupe), "More than 20 ids" (**derived**: "first 20" from cap + first-seen order) | — |
| Filtro: never trusted | "Filter never trusted" | "Partida of another droga" (direct) | — |
| Filtro: semantics ANY, nothing trimmed | "Filter selects recetas" | "Receta matching one selected partida" (direct) | — |
| Technical design, Database, Testing, Out of scope, Implementation notes | same-named sections | — | Verbatim. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

## Notes for the reviewer (kept as written)

- Implementation notes say "The spec text above (Routes, Permissions table, Content, Technical design, Testing)
  was corrected"; Routes and Content are now requirements, not headings.
- `## Database` says "next free number, currently 0067": 0067 has since been used by `sinonimos-droga`
  (stale, historical).

`openspec validate historial-droga --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-26)

Independent review (separate agent): APPROVE. Derived scenarios confirmed in code. "Messy params" re-marked as
derived (the code agrees: `parsearPartidaIds` lowercases, then dedupes through a `Set`). The stale "next free
number, currently 0067" in `## Database` is confirmed (0067 is `droga_sinonimos`; the latest is 0105).

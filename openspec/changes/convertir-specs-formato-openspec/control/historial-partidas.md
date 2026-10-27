# Control table: historial-partidas

Original: `git show b9c8838:openspec/specs/historial-partidas/spec.md`.

The original rules have no IDs, so the requirements have none (design §1).

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status line (implemented 2026-10-13) | `## Status` | — | Verbatim; date also cited in `## Purpose`. |
| Goal ¶1: general read-only list, every partida, find lote / proveedor / estado / detail | `## Purpose` + "Every partida of the tenant" | "Agotada partida" (direct) | "It is a history: agotadas are included by default" kept in the requirement. |
| Goal ¶2: insumos are drogas with another `clase` (0063) | "Insumo partidas" | "Partida of an excipiente" (direct) | — |
| Goal ¶3: `/stock/partidas` merged, `/stock` links to `?drogaId=...&saldo=1` | "Per-droga list merged" | "Partidas of a droga from Stock" (direct) | — |
| Route `/partidas`, breadcrumbs, title | "Route" | "Opening the list" (direct) | — |
| Sidebar entry, `stock.ver`, Stock not highlighted | "Sidebar entry" | "Sidebar on the partidas pages" (direct) | — |
| "Nuevo ingreso" button, `/stock` no longer offers it | "Nuevo ingreso starts here" | "Starting an ingreso", "Stock header" (direct) | — |
| Permission `stock.ver`, enforced twice, exposes nothing new | "Permission stock.ver" | "User without stock.ver" (**derived**) | Guard file is stale, see below. |
| Filters: URL, AND, invalid dropped, zod again | "Filters in the URL" + `## Filters` (table verbatim) | "Combined filters" (**derived**: AND), "Invalid value" (**derived**: example value), "Inverted date range" (direct, from the table) | — |
| Proveedor list from the stock query, not `listProveedoresOpciones` | "Proveedor options" | "Proveedor filter without proveedores.gestionar" (**derived**) | — |
| Order, page size 20, clamp ≥ 1 | "Order and page size" | "Page below 1" (**derived**: `?page=0` read from "clamped to ≥ 1") | — |
| Columns 1–8 | "Columns" + `## Columns` (list verbatim) | "Agotada partida", "Partida that does not expire", "Reanalizada partida" (direct) | — |
| Total count, empty states | "Count and empty states" | "No partidas at all", "Filter with no match" (direct) | — |
| Code map + "No schema change… Rollback…" | `## Code` | — | Verbatim. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

## Suspected stale rule (kept as written)

"Permission stock.ver" names the section guard `app/(app)/stock/layout.tsx`. `/partidas` has its own guard,
`app/(app)/partidas/layout.tsx` ("same `stock.ver` permiso as `/stock/**`"), which is the one that applies.

`openspec validate historial-partidas --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-26)

Independent review (separate agent): APPROVE. Derived scenarios confirmed in code. The stale guard path is
confirmed: `app/(app)/partidas/layout.tsx` guards `stock.ver` itself; the header comment of
`app/(app)/partidas/page.tsx` repeats the same stale path.

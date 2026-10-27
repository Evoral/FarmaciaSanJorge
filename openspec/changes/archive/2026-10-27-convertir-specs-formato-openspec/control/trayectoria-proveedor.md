# Control table: trayectoria-proveedor

Original: `git show b9c8838:openspec/specs/trayectoria-proveedor/spec.md`.

The original rules have no IDs, so the requirements have none (design §1).

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status line (approved 2026-10-01, implemented) | `## Status` | — | Verbatim; approval date also in `## Purpose`. |
| Goal ¶1 | `## Purpose` | — | Verbatim. |
| Key fact (Proveedor → Partida only, no remito) | `## Key fact` | — | Verbatim; cited from Purpose. |
| Routes: tabs via `[id]/layout.tsx` (back link + tabs + uuid guard) | "Datos and Trayectoria tabs" | "On the Trayectoria tab" (**derived** from "exact"), "Malformed id" (direct) | Stale, see below. |
| Routes: "Trayectoria" link per row | "Trayectoria link in the list" | "Proveedor list" (direct) | Stale, see below. |
| Routes: URL contents | "URL contents" | "Filtered page" (direct) | — |
| Routes: guard `proveedores.gestionar` | "Guard proveedores.gestionar" | "Session without proveedores.gestionar" (**derived**) | — |
| Content 1: header | "Header" | "Proveedor dado de baja" (direct) | — |
| Content 2: resumen counters, never summed across drogas | "Resumen counters" | "Proveedor with more than one page" (direct) | Split from the money part (500-character limit). |
| Content 2: money only with `stock.valorizado.ver`, current cost, hint | "Resumen money only with stock.valorizado.ver" | "With…", "Without stock.valorizado.ver" (direct) | — |
| Content 3: table, expand, order, 10 per page | "Partidas table" | "Opening the table", "Clicking a row" (direct) | — |
| Summary columns | "Summary columns" | "Without stock.valorizado.ver" (direct) | — |
| Derived estado priority, reuse stock rules | "Derived partida estado" | "Expired and empty", "Open and within the alert window" (**derived** from the priority order) | — |
| Body: movimientos | "Movimientos in the detail" | "Partida with 25 movimientos" (direct) | — |
| Body: preparaciones, never receta/paciente | "Preparaciones in the detail" | "With…" (direct), "Without preparaciones.iniciar" (**derived**) | — |
| Body: contralor | "Contralor in the detail" | "Without libro.ver" (**derived**) | — |
| Body: correcciones de costo | "Correcciones de costo in the detail" | "Without auditoria.ver" (**derived**) | — |
| Body: link to `/partidas/[id]` (`stock.ver`) | "Link to the partida" | "Without stock.ver" (**derived**: "(`stock.ver`)" read as "only with") | — |
| Filtro intro (approved 2026-10-01, `FilterForm`) + Semantics (OR) | "Filtro por droga semantics" | "Two drogas selected" (direct) | — |
| Controls: hidden without partidas; "Filtrar por droga" select | "Filtrar por droga field" | "Proveedor without partidas", "Every droga selected" (direct), "Choosing a droga" (**derived**: it leaves the options) | Stale, see below. |
| Controls: chips, unchecking, Limpiar filtros, `hasActiveFilters` | "Selected droga chips" | "Removing a chip", "Limpiar filtros" (direct) | — |
| Controls: chips in alphabetical order | "Chips in alphabetical order" | "URL order differs" (direct) | — |
| URL: repeated `droga`, `page` dropped, pagination keeps drogas | "Filter URL" | "Changing the filter on page 3", "Pagination links" (direct) | — |
| Parsing (`parsearDrogaIds`, zod input, single defineQuery) | "Parsing the droga filter" | "Messy params" (direct) | — |
| Never trusted | "Filter never trusted" | "Droga the proveedor never supplied" (direct) | — |
| Queries | "Filter queries" + `## Filter queries` (verbatim) | "Pagination total with a filter" (direct) | — |
| Count line, empty result | "Filter count line and empty result" | "Filtered count" (direct) | — |
| Resumen stays proveedor-wide | "Resumen stays proveedor-wide" | "Resumen with a filter" (direct) | — |
| Shared FilterForm change | "Shared FilterForm keeps repeated names" + `## Shared FilterForm change` (verbatim) | "Two checked chips" (direct) | — |
| Permissions ¶ + table | "Permissions" + `## Permissions` (table verbatim) | "Without auditoria.ver" (direct) | — |
| Technical design, Database, Out of scope, Implementation notes | same-named sections | — | Verbatim. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

## Stale rules (kept as written)

- Commit 6b0dd79 renamed Trayectoria to Historial: the route is `/proveedores/[id]/historial`, the tabs are
  "Datos | Historial" (`app/(app)/proveedores/proveedor-tabs.tsx`), the list link goes to `/historial`
  (`app/(app)/proveedores/page.tsx`); `/proveedores/:id/trayectoria` redirects (`next.config.ts`).
- `app/(app)/proveedores/[id]/layout.tsx` is now the uuid guard only; each page renders its own header and the
  tabs. The cited `app/(app)/pacientes/[id]/layout.tsx` no longer exists (now `clientes/[id]`).
- "Filtrar por droga field" / "Selected droga chips": the control is now a client `Combobox` autocomplete with ×
  chips (`modules/proveedores/ui/trayectoria-filtro-drogas.tsx`, `"use client"`), not a server-component
  `select.input` with checkbox chips. The URL contract is unchanged.

`openspec validate trayectoria-proveedor --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-26)

Independent review (separate agent): APPROVE. Permission-gated scenarios match `get-trayectoria-proveedor.ts`;
the estado priority matches `derivarEstadoPartida`. The route/tabs/Combobox renames recorded above are
confirmed. Two scenarios re-marked as derived.

Pre-existing, kept as written:
- "Selected droga chips" quotes "Limpiar filtros"; the button now reads "Limpiar".
- "Derived partida estado" omits that a partida without an expiry date (migration 0064) is never VENCIDA or
  POR_VENCER (`derivarEstadoPartida`).

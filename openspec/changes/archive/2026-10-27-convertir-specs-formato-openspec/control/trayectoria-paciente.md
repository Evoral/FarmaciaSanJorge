# Control table: trayectoria-paciente

Original: `git show b9c8838:openspec/specs/trayectoria-paciente/spec.md`.

The original rules have no IDs, so the requirements have none (design §1).

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status line ("implementation in progress") | `## Status` | — | Verbatim, as instructed; see the implementation check below. |
| Goal (per-patient, receta by receta, read-only) | `## Purpose` | — | Verbatim + approval date. |
| Routes: two tabs | "Datos and Trayectoria tabs" | "Opening a paciente" (direct) | — |
| Routes: "Trayectoria" button per row | "Trayectoria button in the list" | "Paciente list" (direct) | — |
| Routes: opaque UUID + `?page=` only (DP-24) | "Nothing identifying in the URL" | "Paging the trayectoria" (direct) | — |
| Routes: under `pacientes/layout.tsx` guard | "Guard pacientes.gestionar" | "Session without pacientes.gestionar" (**derived**) | — |
| Routes: exact active state for Datos | "Datos tab exact active state" | "On the Trayectoria tab" (direct) | — |
| Content 1: header | "Header" | "Paciente dado de baja" (direct) | — |
| Content 2: resumen over ALL recetas | "Resumen over all the recetas" | "Paciente with more than one page" (direct) | — |
| Content 3: order, page size 10, expandable row, summary, journey | "Recetas list" | "Paging", "Expanding a receta" (direct) | — |
| Ingreso step | "Ingreso step" | "Item without cotización" (**derived**: reading of "flag partial/incomplete") | — |
| Preparación step | "Preparación step" | "Discarded preparación" (direct) | — |
| Libro step, link via asiento SISTEMA, never `pacienteTexto` | "Libro step" | "Rectified asiento" (**derived**: an asiento with a rectificativo shows the "sin efecto por rectificación" state), "Asiento with the same patient text" (direct) | — |
| Entrega, Archivo steps; anulada `motivoAnulacion` | "Entrega and Archivo steps" | "Anulada receta" (direct) | — |
| Step links only with the page's permiso | "Step links only with the page's permiso" | "Without entregas.registrar" (direct, gate from the table) | — |
| Visibility table + "omitted from the query AND the UI" | "Visibility per role" + `## Visibility per role` (table verbatim) | "Without libro.ver" (direct; the AND is **derived** from Technical design), "Without cotizaciones.ver" (direct) | The `can()` / no-other-defineQuery rule is restated from Technical design, which is also kept verbatim. |
| Receta física removed: consequence 1 | "No receta física" | "Opening a Trayectoria" (direct) | — |
| Receta física removed: consequence 2 | "Archivo and Entrega states" | "Receta without lote", "Envío waiting for its firma" (direct) | — |
| Receta física removed: consequence 3 | "Explicit select on receta" | "Reading recetas" (direct) | — |
| Receta física removed (whole section) | `## Receta física removed (2026-10-01)` | — | Verbatim (history + consequences). |
| Technical design, Database, Out of scope | same-named sections | — | Verbatim. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

## Implementation status check

The feature looks **implemented**; the status line "implementation in progress" is stale. Evidence:

- Use case `modules/pacientes/application/get-trayectoria-paciente.ts`: `defineQuery` on `pacientes.gestionar`,
  optional blocks by `can()` exactly as the Visibility table (`cotizaciones.ver`, `preparaciones.iniciar`,
  `libro.ver`, `archivo.lotes.gestionar`, `recetas.crear`, `entregas.registrar`).
- Domain `modules/pacientes/domain/trayectoria.ts` (`PAGE_SIZE_TRAYECTORIA = 10`), repository
  `modules/pacientes/infrastructure/trayectoria-repository.ts`, UI `modules/pacientes/ui/trayectoria-*.tsx`.
- Page `app/(app)/clientes/[id]/historial/page.tsx`.
- Migration `prisma/migrations/20261001100000_0051_trayectoria_paciente_indices`,
  `prisma/rollbacks/0051_trayectoria_paciente_indices.down.sql`, `docs/rollbacks/trayectoria-paciente.md`.

## Stale rules (kept as written)

Commit 1fafdc7 (2026-10-23) renamed the section: the spec's routes and labels no longer match the code.

- Route `/pacientes/[id]/trayectoria` is now `/clientes/[id]/historial`; the tabs are "Datos | Historial"
  (`ClienteTabs` in `app/(app)/clientes/clientes-tabs.tsx`). Old URLs redirect (`next.config.ts`).
- The list button is "Historial", not "Trayectoria" (`modules/pacientes/ui/pacientes-buscador.tsx`).
- The guard named `app/(app)/pacientes/layout.tsx` is now `app/(app)/clientes/layout.tsx` (same permiso).

`openspec validate trayectoria-paciente --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-26)

Independent review (separate agent): CHANGES NEEDED → fixed. The "Rectified asiento" scenario said the asiento
and its rectificativo are both shown; the original does not say so and the code shows one asiento with one
visual state (`trayectoria-repository.ts` loads the rectificativo with `take: 1` only for its number). The
scenario now asserts the "sin efecto por rectificación" state. The review confirmed the implementation and the
route/tab/button renames recorded above.

Pre-existing, kept as written: "Explicit select on receta" says `schema.prisma` still declares the dropped
receta física fields; it no longer does. The explicit `select` the rule asks for is still used, so the rule is
harmless but its premise is stale.

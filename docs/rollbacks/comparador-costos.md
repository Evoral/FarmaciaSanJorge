# Rollback: Comparador de costos

Spec: `docs/specs/comparador-costos.md`. The feature is read-only and needs **no
database change**: no migration, no column, no index, no permiso, no seed (it
reuses `stock.valorizado.ver` and the indexes `fsj.partida` already has: the
planner will likely use the unique `(tenant_id, droga_id, proveedor_id, lote)`
one, `idx_partida_tenant_droga` being only `(tenant_id, droga_id)`). So
there is no data to restore and no `down.sql`: reverting is a code-only change.

## New files (delete on rollback)

- `modules/proveedores/domain/comparador-costos.ts`
- `modules/proveedores/infrastructure/comparador-costos-repository.ts`
- `modules/proveedores/application/comparar-costos-droga.ts` (use case `proveedores.comparar-costos`, permiso `stock.valorizado.ver`)
- `modules/proveedores/ui/comparador-filtros.tsx`
- `modules/proveedores/ui/comparador-encabezado.tsx`
- `modules/proveedores/ui/comparador-fila.tsx`
- `app/(app)/comparador-costos/layout.tsx`
- `app/(app)/comparador-costos/page.tsx`
- `tests/unit/comparador-costos.test.ts`
- `tests/unit/comparador-costos-repository.test.ts`
- `tests/unit/comparador-costos-authorization-matrix.test.ts`
- this file and `docs/specs/comparador-costos.md` (optional: keeping them is harmless)

## Shared dependencies (what this feature uses from others)

- `app/(app)/comparador-costos/page.tsx` imports `shared/ui/fila-desplegable.tsx`
  (the client component of the expandable rows, introduced with the Trayectoria
  views). Reverting the Trayectoria features must NOT delete it while the
  comparador is in place; the three features share it.
- `modules/proveedores/infrastructure/comparador-costos-repository.ts` imports
  `readJornadaActual` from
  `modules/proveedores/infrastructure/trayectoria-repository.ts`. Reverting the
  proveedor Trayectoria deletes that file: either move `readJornadaActual` (a
  3-line `fsj.jornada_actual` read) into the comparador repository first, or revert
  the comparador as well.
- It also relies on `shared/format/monto.ts` (`formatearCostoUnitario`) and
  `shared/format/cantidad.ts` / `shared/time/jornada.ts`, which pre-exist.

## Edited files (revert only the Comparador hunks)

Revert by hunk, NOT with `git checkout` on these paths: the working tree also
holds the unrelated, uncommitted Trayectoria / proveedor work.

- `app/(app)/layout.tsx`: the `puedeComparadorCostos: can(session, "stock.valorizado.ver"),` line in the `nav` object.
- `app/(app)/sidebar-nav.tsx`: the `puedeComparadorCostos: boolean;` prop (with its doc comment) in `SidebarNavProps`, and the `if (p.puedeComparadorCostos) gestion.push(...)` line in `buildGroups` (between Proveedores and Reportes). The file uses CRLF line endings: keep them.
- `shared/ui/status-badge.tsx`: the `ToneBadge` component appended at the end of the file, the `import type { ReactNode } from "react";` line, and `type Tone` -> `export type BadgeTone` (the rename touches `TONE_BY_ESTADO` and `TONE_CLASSES` too; `BadgeTone` is harmless to keep). CRLF file: keep the endings.
- `shared/labels/field-labels.ts`: the `periodo: "Período",` and `unidad: "Mostrar costo por",` entries (the label-completeness test only requires them while the use case input has those keys; with the use case deleted they are unused but harmless).

## Order

1. Remove the sidebar entry and the `nav` prop (so no link points at a deleted route).
2. Delete `app/(app)/comparador-costos/`.
3. Delete the use case, repository, domain and UI files, then the three test files.
4. Revert the `status-badge.tsx` and `field-labels.ts` hunks.
5. `npm run typecheck`, `npx eslint --max-warnings 0 .` and `npm test` must stay green.

Anyone with the page open sees a 404 after the deploy; there is no stored state.

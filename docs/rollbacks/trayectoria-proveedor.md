# Rollback: Trayectoria del proveedor

Spec: `docs/specs/trayectoria-proveedor.md`. The feature is read-only: no data,
column, constraint, permiso or use-case change to anything that already existed.
Its only database change is ONE additive index (migration 0056), and that index
is performance-only (the view returns the same rows without it).

The proveedores route move (`/catalogos/proveedores` -> `/proveedores`, with the
`next.config.ts` redirect, sidebar entry and `catalogos` tab removal) shipped in
the same working tree but is **not part of this feature**: it is a separate
change with its own revert (see `docs/rollbacks/trayectoria-paciente.md`,
section B, for the identical Pacientes move). This file only covers what the
Trayectoria added on top of it.

## What it changed

### Database
| File | Change |
|---|---|
| `prisma/migrations/20261001130000_0056_trayectoria_proveedor_indices/migration.sql` | `idx_partida_tenant_proveedor_ingreso` on `fsj.partida (tenant_id, proveedor_id, fecha_ingreso DESC)` (`CREATE INDEX IF NOT EXISTS`) plus its `COMMENT` |
| `prisma/rollbacks/0056_trayectoria_proveedor_indices.down.sql` | `DROP INDEX IF EXISTS fsj.idx_partida_tenant_proveedor_ingreso` |
| `prisma/schema.prisma` | one `@@index([tenantId, proveedorId, fechaIngreso(sort: Desc)], map: "idx_partida_tenant_proveedor_ingreso")` line (plus its `///` comment) in `model Partida` |

### New files (delete on rollback)
- `modules/proveedores/domain/trayectoria.ts`
- `modules/proveedores/infrastructure/trayectoria-repository.ts`
- `modules/proveedores/application/get-trayectoria-proveedor.ts` (use case `proveedores.trayectoria`, permiso `proveedores.gestionar`)
- `modules/proveedores/ui/trayectoria-encabezado.tsx`
- `modules/proveedores/ui/trayectoria-resumen.tsx`
- `modules/proveedores/ui/trayectoria-partida-fila.tsx`
- `modules/proveedores/ui/trayectoria-filtro-drogas.tsx` ("Filtro por droga", see the section below)
- `shared/ui/fila-desplegable.tsx` (client component shared with the Pacientes Trayectoria; delete only if that one is reverted too. Do NOT delete it while the Comparador de costos uses it: see `docs/rollbacks/comparador-costos.md`. Likewise, `trayectoria-repository.ts` exports `readJornadaActual`, which the comparador's repository imports)
- `tests/unit/fila-desplegable.test.ts`
- `app/(app)/proveedores/[id]/layout.tsx` (back link + Datos/Trayectoria tabs + uuid guard)
- `app/(app)/proveedores/[id]/trayectoria/page.tsx`
- `shared/format/monto.ts` (`formatearMonto`, moved out of pacientes, and `formatearCostoUnitario`; see the "Shared formatter" note below before deleting it)
- `tests/unit/proveedores-trayectoria.test.ts`
- `tests/unit/proveedores-trayectoria-repository.test.ts`
- `prisma/migrations/20261001130000_0056_trayectoria_proveedor_indices/` (only if 0056 was **never applied** anywhere: see step 3)
- `prisma/rollbacks/0056_trayectoria_proveedor_indices.down.sql` and this file, once the revert is done (optional: keeping them is harmless)

### Edited files (revert only the Trayectoria hunks)
- `app/(app)/proveedores/page.tsx`: the "Trayectoria" action column (an extra `<th>` with `sr-only` "Acciones", `colSpan` 3 -> 4 in the empty row, and the `<td>` with the `Link` to `/proveedores/${id}/trayectoria`), plus the pagination bounds (a `<span aria-disabled="true">` instead of a `Link` at the first / last page; harmless to keep). Revert the feature hunks BY HAND. Do NOT `git checkout` this path: since 9e78085 it exists only as the moved file, and its pre-feature version lives at the OLD path (`git show 771829a:"app/(app)/catalogos/proveedores/page.tsx"`), whose hrefs and `revalidatePath` calls still point at `/catalogos/proveedores`: restoring it would also undo the route move. Use that old copy only as a reference for the hunks (or when undoing the move on purpose, see the Pacientes rollback B).
- `app/(app)/proveedores/[id]/page.tsx`: the "Volver al listado" link block and its `import Link from "next/link"` moved to `[id]/layout.tsx` (re-add both above the `<h1>`, and the doc comment), plus the page's own uuid guard (`import { uuid }` and `if (!uuid.safeParse(id).success) notFound();`; remove if the layout guard is enough). Same caveat: revert by hunk, not with `git checkout 771829a --`, whose version of this file lives at `app/(app)/catalogos/proveedores/[id]/page.tsx`.
- `shared/ui/status-badge.tsx`: tones for `POR_VENCER` (warn), `AGOTADA` (neutral) and `ABIERTA` (neutral) in `TONE_BY_ESTADO`. Labels are not touched (the badge humanizes unknown estados). The file uses CRLF line endings: keep them.
- `modules/pacientes/domain/trayectoria.ts`: the `formatearMonto` function was **removed** (moved to `shared/format/monto.ts`).
- `modules/pacientes/ui/trayectoria-receta-fila.tsx`: `formatearMonto` is now imported from `@/shared/format/monto` instead of `../domain/trayectoria`.
- `tests/unit/pacientes-trayectoria.test.ts`: the `formatearMonto` import now points to `@/shared/format/monto`.
- `tests/unit/proveedores-authorization-matrix.test.ts`: the `get-trayectoria-proveedor` import, the `proveedores.trayectoria` case in `CASES`, and the last `describe` block.

### Filtro por droga (added on top of the feature; reverts independently)
New file: `modules/proveedores/ui/trayectoria-filtro-drogas.tsx`. Edited hunks:
- `shared/ui/filter-form.tsx`: `params.append(name, ...)` in `buildQuery` goes back to
  `params.set(name, ...)` (and drop the "repeated name" bullet of the doc comment). Only revert
  it together with the filter: no other form relies on `append`, and it is a no-op for them.
- `shared/labels/field-labels.ts`: the `drogaIds: "Drogas"` entry (the label-completeness test
  requires it only while the use case input has that key).
- `modules/proveedores/domain/trayectoria.ts`: `import { uuid }`, `DROGAS_FILTRO_MAX`, `DrogaOpcion`,
  `drogasDisponibles` / `drogaIds` / `totalFiltrado` in `TrayectoriaProveedorCruda`, `drogasDisponibles`
  / `drogaIds` in `TrayectoriaProveedor`, the `Filter by droga` section (`parsearDrogaIds`,
  `filtrarDrogasDelProveedor`, `drogasSeleccionadas`, `drogasRestantes`) and `paginacion` computed from
  `cruda.totalFiltrado` instead of `cruda.resumen.partidas`.
- `modules/proveedores/infrastructure/trayectoria-repository.ts`: `partidasWhere`,
  `readDrogasDisponibles`, `countPartidasFiltradas`, the `drogaIds` parameter of
  `readPartidasPagina`, the `drogaIdsSolicitados` parameter and the filter block in
  `getTrayectoriaProveedorCruda` (pagination back over `resumen.partidas`).
- `modules/proveedores/application/get-trayectoria-proveedor.ts`: `drogaIds` in the input schema and
  the extra argument to the repository.
- `app/(app)/proveedores/[id]/trayectoria/page.tsx`: `droga` in `searchParams`, `parsearDrogaIds`, the
  `<TrayectoriaFiltroDrogas>` block, the "{n} de {total} partidas." / empty-state wording and the
  `pageHref` that keeps every `droga` param.
- `tests/unit/proveedores-trayectoria.test.ts` and `tests/unit/proveedores-trayectoria-repository.test.ts`:
  the droga fixtures, the new `cruda()` fields, the `parsearDrogaIds` / `filtrar...` describe blocks
  and the "filtro por droga" repository describe (fake `tx` gained `droga.findMany` and
  `partida.count`).
No database object, permiso or parameter is involved.

### Shared formatter note
`shared/format/monto.ts` is used by BOTH Trayectorias. Rolling back only the
proveedor feature does **not** require touching it: leave `monto.ts` and the
three pacientes edits as they are (they keep working on their own;
`formatearCostoUnitario` just becomes unused). Only if `monto.ts` itself must go,
first restore `formatearMonto` into `modules/pacientes/domain/trayectoria.ts`
(just below `calcularPresupuesto`) and point the card and the test back at it:

```ts
/** "1234.5" -> "1.234,50" (es-AR, 2 decimals, no float round-trip). */
export function formatearMonto(valor: string): string {
  const [entero, fraccion] = dec(valor).toFixed(2).split(".");
  const signo = entero!.startsWith("-") ? "-" : "";
  const digitos = signo ? entero!.slice(1) : entero!;
  return `${signo}${digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraccion}`;
}
```

## Review fixes (same feature, no new files)
A later review changed these files only (all already listed above, revert them
together with the feature): the movimientos / preparaciones / cost-corrections
queries in `trayectoria-repository.ts` (bounded LATERAL reads, audit filtered in
SQL), `CORRECCIONES_POR_PARTIDA_MAX` / `DIAS_ALERTA_MAX` and the clamps in
`domain/trayectoria.ts`, the `$ X / <unidad base>` labels and the "hay más
correcciones" notice in `trayectoria-partida-fila.tsx`, the "< 0,000001" case in
`shared/format/monto.ts`, the pagination bounds and the uuid guard in the pages
listed above, and the migration header / spec wording. No database object was
added by them: the only database change remains the 0056 index.

## Steps
The code and the index revert independently: the app works with or without the
index (it only speeds up reads), and nothing else uses it.

1. **Code**: delete the files under "New files" and revert the "Edited files" hunks.
2. **Schema**: remove the `@@index(... map: "idx_partida_tenant_proveedor_ingreso")` line
   (and its `///` comment) from `model Partida` in `prisma/schema.prisma`, then run `npx prisma validate`.
3. **Database** (only if the index must go): Prisma has no "down". Do NOT edit or delete an
   applied migration `0056` (its checksum is in `public._prisma_migrations`).
   - Check the numbering first: `ls prisma/migrations` (and ask whoever owns the migrations that
     live outside this repository, 0051-0054 at the time of writing). 0056 is this feature's
     number, so the next free one is **0057** unless something newer exists.
   - Create a NEW forward migration
     `prisma/migrations/<timestamp later than every existing one>_0057_revert_trayectoria_proveedor_indices/migration.sql`
     whose body is `prisma/rollbacks/0056_trayectoria_proveedor_indices.down.sql`, with a header
     comment pointing to 0056, and apply it with the normal flow (`npm run db:migrate`).
     The statement is `DROP INDEX IF EXISTS`: safe to re-run.
4. **Verify**: `npm run typecheck`, `npm test`, `npx prisma validate`.
5. **If 0056 was never applied** to an environment: just delete the 0056 directory and the
   rollback SQL; nothing to revert in that database.

## Nothing to undo
- No permiso, role, parameter or seed row was added: the view reuses `proveedores.gestionar`,
  `stock.valorizado.ver`, `stock.ver`, `preparaciones.iniciar`, `libro.ver` and `auditoria.ver`.
- No data is written by the feature (reads are not audited, by project convention).
- No receta / paciente data is read by the view, so there is nothing to restore for the
  receta física columns that another developer's migration dropped from the shared database.

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
- `modules/proveedores/ui/trayectoria-partida-card.tsx`
- `app/(app)/proveedores/[id]/layout.tsx` (back link + Datos/Trayectoria tabs + uuid guard)
- `app/(app)/proveedores/[id]/trayectoria/page.tsx`
- `shared/format/monto.ts` (`formatearMonto`, moved out of pacientes, and `formatearCostoUnitario`; see the "Shared formatter" note below before deleting it)
- `tests/unit/proveedores-trayectoria.test.ts`
- `tests/unit/proveedores-trayectoria-repository.test.ts`
- `prisma/migrations/20261001130000_0056_trayectoria_proveedor_indices/` (only if 0056 was **never applied** anywhere: see step 3)
- `prisma/rollbacks/0056_trayectoria_proveedor_indices.down.sql` and this file, once the revert is done (optional: keeping them is harmless)

### Edited files (revert only the Trayectoria hunks)
- `app/(app)/proveedores/page.tsx`: the "Trayectoria" action column (an extra `<th>` with `sr-only` "Acciones", `colSpan` 3 -> 4 in the empty row, and the `<td>` with the `Link` to `/proveedores/${id}/trayectoria`). **This file is untracked** (it is the moved copy of `app/(app)/catalogos/proveedores/page.tsx` at HEAD), so there is no HEAD version of it to `git checkout`: remove those three hunks by hand.
- `app/(app)/proveedores/[id]/page.tsx`: the "Volver al listado" link block and its `import Link from "next/link"` moved to `[id]/layout.tsx`. **Untracked as well**: re-add the `Link` import and the `<div className="mb-2"> ... ← Volver al listado ... </div>` block above the `<h1>` by hand (and update the file's doc comment).
- `shared/ui/status-badge.tsx`: tones for `POR_VENCER` (warn), `AGOTADA` (neutral) and `ABIERTA` (neutral) in `TONE_BY_ESTADO`. Labels are not touched (the badge humanizes unknown estados). The file uses CRLF line endings: keep them.
- `modules/pacientes/domain/trayectoria.ts`: the `formatearMonto` function was **removed** (moved to `shared/format/monto.ts`).
- `modules/pacientes/ui/trayectoria-receta-card.tsx`: `formatearMonto` is now imported from `@/shared/format/monto` instead of `../domain/trayectoria`.
- `tests/unit/pacientes-trayectoria.test.ts`: the `formatearMonto` import now points to `@/shared/format/monto`.
- `tests/unit/proveedores-authorization-matrix.test.ts`: the `get-trayectoria-proveedor` import, the `proveedores.trayectoria` case in `CASES`, and the last `describe` block.

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

# Rollback: Trayectoria del paciente (and the Pacientes move out of Catálogos)

Spec: `docs/specs/trayectoria-paciente.md`. Two changes ship in the same
working tree. They are **independent**, so there are two rollbacks:

- **A. Trayectoria alone** (new tab, use case, indexes): the feature is
  read-only; no data, column, constraint or permiso changes. Its only database
  change is three additive indexes (migration 0051). After A, Pacientes still
  lives at `/pacientes` (its own sidebar entry), just without the tab.
- **B. Pacientes moved out of Catálogos** (`/catalogos/pacientes` ->
  `/pacientes`). Undo it only if the move itself must go. B can be done without
  A and vice versa, but if you undo B while keeping A, A's files must be
  relocated under `/catalogos/pacientes` (not recommended: do A first, or both).

---

## A. Trayectoria

### What it changed

#### Database
| File | Change |
|---|---|
| `prisma/migrations/20261001100000_0051_trayectoria_paciente_indices/migration.sql` | `idx_receta_tenant_paciente_ingreso` on `fsj.receta (tenant_id, paciente_id, fecha_ingreso DESC)`; `idx_item_receta_tenant_receta` on `fsj.item_receta (tenant_id, receta_id)`; `idx_preparacion_tenant_item_receta` on `fsj.preparacion (tenant_id, item_receta_id)` |
| `prisma/rollbacks/0051_trayectoria_paciente_indices.down.sql` | `DROP INDEX IF EXISTS` for exactly those three |
| `prisma/schema.prisma` | 3 `@@index(..., map: ...)` lines, one in each of `Receta`, `ItemReceta`, `Preparacion` |

#### New files (delete on rollback)
- `modules/pacientes/domain/trayectoria.ts`
- `modules/pacientes/infrastructure/trayectoria-repository.ts`
- `modules/pacientes/application/get-trayectoria-paciente.ts` (use case `pacientes.trayectoria`)
- `modules/pacientes/ui/trayectoria-encabezado.tsx`
- `modules/pacientes/ui/trayectoria-resumen.tsx`
- `modules/pacientes/ui/trayectoria-pasos.tsx`
- `modules/pacientes/ui/trayectoria-receta-fila.tsx`
- `shared/ui/fila-desplegable.tsx` (shared with the Proveedores Trayectoria; delete only if that one is reverted too. Do NOT delete it while the Comparador de costos uses it: see `docs/rollbacks/comparador-costos.md`)
- `app/(app)/pacientes/[id]/layout.tsx` (tabs + back link + id guard)
- `app/(app)/pacientes/[id]/trayectoria/page.tsx`
- `tests/unit/pacientes-trayectoria.test.ts`
- `tests/unit/pacientes-trayectoria-repository.test.ts`
- `prisma/rollbacks/0051_trayectoria_paciente_indices.down.sql` and this file, once the revert is done (optional: keeping them is harmless)

#### Edited files (revert only the Trayectoria hunks)
- `app/(app)/section-tabs.tsx`: `isActive` honors `link.exact`.
- `app/(app)/nav-sections.ts`: optional `exact?: boolean` on `SectionLink`, and `visible()` passing `exact` through.
- `app/(app)/pacientes/[id]/page.tsx`: the "Volver al listado" link and its `Link` import moved to `[id]/layout.tsx`, plus the `uuid` guard (`notFound()` on a malformed id). **This file is untracked** (it is the moved copy of `app/(app)/catalogos/pacientes/[id]/page.tsx` at HEAD), so there is no HEAD version of it to `git checkout`: re-add the back link + `Link` import by hand and drop the guard (or, for rollback B, restore the HEAD original as described there).
- `modules/pacientes/ui/pacientes-buscador.tsx`: the "Trayectoria" button column (header cell, `colSpan` 3 -> 4, row cell). The file is tracked, but it also carries move hunks (B), so revert by hunk, not with a whole-file checkout.
- `shared/ui/status-badge.tsx`: tones for `CONFIRMADA`, `DESCARTADA`, `SIN_EFECTO`.
- `tests/unit/pacientes-authorization-matrix.test.ts`: the `get-trayectoria-paciente` import, the `pacientes.trayectoria` case and the last `describe` block.

#### Note: receta física
Trayectoria never reads or shows receta física (dropped from the shared DB by
another developer's migration `20261001090000_0051_drop_receta_fisica`, not
part of this repo; see the spec). There is nothing to restore for it when
rolling this feature back. Both migrations carry the number 0051 (different
timestamps, so Prisma orders them by timestamp); that is only a label clash.

### Steps
The code and the indexes revert independently: the app works with or without
the indexes (they only speed up reads), and nothing else uses them.

1. **Code**: delete the files under "New files" and revert the "Edited files" hunks.
2. **Schema**: remove the three `@@index(... map: "idx_receta_tenant_paciente_ingreso" / "idx_item_receta_tenant_receta" / "idx_preparacion_tenant_item_receta")`
   lines (and their `///` comments) from `prisma/schema.prisma`, then `npx prisma validate`.
3. **Database** (only if the indexes must go): Prisma has no "down". Do NOT edit or
   delete an applied migration `0051` (its checksum is in `public._prisma_migrations`).
   Create a NEW forward migration
   `prisma/migrations/<timestamp>_<next free number>_revert_trayectoria_paciente_indices/migration.sql`
   whose body is `prisma/rollbacks/0051_trayectoria_paciente_indices.down.sql`, with a
   header comment pointing to 0051, and apply it with the normal flow (`npm run db:migrate`).
   The statements are `DROP INDEX IF EXISTS`: safe to re-run.
4. **Verify**: `npm run typecheck`, `npm test`, `npx prisma validate`.
5. **If 0051 was never applied** to an environment: just delete the 0051 directory
   and the rollback SQL; nothing to revert in that database.

---

## B. Pacientes moved out of Catálogos

Pure UI/routing move; no database, permiso or use-case change (the use cases keep
their names and `pacientes.gestionar`). Restore from HEAD where tracked.

### What it changed
- `next.config.ts`: redirect `/catalogos/pacientes/:path*` -> `/pacientes/:path*` (`permanent: false`, 307, so browsers do not cache it).
- Sidebar: `app/(app)/sidebar-nav.tsx` (`puedePacientes` prop + "Gestión › Pacientes" entry) and `app/(app)/layout.tsx` (passes `puedePacientes: can(session, "pacientes.gestionar")`).
- `app/(app)/nav-sections.ts`: the "Pacientes" tab removed from `catalogosSections` (and the doc comment now saying so).
- Pages: `app/(app)/catalogos/pacientes/{layout,page}.tsx` and `[id]/page.tsx` **deleted** (tracked at HEAD); recreated as `app/(app)/pacientes/{layout,page}.tsx` and `[id]/page.tsx` (untracked).
- `modules/pacientes/ui/*` and `application/*`, `infrastructure/paciente-repository.ts`: `revalidatePath("/catalogos/pacientes")` -> `revalidatePath("/pacientes")` (4 places in `ui/actions.ts`), the row/detail hrefs in `pacientes-buscador.tsx`, and path mentions in doc comments (`get-paciente.ts`, `list-pacientes.ts`, `paciente-repository.ts`, `action-state.ts`, `buscar-pacientes-action.ts`, `paciente-form.tsx`).
- Comment tweaks in `app/(app)/catalogos/layout.tsx` (FASE 4 points 4.1-4.4, "médicos" only).

### Steps (only if the move itself must be undone; do A first)
1. `git checkout HEAD -- "app/(app)/catalogos/pacientes"` restores the three deleted pages (`layout.tsx`, `page.tsx`, `[id]/page.tsx`).
2. Delete the untracked `app/(app)/pacientes/{layout,page}.tsx` and `[id]/page.tsx` (after A, `[id]/layout.tsx` and `[id]/trayectoria/` are already gone).
3. `git checkout HEAD -- next.config.ts "app/(app)/layout.tsx" "app/(app)/sidebar-nav.tsx" "app/(app)/catalogos/layout.tsx" modules/pacientes/application modules/pacientes/infrastructure modules/pacientes/ui/action-state.ts modules/pacientes/ui/actions.ts modules/pacientes/ui/buscar-pacientes-action.ts modules/pacientes/ui/paciente-form.tsx modules/pacientes/ui/pacientes-buscador.tsx`
   (this also reverts the Trayectoria button in `pacientes-buscador.tsx`, which is correct once A is done).
4. `app/(app)/nav-sections.ts`: restore `{ href: "/catalogos/pacientes", label: "Pacientes", visible: can(session, "pacientes.gestionar") }` in `catalogosSections` and the original doc comment (the `exact` field is A's; remove it as part of A).
5. Verify: `npm run typecheck`, `npm test`. Because the redirect is a 307, no browser keeps sending users to `/pacientes` after the revert.

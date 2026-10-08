# Rollback: Pago de la receta (`receta.pagada`, `pagada_en`, `pagada_por_id`)

Spec: `docs/specs/pago-receta.md`. One database change (migration 0071: three columns, a CHECK, a FK, a
trigger/function for INV-R13 and the INV-U07 triggers recreated with one more column) and the code that reads
and writes them: alta (manual and PDF/QR import), entrega, the receta detail, the `/recetas` listado and its CSV.

**Order matters.** Roll back the **code first**, the database second. While this code is live, dropping the
columns breaks every Prisma read of `fsj.receta` that selects all its scalars (the detail, edit and
`include`-based reads) and the alta/entrega commands with "column does not exist". The reverse holds for the
forward direction: **APPLY 0071 BEFORE deploying this code.**

> **Data loss.** Dropping the columns discards which recetas were paid, by whom and when. The values survive
> only in `fsj.registro_auditoria` (`valor_anterior` / `valor_nuevo`, key `pagada`: `receta` CREAR / MODIFICAR
> entries, and `entrega` entries).

## What it changed

### Database
| File | Change |
|---|---|
| `prisma/migrations/20261008090000_0071_receta_pagada/migration.sql` | `ALTER TABLE fsj.receta ADD COLUMN pagada boolean NOT NULL DEFAULT false, pagada_en timestamptz, pagada_por_id uuid`; FK `receta_pagada_por_fkey` and CHECK `receta_pagada_check`; `GRANT UPDATE (pagada, pagada_en, pagada_por_id) ON fsj.receta TO fsj_app` (UPDATE on `receta` is granted per column); `COMMENT ON COLUMN`s; function `fsj.receta_validar_pago_no_anulada()` + trigger `trg_receta_validar_pago_no_anulada` (INV-R13); `trg_receta_zz_inv_u07_insert` / `trg_receta_zz_inv_u07_update` recreated with `pagada_por_id` added. No index, no RLS change. |
| `prisma/rollbacks/0071_receta_pagada.down.sql` | restores the two INV-U07 triggers' original arguments, drops INV-R13 (trigger + function), guarded `REVOKE UPDATE (...)`, drops the constraints and the columns |
| `prisma/schema.prisma` | three fields in `model Receta` (`pagada`, `pagadaEn`, `pagadaPorId`) + the `pagadaPor` relation, and `recetasPagadas` in `model Usuario` (with their `///` comments) |

### New files (delete on rollback)
- the migration directory and the down script above (see step 3 for when)
- `modules/recetas/domain/pago.ts`
- `modules/recetas/application/marcar-pago-receta.ts`
- `modules/recetas/ui/pago-receta-form.tsx`
- `docs/specs/pago-receta.md`, and this file once the revert is done (optional)

### Edited files (revert only these hunks)
- `modules/recetas/application/crear-receta.ts`, `importar-receta.ts`: the `pagada` input field, the argument to `insertRecetaConItems` and the audit key.
- `modules/recetas/application/editar-receta.ts`: `pagada: true` in the `.omit(...)` of `editarRecetaInput` (and its comment).
- `modules/recetas/application/list-recetas.ts`, `reporte-recetas.ts`: the `pago` input, its pass-through, the `FILTRO_PAGO_RECETA_LABELS` import, the audit filter summary line and `pagada` in `ExportarRecetasResultado`.
- `modules/recetas/infrastructure/receta-repository.ts`: `pagada` in `NuevaRecetaInput` + `insertRecetaConItems`; `pagada` / `pagadaEn` / `pagadaPorNombre` / `zonaHoraria` in `RecetaDetalle` and `getRecetaConItems` (including `pagadaPor` in the `include`); `pago` in `ListRecetasFilter` and `buildWhere`; `pagada` in `RecetaListadoItem` and `listRecetas`; the whole "Pago" section (`PagoDeReceta`, `getPagoDeReceta`, `setPagoDeReceta`).
- `modules/recetas/ui/receta-form.tsx`: the `pagada` state, the checkbox in the Resumen panel and `pagada` in `payloadImportacion`.
- `modules/recetas/ui/actions.ts`: `pagada` in `crearRecetaAction`, `marcarPagoRecetaAction` and its import.
- `modules/recetas/ui/recetas-table.tsx`: `RecetaRow.pagada`, the "Pago" column, the phone badge and `PagoBadge`.
- `app/(app)/recetas/page.tsx`: the `pago` param, filter, chip, row field and the `activeDrawerFilters` count (back to `activeDateFilters`).
- `app/(app)/recetas/[id]/page.tsx`: the header badge and the "Pago" panel.
- `app/api/recetas/reporte/export/csv/route.ts`: the `pago` param and the `Pago` column.
- `modules/entregas/application/registrar-entrega.ts`, `get-entrega-estado.ts`, `modules/entregas/infrastructure/entrega-repository.ts` (`pagada` in `RecetaParaEntrega`, `marcarRecetaPagada`), `modules/entregas/ui/actions.ts`, `entrega-acciones.tsx`, `registrar-entrega-form.tsx`, and the two `/entregas/[recetaId]` pages (`pagada` prop).
- `shared/errors/mensajes-invariantes.ts`: the `INV-R13` entry (the scan in `tests/unit/mensajes-invariantes-global.test.ts` only requires entries for codes the migrations raise, so remove it together with the migration).
- `shared/labels/field-labels.ts`: the `pagada` entry (`tests/unit/usecase-registry-all-modules.test.ts` fails if an input key has no label, not the other way round).
- `docs/specs/libro-recetario-y-contralor.md` and `modules/README.md`: the one-line pointers to `pago-receta`.

## Steps

1. **Code** (first): revert the "Edited files" hunks and delete the new files.
2. **Schema**: remove the three fields and the `pagadaPor` relation from `model Receta` and `recetasPagadas` from `model Usuario`, then `npx prisma validate` and `npm run db:generate`.
3. **Database** (only after step 1 is deployed, and only if the columns must go):
   Prisma has no "down". Do NOT edit or delete an applied 0071. Create a NEW forward
   migration `prisma/migrations/<timestamp>_<next free number>_revert_receta_pagada/migration.sql`
   whose body is `prisma/rollbacks/0071_receta_pagada.down.sql`, with a header comment
   pointing to 0071, and apply it with the normal flow. Check which number is free first.
   Leaving the columns in place is harmless once the code no longer uses them (the flag has a
   default and the other two are nullable); only INV-R13 and the extended INV-U07 triggers would
   keep acting on them.
4. **If 0071 was never applied** to an environment: just delete the 0071 directory and the down script.
5. **Verify**: `npm run typecheck`, `npm test`, `npx prisma validate`.

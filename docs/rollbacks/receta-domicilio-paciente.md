# Rollback: Domicilio del paciente per receta (`receta.domicilio_paciente`)

Spec: `docs/specs/importacion-receta-pdf.md`, "Domicilio del paciente". One database
change (migration 0070: a nullable text column on `fsj.receta`) and the code that
reads and writes it: manual alta, edit, PDF import (the first `- …` line after
`Rp./`), the receta detail and the `/preparaciones` toma workspace.

**Order matters.** Roll back the **code first**, the database second. While this
code is live, dropping the column breaks every Prisma read of `fsj.receta` that
selects all its scalars (the receta detail, edit and `include`-based reads) and the
create/edit/import commands with "column does not exist". The reverse holds for the
forward direction: **APPLY 0070 BEFORE deploying this code.**

> **Data loss.** Dropping the column discards every stored domicilio. The values
> survive only in `fsj.registro_auditoria` (`valor_nuevo` / `valor_anterior` of
> `receta` CREAR / MODIFICAR entries, key `domicilioPaciente`).

## What it changed

### Database
| File | Change |
|---|---|
| `prisma/migrations/20261007210000_0070_receta_domicilio_paciente/migration.sql` | `ALTER TABLE fsj.receta ADD COLUMN IF NOT EXISTS domicilio_paciente text`, `GRANT UPDATE (domicilio_paciente) ON fsj.receta TO fsj_app` (UPDATE on `receta` is granted per column), its `COMMENT ON COLUMN`. No trigger, RLS or CHECK change. |
| `prisma/rollbacks/0070_receta_domicilio_paciente.down.sql` | guarded `REVOKE UPDATE (...)`, then `DROP COLUMN IF EXISTS` |
| `prisma/schema.prisma` | one field in `model Receta`: `domicilioPaciente String? @map("domicilio_paciente")` (+ its `///` comment) |

### New files (delete on rollback)
- the migration directory and the down script above (see step 3 for when)
- this file, once the revert is done (optional)

### Edited files (revert only these hunks)
- `modules/recetas/domain/receta.ts`: `MAX_DOMICILIO_PACIENTE` and `domicilioPacienteOpcional`.
- `modules/recetas/domain/receta-pdf-parser.ts`: `BorradorReceta.domicilioPaciente`, the `MAX_DOMICILIO_PACIENTE` import, `RE_GUION_INICIAL` + `domicilioDesdeRenglon`, and the "- " first-line rule capturing the text (back to just dropping the line: `parsearCuerpo(/^-\s/.test(lineas[0] ?? "") ? lineas.slice(1) : lineas)`).
- `modules/recetas/domain/receta-rcta-json.ts`: `mapearItem`'s domicilio branch and its `{ item, domicilioPaciente }` return (back to returning the item, so that line is an informational notice again), and `domicilioPaciente` in the QR borrador.
- `modules/recetas/application/crear-receta.ts`, `editar-receta.ts`, `importar-receta.ts`: the `domicilioPaciente` input field (and in `version` for the edit, plus its clause in `versionMatches`), the argument to `insertRecetaConItems` / `updateRecetaHeader`, and the audit keys.
- `modules/recetas/infrastructure/receta-repository.ts`: `domicilioPaciente` in `NuevaRecetaInput` + `insertRecetaConItems`, `RecetaParaAccion` + `SELECT_PARA_ACCION`, `RecetaDetalle` + `getRecetaConItems`, `EditarRecetaHeaderInput`, `EditarRecetaHeaderVersion` and both the `where` and `data` of `updateRecetaHeader`.
- `modules/preparaciones/infrastructure/preparacion-repository.ts`: `domicilioPaciente` in `RecetaDeToma` and `getRecetaDeToma`.
- `modules/recetas/ui/receta-form.tsx`: `RecetaFormInicial.domicilioPaciente`, the state, `domicilioPacienteId`, `campoDomicilioPaciente` and its two placements (pickers grid, imported paciente panel), the hidden `versionDomicilioPaciente` / `domicilioPaciente` inputs, and the key in `encabezadoSinGuardar`, `restablecer` and `payloadImportacion`.
- `modules/recetas/ui/receta-form-inicial.ts`: the `domicilioPaciente` line.
- `modules/recetas/ui/actions.ts`: `domicilioPaciente` in `crearRecetaAction` and `editarRecetaAction` (and `versionDomicilioPaciente`).
- `app/(app)/recetas/[id]/page.tsx` and `app/(app)/preparaciones/recetas/[recetaId]/page.tsx`: the "Domicilio:" line under the paciente.
- `shared/labels/field-labels.ts`: the `domicilioPaciente` entry (`tests/unit/usecase-registry-all-modules.test.ts` fails if an input key has no label, not the other way round).
- `docs/specs/importacion-receta-pdf.md`: the "Domicilio del paciente" section, the header-table row, the body rule (back to "Ignorado"), confirmation step 2, P1 and the 0070 note.
- `tests/unit/receta-pdf-parser.test.ts`: the domicilio assertions in P1, P3 and the "PDF flow" test.
- `tests/unit/receta-rcta-json.test.ts`: the "bulleted first leading line" test (back to expecting the informational notice).
- `docs/specs/importacion-receta-qr.md`: the "Domicilio del paciente" bullet and the P40–P45 note.
- `tests/unit/recetas-m3-lock-order.test.ts`: `domicilioPaciente: null` in the `recetaPendiente` fixture.

## Steps

1. **Code** (first): revert the "Edited files" hunks.
2. **Schema**: remove the `domicilioPaciente` field (and its `///` comment) from
   `model Receta`, then `npx prisma validate` and `npm run db:generate`.
3. **Database** (only after step 1 is deployed, and only if the column must go):
   Prisma has no "down". Do NOT edit or delete an applied 0070. Create a NEW forward
   migration `prisma/migrations/<timestamp>_<next free number>_revert_receta_domicilio_paciente/migration.sql`
   whose body is `prisma/rollbacks/0070_receta_domicilio_paciente.down.sql`, with a
   header comment pointing to 0070, and apply it with the normal flow. Check which
   number is free first. The script is guarded, so it is safe to re-run. Leaving the
   column in place is harmless once the code no longer uses it (nullable, no default
   needed).
4. **If 0070 was never applied** to an environment: just delete the 0070 directory and
   the down script.
5. **Verify**: `npm run typecheck`, `npm test`, `npx prisma validate`.

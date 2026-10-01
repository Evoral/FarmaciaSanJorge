# Rollback: Pacientes recurrentes (consent column + `/pacientes/recurrentes`)

Spec: `docs/specs/pacientes-recurrentes.md`. One database change (migration 0055:
a consent column on `fsj.paciente`) and the code that reads it. Everything else is
read-only UI over existing recetas.

**Order matters.** Roll back the **code first**, the database second. While this
code is live, dropping the column breaks `/pacientes/[id]`, create and edit
paciente (and baja/reactivación), `/pacientes/recurrentes` and every
`paciente.create` (including the receta quick-create and the PDF import, because
Prisma sends the defaulted column) with "column does not exist". The `/pacientes`
list is not affected (explicit select). The reverse holds for the forward
direction: **APPLY 0055 BEFORE deploying this code.**

> **Data loss.** Dropping the column discards every stored consent value. After the
> rollback nobody has a recorded WhatsApp opt-in, and re-applying 0055 would bring
> everyone back as `false`. The values survive only in `fsj.registro_auditoria`
> (`valor_anterior` / `valor_nuevo` of `paciente` CREAR / MODIFICAR entries).

## What it changed

### Database
| File | Change |
|---|---|
| `prisma/migrations/20261001120000_0055_paciente_recordatorios_whatsapp/migration.sql` | `ALTER TABLE fsj.paciente ADD COLUMN IF NOT EXISTS acepta_recordatorios_whatsapp boolean NOT NULL DEFAULT false`, its `COMMENT ON COLUMN`, and `GRANT UPDATE (acepta_recordatorios_whatsapp) ON fsj.paciente TO fsj_app` (UPDATE on `paciente` is granted per column, migrations 0007/0029; SELECT/INSERT come from the default privileges of migration 0000) |
| `prisma/rollbacks/0055_paciente_recordatorios_whatsapp.down.sql` | guarded `REVOKE UPDATE (...)`, then `ALTER TABLE ... DROP COLUMN IF EXISTS` |
| `prisma/schema.prisma` | one field in `model Paciente`: `aceptaRecordatoriosWhatsapp Boolean @default(false) @map("acepta_recordatorios_whatsapp")` |

Numbering: this repository has its own
`20261001100000_0051_trayectoria_paciente_indices`. The other developer's
migrations are not in this repository: `20261001090000_0051_drop_receta_fisica`,
`0052_regla_precio_tramos`, `0053` and `20261001110100_0054`. 0055 is the next
free number after those, and its timestamp sorts after theirs.

### New files (delete on rollback)
- `modules/pacientes/domain/recurrentes.ts`
- `modules/pacientes/infrastructure/recurrentes-repository.ts`
- `modules/pacientes/application/list-pacientes-recurrentes.ts` (use case `pacientes.recurrentes`)
- `modules/pacientes/ui/recurrentes-tabla.tsx`
- `app/(app)/pacientes/recurrentes/page.tsx`
- `app/(app)/pacientes/pacientes-tabs.tsx` (the "Todos | Recurrentes" tabs)
- `tests/unit/pacientes-recurrentes.test.ts`
- `tests/unit/pacientes-recurrentes-repository.test.ts`
- `tests/unit/pacientes-recurrentes-usecase.test.ts`
- `tests/unit/pacientes-consentimiento-whatsapp.test.ts`
- `tests/unit/pacientes-actions-consentimiento.test.ts`
- `prisma/migrations/20261001120000_0055_paciente_recordatorios_whatsapp/` and `prisma/rollbacks/0055_paciente_recordatorios_whatsapp.down.sql` (see step 3 for when)
- this file, once the revert is done (optional: keeping it is harmless)

### Edited files (revert only these hunks)
- `modules/pacientes/application/crear-paciente.ts`: `crearPacienteConConsentimientoInput` (+ its two types), `crearPacienteHandler` reduced to a wrapper that stores `false`, the private `crearPacienteConConsentimiento` and its `aceptaRecordatoriosWhatsapp` argument to `insertPaciente`, the same key in the audit `valorNuevo`, and `pacientes.crear` pointing at the consent schema. Reverting means: `crearPacienteCommand` uses `crearPacienteInput` and `crearPacienteHandler` again as the single handler. `crear-paciente-desde-receta.ts` and `recetas/application/importar-receta.ts` are unchanged.
- `modules/pacientes/application/editar-paciente.ts`: the top-level `aceptaRecordatoriosWhatsapp: z.boolean()` input field, the one in `version`, the extra clause in `versionMatches`, and the key in `nuevoValor` and `valorAnterior` (hence in the audit diff).
- `modules/pacientes/infrastructure/paciente-repository.ts`: `aceptaRecordatoriosWhatsapp` in `PacienteParaAccion`, `SELECT_PARA_ACCION`, `NuevoPacienteInput` + `insertPaciente`, `EditarPacienteInput`, `EditarPacienteVersion` and both the `where` and the `data` of `updatePacienteDatos`.
- `modules/pacientes/ui/actions.ts`: the `checkbox()` and `versionBoolean()` helpers, the `aceptaRecordatoriosWhatsapp` key in `crearPacienteAction` and `editarPacienteAction`, the `version` key `versionAceptaRecordatoriosWhatsapp`, and the extra `revalidatePath("/pacientes/recurrentes")`.
- `modules/pacientes/ui/paciente-form.tsx`: the `aceptaRecordatoriosWhatsapp` prop field, the hidden `versionAceptaRecordatoriosWhatsapp` input and the "Acepta recordatorios por WhatsApp" checkbox block.
- `app/(app)/pacientes/[id]/page.tsx`: the `aceptaRecordatoriosWhatsapp: paciente.aceptaRecordatoriosWhatsapp` line passed to `PacienteForm`. **Untracked file** (it is the moved copy of the old `/catalogos/pacientes/[id]/page.tsx`), so there is no HEAD version to check out: delete the line by hand.
- `app/(app)/pacientes/page.tsx`: the `PacientesTabs` import and its `<PacientesTabs />` element. **Untracked file** (same reason): by hand.
- `shared/labels/field-labels.ts`: the `aceptaRecordatoriosWhatsapp` and `ventana` entries. Revert them together with the code; `tests/unit/usecase-registry-all-modules.test.ts` fails if an input key has a label missing, but not if a label has no input.
- `tests/unit/pacientes-authorization-matrix.test.ts`: the `list-pacientes-recurrentes` import, the `pacientes.recurrentes` case, and the `aceptaRecordatoriosWhatsapp` keys in the `pacientes.editar` input and its `version`.
- `tests/unit/medicos-pacientes-m3-concurrencia.test.ts`: `aceptaRecordatoriosWhatsapp: false` in the `vigente` fixture, in the two `editarPaciente` inputs of the pacientes block, and in their `version` objects.

`app/(app)/pacientes/[id]/layout.tsx`, `section-tabs.tsx`, `nav-sections.ts`, the sidebar
and `status-badge.tsx` were NOT touched by this feature.

## Steps

1. **Code** (first): delete the files under "New files" that are code or tests, and
   revert the "Edited files" hunks.
2. **Schema**: remove the `aceptaRecordatoriosWhatsapp` field (and its `///` comment)
   from `model Paciente` in `prisma/schema.prisma`, then `npx prisma validate` and
   `npx prisma generate`.
3. **Database** (only after step 1 is deployed, and only if the column must go):
   Prisma has no "down". Do NOT edit or delete an applied migration 0055 (its checksum
   is in `public._prisma_migrations`). Create a NEW forward migration
   `prisma/migrations/<timestamp>_<next free number>_revert_paciente_recordatorios_whatsapp/migration.sql`
   whose body is `prisma/rollbacks/0055_paciente_recordatorios_whatsapp.down.sql`, with a
   header comment pointing to 0055, and apply it with the normal flow
   (`npm run db:migrate`). **Check which number is free first**: 0056 may already be
   taken by the other developer's work. The script is guarded (`REVOKE` only if the
   column exists, `DROP COLUMN IF EXISTS`), so it is safe to re-run.
   Leaving the column in place is harmless once the code no longer uses it: it is
   `NOT NULL DEFAULT false`, so inserts that omit it keep working.
4. **If 0055 was never applied** to an environment: just delete the 0055 directory and
   the down script; there is nothing to revert in that database.
5. **Verify**: `npm run typecheck`, `npm test`, `npx prisma validate`.

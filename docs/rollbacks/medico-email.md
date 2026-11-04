# Rollback: Email del médico

The feature adds an optional `email` column to `fsj.medico`, exposes it in the médico catalog (create/edit with concurrency check on `version.email`), and imports it from prescriptions (PDF footer and QR `lugarAtencion` via `leerContactoMedico`, filling empty email on existing médicos).

The feature has a **schema change** (migration `prisma/migrations/20261104120000_0118_medico_email`), so it is reverted as code + a new forward migration built from `prisma/rollbacks/0118_medico_email.down.sql`.

## What the down migration loses

- Drops the `email` column on `fsj.medico`. Any emails already loaded are permanently lost.

## Order

1. Deploy the reverted code **first**: the application stops selecting and updating `email`, running safely against the 0118 schema.
2. Copy `prisma/rollbacks/0118_medico_email.down.sql` into a NEW migration folder (next free number, a timestamp later than every existing one) and apply it forward. Never edit or delete the applied 0118 migration.
3. Regenerate Prisma client (`npm run db:generate`).
4. `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `prisma/rollbacks/0118_medico_email.down.sql` and this file (optional)
- `prisma/migrations/20261104120000_0118_medico_email/` (keep once applied)

## Edited files (revert the email hunks)

- `prisma/schema.prisma`: remove `email` from model `Medico`.
- `modules/medicos/**`:
  - `modules/medicos/application/crear-medico.ts`: remove `email` from `crearMedicoInput` and `crearMedicoHandler`.
  - `modules/medicos/application/editar-medico.ts`: remove `email` from `editarMedicoInput`, concurrency check (`version.email`), update payload and audit diff.
  - `modules/medicos/infrastructure/medico-repository.ts`: remove `email` from `MedicoParaAccion`, `SELECT_PARA_ACCION`, `NuevoMedicoInput`, `updateMedicoDatos`.
  - `modules/medicos/ui/actions.ts`: remove `email` extraction and versioning in `crearMedicoAction` and `editarMedicoAction`.
  - `modules/medicos/ui/medico-form.tsx`: remove `email` field and hidden `versionEmail` input.
- Importación de recetas:
  - `modules/recetas/domain/receta-pdf-parser.ts`: remove `email` from `BorradorMedico` and revert `leerContactoMedico` (keeping `separarContactoMedico`).
  - `modules/recetas/domain/receta-rcta-json.ts`: revert `leerContactoMedico` back to `separarContactoMedico` and remove `email` mapping.
  - `modules/recetas/domain/receta-misrx.ts`: remove `email: null` from `borradorMedico`.
  - `modules/recetas/domain/importacion-receta.ts`: remove `email` from `CAMPOS_MEDICO_IMPORTABLES` and `ETIQUETAS_CAMPOS_IMPORTABLES`.
  - `modules/recetas/application/importar-receta.ts`: remove `email` handling when completing existing médicos and creating new ones.
  - `modules/recetas/application/leer-receta-pdf.ts`: remove `email` from borrador mapping.
  - `modules/recetas/infrastructure/importacion-repository.ts`: remove `email` from medico lookup/creation/update.
  - `modules/recetas/ui/receta-form.tsx`: remove `email` references.
- Specs:
  - `openspec/specs/importacion-receta-pdf/spec.md`: revert footer contact rule, completion rule and email scenario.
  - `openspec/specs/importacion-receta-qr/spec.md`: revert `lugarAtencion` contact rule and scenario.

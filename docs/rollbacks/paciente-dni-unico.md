# Rollback: DNI único por paciente

A paciente's DNI is unique per tenant, dados de baja included, like the CUIL. The feature has a **schema change**
(migration `prisma/migrations/20261103130000_0116_paciente_dni_unico`), so it is reverted as code + a new forward
migration built from `prisma/rollbacks/0116_paciente_dni_unico.down.sql`.

## What the down migration loses

- Nothing stored. The pacientes given de baja by the one-off duplicate fix keep their baja and their cleared DNI (the
  previous DNI is in their BAJA audit row's `valor_anterior`).

## Order

1. Copy `prisma/rollbacks/0116_paciente_dni_unico.down.sql` into a NEW migration folder (next free number, a timestamp
   later than every existing one) and apply it. Never edit or delete the applied 0116 migration.
2. Deploy the reverted code (it works with or without the index).
3. `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `prisma/rollbacks/0116_paciente_dni_unico.down.sql` and this file (optional)
- `prisma/migrations/20261103130000_0116_paciente_dni_unico/` (keep it once applied)

## Edited files (revert the DNI hunks)

- `modules/pacientes/infrastructure/paciente-repository.ts`: `existeDni`, the module doc comment.
- `modules/pacientes/application/crear-paciente.ts`, `modules/pacientes/application/editar-paciente.ts`: the DNI check.

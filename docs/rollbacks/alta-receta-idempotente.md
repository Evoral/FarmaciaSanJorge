# Rollback: alta de receta idempotente (`receta.envio_id`)

Spec: `docs/specs/alta-receta-idempotente.md`. One database change (migration 0102:
nullable `envio_id uuid` on `fsj.receta` + partial unique index `uq_receta_envio`).

**Order matters.** Code first, database second: while this code is live, dropping the
column breaks every Prisma read of `fsj.receta`. Forward: **APPLY 0102 BEFORE deploying.**
No data loss beyond the keys themselves.

## Edited files (revert only these hunks)
- `prisma/schema.prisma`: `envioId` in `model Receta` (then `npm run db:generate`).
- `modules/recetas/infrastructure/receta-repository.ts`: `NuevaRecetaInput.envioId`, `buscarRecetaPorEnvio`, `envioId` in `insertRecetaConItems`.
- `modules/recetas/application/crear-receta.ts`: `envioId` input, `RecetaYaRegistradaError`, the lookup in the handler, `envioId` passed to the insert.
- `modules/recetas/application/editar-receta.ts`: `envioId: true` in the `omit`.
- `modules/recetas/ui/actions.ts`: `envioId` in `crearRecetaAction` and the `RecetaYaRegistradaError` branch.
- `modules/recetas/ui/receta-form.tsx`: the `envioId` state/effect and its hidden input.
- `shared/labels/field-labels.ts`: the `envioId` entry.

## Database
Only after the code revert is deployed: a NEW forward migration whose body is
`prisma/rollbacks/0102_receta_envio_id.down.sql` (guarded, re-runnable). Never edit an
applied 0102. If 0102 was never applied: delete its directory and the down script.

## Verify
`npm run typecheck`, `npm test`, `npx prisma validate`.

# Apply progress

## Batch 1 — Unit A (done)

Tasks A.1 to A.9 are complete. Units B, C and D are not started.

- Migration is `prisma/migrations/20261111130000_0129_libro_incidente_integridad/migration.sql`, rollback is
  `prisma/rollbacks/0129_libro_incidente_integridad.down.sql`. **Renumbered from 0128 to 0129**: the dev DB already has a
  teammate's `20261111120000_0128_consumo_linea_otra_magnitud` (not yet in the repo). References to "0128" in
  `design.md`, `tasks.md` and the docs to write in unit D must read 0129.
- Applied to the dev DB (the one in `.env`, shared with the DB tests) with `npm run db:migrate` (`prisma migrate deploy`).
- `INV-L27` added to `shared/errors/mensajes-invariantes.ts` in the same unit.
- The `p_tenant_ids` over-100 rejection uses SQLSTATE `22023` with no `INV-` token (a programming error, never shown to a user),
  so no extra message was needed.
- Concurrency ("Detecciones simultaneas") is not tested with two connections: the rolled-back harness is single-transaction.
  It is covered structurally (a test asserts the advisory lock in the function definition; the partial unique index is
  tested directly) and by review.
- Prisma client was regenerated (`npm run db:generate`); no Prisma model was added.

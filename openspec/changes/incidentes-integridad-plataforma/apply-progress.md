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

## Batch 2 -- Unit B (done)

Tasks B.1 to B.8 are complete. Units C and D are not started. Mode: Strict TDD, `size:exception` single PR.

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| B.1/B.2 resumen | `tests/unit/resumen-integridad.test.ts`: 5 of 6 failed before the change | 6/6 pass | none needed |
| B.3/B.4 command + wrapper | `tests/unit/registrar-incidentes-integridad.test.ts`: suite failed to load (module missing) | 13/13 pass | none needed |
| B.5 labels | covered by `usecase-registry-all-modules` (runs after `npm install`) | pass | -- |
| B.6 layout | no unit seam (Server Component); covered by typecheck + lint boundaries | pass | -- |

### Decisions
- `VerificacionLibro` (domain, `{libroId, tipo, quiebre}`) is a different shape from the existing
  `VerificacionLibro` in `verificar-cadena-libros.ts` (`ok`, `primerQuiebreNumero`); they live in different files and do not clash.
- The command output is `{ tenantId, abiertos: [{libroId, quiebre, incidenteId}] }`; the wrapper maps `libroId` back to `tipo` for the log
  (the command input has no tipo, per design D5).
- The wrapper skips the call (no transaction) for an empty verification.
- B.7: no new DB test; `tests/db/libro-incidente-integridad.test.ts` (A.1) already exercises `fsj.libro_incidente_registrar`, the exact SQL the repository calls.

### Verification
`npm run typecheck` clean; `npm run lint` 0 errors (291 pre-existing warnings); `npm test` 252 files / 4176 tests pass
(after `npm install`, which installed `@google/genai`; the 3 previously unloadable files now run);
`FSJ_DB_TESTS=yes vitest --project db tests/db/libro-incidente-integridad.test.ts` 13/13 pass.
Not run: full `test:db`, `build`, manual UI.

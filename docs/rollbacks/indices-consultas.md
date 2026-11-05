# Rollback: Indexes for parent-to-child queries

The change (security audit P1-10) adds nine indexes for the queries that read a child row by its parent: the pending asientos (layout banner, cierre), a day's asientos, movimientos by línea de pesaje and by preparación, recetas by médico and by lote de archivo, a usuario's active sessions and elaboraciones by fórmula. The full list and the query behind each one are in the migration header.

It has a **schema change** (migration `prisma/migrations/20261105120000_0121_indices_consultas`) and **no code change**, so it is reverted as a new forward migration built from `prisma/rollbacks/0121_indices_consultas.down.sql`.

## What the down migration loses

- No data. The queries go back to scanning the tenant's rows, which is only noticeable once the tables are large.

## Order

1. Copy `prisma/rollbacks/0121_indices_consultas.down.sql` into a NEW migration folder (next free number, a timestamp later than every existing one) and apply it forward. Never edit or delete the applied 0121 migration.
2. Remove the three `@@index` entries from `prisma/schema.prisma` and regenerate the Prisma client (`npm run db:generate`). Order with step 1 does not matter: Prisma does not read indexes at runtime.

## New files (delete on rollback)

- `prisma/rollbacks/0121_indices_consultas.down.sql` and this file (optional)
- `prisma/migrations/20261105120000_0121_indices_consultas/` (keep once applied)

## Edited files (revert)

- `prisma/schema.prisma`: `idx_receta_tenant_medico` and `idx_receta_tenant_lote_archivo` on `Receta`, `idx_asiento_recetario_tenant_fecha` on `AsientoRecetario`.
- `docs/auditoria/informes/parte-6.md`: P1-10 back to open.

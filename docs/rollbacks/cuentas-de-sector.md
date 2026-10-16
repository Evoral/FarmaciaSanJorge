# Rollback: Cuentas de sector e identificación del empleado por PIN

Spec: `docs/specs/cuentas-de-sector.md`. The feature has a **schema change**
(migration `prisma/migrations/20261013150000_0077_cuentas_de_sector`), so it
is reverted as code + a new forward migration built from
`prisma/rollbacks/0077_cuentas_de_sector.down.sql`.

## What the down migration changes

- Drops `fsj.accion_con_pin`, `fsj.seed_acciones_con_pin` and the tenant
  trigger that seeds it: each farmacia's "pide PIN" configuration is lost.
- Drops INV-SEC-001 / INV-SEC-002 and `fsj.usuario.es_sector`: which usuarios
  were cuentas de sector is lost. They become ordinary usuarios.
- Restores migration 0054's role template for NEW tenants (without
  `LABORATORIO`). Existing `LABORATORIO` roles stay: they are ordinary roles,
  possibly assigned; delete them from the role editor if unwanted.

What is **not** lost: every act already attributed to an empleado keeps its
author, in the domain columns and in `registro_auditoria` (including
`contexto.terminal`). PINs are untouched (migration 0037).

## Before you start

**Suspend every cuenta de sector** from Usuarios y accesos › Usuarios. Without
the feature, anything done from their shared sessions would be attributed to
the shared account with no PIN at all. The down migration refuses to run
while an `ACTIVO` cuenta de sector exists.

## Order

1. Suspend the cuentas de sector (above).
2. Revert the code (the commit that introduced this change). The reverted code
   no longer reads `usuario.es_sector` nor `fsj.accion_con_pin`, and works with
   the columns still present.
3. Apply the down migration: copy
   `prisma/rollbacks/0077_cuentas_de_sector.down.sql` into a NEW migration
   folder (next free number, a timestamp later than every existing one) and
   apply it with `npm run db:migrate`. Never edit or delete the applied 0077
   migration. Doing this BEFORE step 2 would break every session: the current
   code selects `es_sector` when it loads one.
4. `npm run db:generate`, `npm run typecheck`, `npm run lint`, `npm test`.

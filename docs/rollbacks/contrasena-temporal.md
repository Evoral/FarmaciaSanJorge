# Rollback: Contraseña temporal

Spec: `docs/specs/contrasena-temporal.md`. The feature has a **schema change** (migration
`prisma/migrations/20261022100000_0097_contrasena_temporal`), so it is reverted as code + a new
forward migration built from `prisma/rollbacks/0097_contrasena_temporal.down.sql`.

## What the down migration loses

- `usuario.debe_cambiar_password`: which usuarios still had a temporary password pending to
  change. After the rollback they keep that password as an ordinary one.
- Not reversible: the `credencial_activacion` rows 0097 revoked. INV-AU-002 forbids changing
  `revocada_en` once set. A usuario that still needs an activation link gets a new one from the
  old code's "Restablecer credencial".

## Order

1. Deploy the reverted code **first**: it neither reads nor writes `debe_cambiar_password`, and
   the column has a default, so it runs fine against the 0097 schema.
2. Copy `prisma/rollbacks/0097_contrasena_temporal.down.sql` into a NEW migration folder (next
   free number, a timestamp later than every existing one) and apply it. Never edit or delete the
   applied 0097 migration.
3. Revert the code (below), `npm run db:generate`, then `npm run typecheck`, `npm run lint`,
   `npm test`.

## New files (delete on rollback)

- `prisma/rollbacks/0097_contrasena_temporal.down.sql` and this file (optional)
- `prisma/migrations/20261022100000_0097_contrasena_temporal/` (keep it once applied)
- `tests/db/contrasena-temporal.test.ts`
- (more are listed here as the later tasks land; filled in at Task 15)

## Edited files (revert the contraseña temporal hunks)

- `prisma/schema.prisma`: `debeCambiarPassword` in `model Usuario`.
- (filled in at Task 15)

## Nothing to undo

- No permiso, role, route or parameter is added by the migration itself.

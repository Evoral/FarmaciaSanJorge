# Rollback: Domicilios del cliente y de entrega

Spec: `openspec/specs/domicilios/spec.md`. Schema change (migration `prisma/migrations/20261023090000_0099_domicilios_cliente_y_entrega`):
reverted as code + a new forward migration built from `prisma/rollbacks/0099_domicilios_cliente_y_entrega.down.sql`.

## What the down migration loses

- The cliente's `domicilio` and `domicilio_entrega`.
- Every `receta.domicilio_entrega`. Envíos go back to `receta.domicilio_paciente`. If some envío addresses must survive,
  first run `UPDATE fsj.receta SET domicilio_paciente = domicilio_entrega WHERE domicilio_entrega IS NOT NULL AND
  domicilio_paciente IS NULL;` (it fills only recetas without a domicilio, never overwrites one).

## Order

1. Deploy the reverted code **first**: it neither reads nor writes the 0099 columns, which are nullable.
2. Copy the `.down.sql` into a NEW migration folder (next free number, later timestamp) and apply it. Never edit or
   delete the applied 0099 migration.
3. `npm run db:generate`, then `npm run typecheck`, `npm run lint`, `npm test`.

## Files

New (delete): `openspec/specs/domicilios/spec.md`, this file, `prisma/rollbacks/0099_domicilios_cliente_y_entrega.down.sql`,
the 0099 migration folder (keep it once applied).

Edited (revert the domicilio hunks): `prisma/schema.prisma`; every file listed under "Code" in the spec;
`shared/labels/field-labels.ts`; `openspec/specs/envios-repartidores/spec.md` and `openspec/specs/importacion-receta-pdf/spec.md` (notes);
`tests/unit/entregas-command-flows.test.ts` (the two E4 audit assertions).

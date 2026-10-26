# Rollback: Receta entregada siempre pagada

Spec: `openspec/specs/pago-receta/spec.md` (P4, P5, INV-R14). The feature has a **schema
change** (migration `prisma/migrations/20261013120000_0076_receta_entregada_pagada`),
so it is reverted as code + a new forward migration built from
`prisma/rollbacks/0076_receta_entregada_pagada.down.sql`.

## What the down migration changes

- Drops INV-R14 (`trg_receta_validar_entregada_pagada` and its function): a
  receta can be delivered unpaid again, and an ENTREGADA receta can be
  unmarked from its detail.
- Restores 0071's comment on `fsj.receta.pagada`.
- No data is lost: every `pagada` value stays as it is.

## Order

1. Apply the down migration **first**: copy
   `prisma/rollbacks/0076_receta_entregada_pagada.down.sql` into a NEW migration
   folder (next free number, a timestamp later than every existing one) and
   apply it with `npm run db:migrate`. Never edit or delete the applied 0076
   migration. The current code keeps working without the trigger (it still
   enforces the rule itself).
2. Then revert the code (the commit that introduced this change). Reverting
   the code first would break entregas: the old code writes the estado before
   the payment, which INV-R14 rejects.
3. `npm run typecheck`, `npm run lint`, `npm test`.

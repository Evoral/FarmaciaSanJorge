# Rollback: Lotes elaborados

Change: `openspec/changes/lotes-elaborados/`. The feature has a **schema change** (migration
`prisma/migrations/20261029130000_0111_lotes_elaborados`), so it is reverted as code + a new forward migration built
from `prisma/rollbacks/0111_lotes_elaborados.down.sql`.

## When it can be rolled back

Only while **no elaboración exists**. An `ELABORACION_PROPIA` partida and its `INGRESO_ELABORACION` /
`EGRESO_ELABORACION` movements are real stock (append-only, maybe already consumed by preparaciones): the down script
aborts if it finds one. With elaborated lots in use, fix forward, or take the feature out of use by removing the
permiso `stock.lote.elaborar` from every role.

## What the down migration loses

- Every fórmula (`fsj.formula_elaboracion` and its components). Their audit rows stay.
- The permiso `stock.lote.elaborar` with its role and PIN rows.
- `v_stock_droga.stock_activo` (the view is rebuilt as 0074).
- `ELABORACION_PROPIA`, `INGRESO_ELABORACION` and `EGRESO_ELABORACION` stay in their enums (Postgres cannot drop an
  enum value); unused, they are inert.

## Order

1. Deploy the reverted code **first**: it never writes the new values, tables or column, and does not read
   `stock_activo`, so it runs fine against the 0111 schema.
2. Copy `prisma/rollbacks/0111_lotes_elaborados.down.sql` into a NEW migration folder (next free number, a timestamp
   later than every existing one) and apply it. Never edit or delete the applied 0111 migration.
3. Revert the code, `npm run db:generate`, then `npm run typecheck`, `npm run lint`, `npm test`.

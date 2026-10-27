# Rollback: Cierre diario firmado al día siguiente

Spec: `openspec/specs/libro-recetario-y-contralor/spec.md` §5 (INV-C21, DP-18b revisada,
DP-18). The feature has a **schema change** (migration
`prisma/migrations/20261013090000_0075_cierre_firma_dia_anterior`), so it is
reverted as code + a new forward migration built from
`prisma/rollbacks/0075_cierre_firma_dia_anterior.down.sql`.

## What the down migration changes

- `fsj.cierre_diario_firmar` goes back to its 0039 body: the jornada in
  progress can be signed again (INV-C21 only rejects future jornadas). That
  body also lacks migration 0022's "DT ACTIVO now" condition in INV-U04, which
  0075 restored.
- `fsj.cierre_diario_calcular_fuera_de_termino` goes back to its 0038 body:
  the term counts from the jornada itself (`jornada_actual > fecha + plazo`).
- `plazo_firma_dias` description goes back to its 0038 text.
- No data is lost: `cierre_diario.fuera_de_termino` is a stored snapshot.
  Signatures made under 0075 keep the value computed then.

## Order

1. Revert the code first (the commit that introduced this change): it
   restores the same-day warning on `/cierres` and the pending list including
   today. Either code version works against either function body; only the
   `fuera de término` hint may disagree with the DB until step 2.
2. Copy `prisma/rollbacks/0075_cierre_firma_dia_anterior.down.sql` into a NEW
   migration folder (next free number, a timestamp later than every existing
   one) and apply it with `npm run db:migrate`. Never edit or delete the
   applied 0075 migration.
3. `npm run typecheck`, `npm run lint`, `npm test`.

# Rollback: Corregir pureza de una partida

Spec: `openspec/changes/corregir-potencia-partida/specs/corregir-potencia-partida/spec.md`. The feature has a **schema change** (migration
`prisma/migrations/20261030120000_0111_corregir_potencia_partida`), so it is reverted as code + a new forward
migration built from `prisma/rollbacks/0111_corregir_potencia_partida.down.sql`.

## What the down migration loses

- A purity already corrected keeps its new value in `fsj.partida.potencia_declarada`.
- The audit rows in `fsj.auditoria` stay.
- `fsj_app` loses UPDATE permission on `potencia_declarada` again.

## Order

1. Deploy the reverted code **first**: it no longer sends `potencia_declarada` updates, so it runs fine against the 0111 schema.
2. Copy `prisma/rollbacks/0111_corregir_potencia_partida.down.sql` into a NEW migration folder (next free
   number, a timestamp later than every existing one) and apply it. Never edit or delete the applied 0111 migration.
3. `npm run typecheck`, `npm run lint`, `npm test`.

## Files to delete on rollback

- `modules/stock/application/corregir-potencia-partida.ts`
- `modules/stock/ui/corregir-potencia-form.tsx`
- `tests/unit/corregir-potencia-partida.test.ts`
- `prisma/rollbacks/0111_corregir_potencia_partida.down.sql` and this file (optional)

## Files to revert

- `modules/auth/domain/permisos.ts`: remove `stock.partida.potencia.corregir`.
- `modules/usuarios/domain/ayuda-permisos.ts`: remove description for `stock.partida.potencia.corregir`.
- `modules/stock/infrastructure/partida-repository.ts`: remove `updatePotenciaPartida`.
- `modules/stock/ui/actions.ts`: remove `corregirPotenciaPartidaAction`.
- `app/(app)/partidas/[id]/page.tsx`: remove "Corregir pureza" panel.

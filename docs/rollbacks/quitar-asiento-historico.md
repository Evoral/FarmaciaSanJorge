# Rollback: quitar asientos históricos

Migration `0084_quitar_asiento_historico` dropped `fsj.asiento_historico` (with its rows), the permiso
`libro.historico.digitalizar` and its role grants; the app lost `/libro/historico`. Only dev data existed.

**The rows do not come back.** `prisma/rollbacks/0084_quitar_asiento_historico.down.sql` recreates the table EMPTY,
re-creates the permiso, grants it to every tenant's `DIRECTOR_TECNICO` role and restores the default role template.

## Order

1. Restore the code from the commit before the removal: `app/(app)/libro/historico/`, `modules/libro/` (application
   `crear-asiento-historico.ts`, `list-historico.ts`; infrastructure `historico-repository.ts`; domain
   `numero-asiento-fisico.ts`; ui `historico-form.tsx`, the action in `ui/actions.ts`, the tab in `ui/libro-nav.tsx`,
   `listHistoricoFiltro` in `domain/filtros.ts`), the permiso in `modules/auth/domain/permisos.ts`, the model in
   `prisma/schema.prisma`, the label `numeroAsientoFisico` and the tests.
2. Apply the down.sql as a new forward migration.
3. `npm run typecheck`, `npm run lint`, `npm test`.

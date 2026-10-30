# Tasks: Corregir pureza de una partida

## 1. Database & Schema
- [x] 1.1 Create migration `prisma/migrations/20261030120000_0111_corregir_potencia_partida/migration.sql` with `GRANT UPDATE (potencia_declarada) ON fsj.partida TO fsj_app;`
- [x] 1.2 Create rollback SQL `prisma/rollbacks/0111_corregir_potencia_partida.down.sql`
- [x] 1.3 Create rollback documentation `docs/rollbacks/corregir-potencia-partida.md`

## 2. Permissions & Domain
- [x] 2.1 Add permission `"stock.partida.potencia.corregir"` in `modules/auth/domain/permisos.ts` and catalog
- [x] 2.2 Add permission description in `modules/usuarios/domain/ayuda-permisos.ts`
- [x] 2.3 Grant permission to `ADMINISTRADOR` and `DIRECTOR_TECNICO` in default role mappings

## 3. Application & Infrastructure
- [x] 3.1 Implement `updatePotenciaPartida` in `modules/stock/infrastructure/partida-repository.ts`
- [x] 3.2 Implement `corregirPotenciaPartidaCommand` and `corregirPotenciaPartida` in `modules/stock/application/corregir-potencia-partida.ts`
- [x] 3.3 Add unit tests for `corregirPotenciaPartida` input validation and domain guards in `tests/unit/`

## 4. UI Layer
- [x] 4.1 Create `modules/stock/ui/corregir-potencia-form.tsx`
- [x] 4.2 Add `corregirPotenciaPartidaAction` in `modules/stock/ui/actions.ts`
- [x] 4.3 Integrate "Corregir pureza" panel in `app/(app)/partidas/[id]/page.tsx`

## 5. Verification
- [x] 5.1 Run `npm run typecheck`
- [x] 5.2 Run `npm run lint`
- [x] 5.3 Run `npm test`
- [x] 5.4 Run `npm run specs:validate`

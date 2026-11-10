# Tasks — planilla-existencia-inicial

Design: `design.md`. Migrations are written by the agent and applied by the user by hand.

## 1. Delivery 1: the tab (no migration)

- [x] 1.1 `app/(app)/partidas/partidas-tabs.tsx`; render it in `/partidas` and the new page.
- [x] 1.2 `app/(app)/partidas/existencia-inicial/page.tsx` with `RelevamientoInicialPanel` and the current form; show or hide the tab per R5.
- [x] 1.3 Remove the panel from `partidas/ingresar/page.tsx`; retarget `revalidatePath` in `modules/stock/ui/actions.ts`.
- [x] 1.4 `registrarPartidaCompra`: future-vencimiento check only for `origen === "COMPRA"` (R3).
- [x] 1.5 Read `marcar-partida-vencida.ts` and confirm an expired existencia inicial can be discarded through the existing path.
- [x] 1.6 Read-only state once the relevamiento ends.

## 2. Delivery 2: planilla and Pasar a stock

- [x] 2.1 `prisma/migrations/<ts>_0124_planilla_existencia_inicial/migration.sql` per `design.md` (confirm 0124 is still free).
- [x] 2.2 `prisma/schema.prisma` (`RelevamientoFila`, the two `TipoMovimiento` values) + `npm run db:generate`.
- [x] 2.3 `prisma/rollbacks/0124_planilla_existencia_inicial.down.sql` and `docs/rollbacks/planilla-existencia-inicial.md`.
- [ ] 2.4 User applies 0124 by hand, in the same deploy as the code.
- [x] 2.5 Permiso `stock.relevamiento.editar` in `modules/auth/domain/permisos.ts`.
- [x] 2.6 Domain: `estadoFila`, `agruparFilas`, `conflictosGrupo`.
- [x] 2.7 Repository and use cases: `guardarFilaRelevamiento`, `quitarFilaRelevamiento`, `getPlanillaRelevamiento`, `pasarGrupoAStock`.
- [x] 2.8 Server Action for Pasar a stock under `conOperador`, up to 100 groups per press.
- [ ] 2.9 `planilla-existencia-inicial.tsx`, its confirmation dialog and the list of what passed; retire `existencia-inicial-form.tsx` and `ingresarExistenciaInicial`.
- [ ] 2.10 Faltan cargar (R16).
- [ ] 2.11 Close: Faltan cargar, rows left, discard (R7).
- [ ] 2.12 Banner `resumenRelevamiento` (R20).
- [x] 2.13 Labels, kardex, reports and SQL reads of the new tipos (`design.md`, Reads to revisit).
- [ ] 2.14 Review by a different agent/vendor.

## 3. Delivery 3: corrections

- [ ] 3.1 `prisma/migrations/<ts>_0125_corregir_datos_existencia_inicial/migration.sql` and its `.down.sql`; extend the rollback doc.
- [ ] 3.2 User applies 0125 by hand, in the same deploy as the code.
- [ ] 3.3 Domain: `deltaCorreccion`, "unused" rule.
- [ ] 3.4 `corregirCantidadInicial`, with the co-firma for a controlled RESTA.
- [ ] 3.5 `corregirDatosPartidaInicial`.
- [ ] 3.6 Correction `<dialog>`; anulada state; corrections list in the close (R7).
- [ ] 3.7 Confirm `/partidas`, the partida detail and the valorizado handle `cantidad_inicial = 0`.
- [ ] 3.8 Review by a different agent/vendor.

## 4. Delivery 4: Excel

- [ ] 4.1 `importarPlanillaExcel` over `leer-xlsx.server.ts` (R21), with a downloadable template.
- [ ] 4.2 Import control in the tab.

## 5. Specs and archive

- [ ] 5.1 On archive, merge the delta into `openspec/specs/existencia-inicial/spec.md`; rewrite its Purpose ("every envase becomes a partida" is now "every lote"), Vocabulary, Enforcement and Decisions.
- [ ] 5.2 Update `openspec/specs/libro-recetario-y-contralor/spec.md` where it says only `INGRESO_INICIAL` is exempt.
- [ ] 5.3 `npm run specs:validate`.

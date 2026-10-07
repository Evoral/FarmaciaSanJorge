# Rollback: Sinónimos de droga

Spec: `docs/specs/sinonimos-droga.md`. The feature has **two schema changes**
(migrations `prisma/migrations/20261007090000_0067_droga_sinonimos` and
`prisma/migrations/20261007180000_0069_componente_sinonimo`), so it is
reverted as code + new forward migrations built from
`prisma/rollbacks/0069_componente_sinonimo.down.sql` and
`prisma/rollbacks/0067_droga_sinonimos.down.sql`, **in that order** (0067's
down deletes removed synonyms, which 0069's column may reference).

0069 ("Nombre elegido al cargar") can be reverted on its own: apply its down
migration together with the code revert listed under "0069 only" below; 0067
stays.

## What the down migrations lose

0069: which synonym each receta componente was loaded with
(`componente_item_receta.droga_alias_id`); the componentes keep their droga and
show the canonical name again. Also drops `droga_alias_tenant_id_droga_key`.

0067:

- `droga_alias.texto` (the synonyms as typed). Matching keeps working on
  `alias_normalizado`.
- Every removed synonym (`fecha_baja IS NOT NULL`): they are deleted so the
  old `UNIQUE (tenant_id, alias_normalizado)` can be re-created. Synonyms
  removed because their droga was given de baja are among them; with the old
  code they would have blocked that text again anyway.
- The accent-insensitive vigente-name uniqueness: the citext
  `uq_droga_nombre_vigente` comes back. It cannot fail to build (it is weaker).
- The `unaccent` extension is left installed (harmless).

## Order

1. Deploy the code revert first **only if** the down migration is applied in
   the same release window: the old code inserts `droga_alias` rows without
   `texto` (NOT NULL until the down migration drops it) and its searches do not
   call `fsj.normalizar_nombre`. Safest: apply the down migration and deploy the
   reverted code together, migration first.
2. Copy `prisma/rollbacks/0069_componente_sinonimo.down.sql` into a NEW
   migration folder (next free number) and apply it with `npm run db:migrate`;
   then the same with `prisma/rollbacks/0067_droga_sinonimos.down.sql`. The
   0069 down must run first and together with the code that no longer reads
   `droga_alias_id` (the new code selects it).
3. Revert the code (below), `npm run db:generate`, then `npm run typecheck`,
   `npm run lint`, `npm test`.

## New files (delete on rollback)

- `prisma/migrations/20261007090000_0067_droga_sinonimos/` and `prisma/migrations/20261007180000_0069_componente_sinonimo/` (keep them: applied migrations are history; the down migrations undo them)
- `prisma/rollbacks/0069_componente_sinonimo.down.sql` (keep it with the other down files)
- `modules/recetas/application/sinonimos-componentes.ts` (0069)
- `modules/drogas/domain/sinonimo.ts`
- `modules/drogas/domain/normalizar.ts` (move its content back into `modules/recetas/domain/normalizar.ts`, which today only re-exports it, and point `modules/drogas/domain/sugerir-clase.ts`, `modules/stock/application/importar-factura-compra.ts` and `modules/stock/application/leer-factura-compra-pdf.ts` back to it)
- `modules/drogas/infrastructure/sinonimo-repository.ts`
- `modules/drogas/ui/drogas-existentes.tsx` (live duplicate check of the droga form)
- `modules/proveedores/application/sinonimos-drogas.ts`, `modules/proveedores/infrastructure/sinonimos-drogas-repository.ts`
- `shared/db/busqueda-droga.ts`, `shared/ui/sinonimo-hint.tsx`
- this file and the spec (optional)

## Edited files (revert the synonym hunks)

### 0069 only ("Nombre elegido al cargar")

- `prisma/schema.prisma`: `ComponenteItemReceta.drogaAliasId` / `drogaAlias` / its index, `DrogaAlias.componentes` and `@@unique([tenantId, id, drogaId])`.
- `shared/ui/combobox.tsx` (`textoDe`, the selected value's synonym + hint), `shared/ui/sinonimo-hint.tsx` (`NombrePrincipalHint`), `shared/db/busqueda-droga.ts` (`sinonimoCoincidenteSql`'s `columna`).
- `modules/recetas/infrastructure/receta-repository.ts` (`DrogaOpcion.sinonimoId`, `getSinonimosParaComponentes`, `listSinonimosGuardadosDeReceta`, `NuevoComponenteInput.drogaAliasId`, `ComponenteDetalle.drogaAliasId` / `sinonimo`), `modules/recetas/domain/receta.ts` (`ComponenteInput.drogaAliasId`, `NombresParaResumen.sinonimos`), `modules/recetas/domain/importacion-receta.ts` (`AliasDroga.id` / `texto`, `MatchDroga.aliasId` / `sinonimo`, `ComponenteVistaPrevia.drogaAliasId` / `sinonimo`), `modules/recetas/infrastructure/importacion-repository.ts` (`listAliasesVigentes` select).
- `modules/recetas/application/crear-receta.ts`, `editar-receta.ts`, `importar-receta.ts` (synonym validation, `equivalencias[].componentes`, aliases written before the receta), `leer-receta-pdf.ts`.
- `modules/recetas/ui/droga-picker.tsx` (`DrogaElegida`, `selectedSinonimo`), `receta-form.tsx`, `receta-form-inicial.ts`, `componentes-tabla.tsx`.
- `modules/preparaciones/infrastructure/preparacion-repository.ts` (`ComponenteDePendiente.sinonimo`, `listComponentesDePendientesSql`, the toma read).
- `modules/stock/ui/importar-factura-form.tsx` (line matched through a synonym).
- `docs/specs/sinonimos-droga.md` ("Nombre elegido al cargar", R9/R10, scenarios 11-14).

### 0067

- `prisma/schema.prisma`: `DrogaAlias` (`texto`, `fechaBaja`, `@@unique([tenantId, aliasNormalizado])` back) and the `Droga` doc comment.
- `modules/drogas/infrastructure/droga-repository.ts`: `existeNombreVigente` back to a boolean Prisma `equals … insensitive` check; `listDrogas` search back to `nombre contains`; `sinonimos` / `sinonimoCoincidente` / `DrogaOpcion.sinonimos` removed.
- `modules/drogas/application/crear-droga.ts`, `editar-droga.ts`, `reactivar-droga.ts`, `dar-de-baja-droga.ts` (comment), `get-droga.ts`.
- `modules/drogas/ui/actions.ts` (synonym rows of crear/editar), `modules/drogas/ui/buscar-drogas-catalogo-action.ts`, `modules/drogas/ui/droga-form.tsx` ("Otros nombres" rows and live check).
- `app/(app)/catalogos/drogas/page.tsx` (synonyms line), `app/(app)/catalogos/drogas/[id]/page.tsx` (passes the synonyms to the form, baja help text).
- `modules/recetas/infrastructure/importacion-repository.ts` and `modules/stock/infrastructure/factura-compra-repository.ts` (`listAliasesVigentes`, `getDrogaAlias`, `insertDrogaAlias`); `modules/recetas/application/importar-receta.ts` and `modules/stock/application/importar-factura-compra.ts` (`texto`, `esNombre`, audit fields).
- `modules/recetas/infrastructure/receta-repository.ts` (`listDrogasParaReceta` back to Prisma), `modules/recetas/ui/droga-picker.tsx`.
- `modules/stock/infrastructure/partida-repository.ts` (`listStockDrogasSql`, `listAjustesSql`), `modules/stock/infrastructure/valorizado-repository.ts`, `modules/stock/ui/buscar-drogas-stock-action.ts`, `droga-buscador.tsx`, `kardex-droga-filtro.tsx`, `importar-factura-form.tsx`, `app/(app)/stock/ingresar/page.tsx`.
- `modules/proveedores/ui/comparador-filtros.tsx`, `trayectoria-filtro-drogas.tsx`, `app/(app)/comparador-costos/page.tsx`, `app/(app)/proveedores/[id]/historial/page.tsx`.
- `shared/ui/combobox.tsx` (`sinonimos` / `sinonimo` on `ComboboxOption`, `filtrarOpciones`, the hint), `shared/ui/buscador-navegable.tsx`.
- `shared/labels/field-labels.ts` (`sinonimo`, `aliasNormalizado`), `shared/errors/mensajes-invariantes.ts` (`INV-DRG-002`, `INV-DRG-003` — keep them while the 0067 migration file exists: the global-messages test scans every migration), `modules/auditoria/domain/presentacion.ts` (`droga_alias` label).
- `docs/specs/importacion-receta-pdf.md`, `modules/README.md`.

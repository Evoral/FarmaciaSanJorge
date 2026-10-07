# Rollback: Sinónimos de droga

Spec: `docs/specs/sinonimos-droga.md`. The feature has a **schema change**
(migration `prisma/migrations/20261007090000_0067_droga_sinonimos`), so it is
reverted as code + a new forward migration built from
`prisma/rollbacks/0067_droga_sinonimos.down.sql`.

## What the down migration loses

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
2. Copy `prisma/rollbacks/0067_droga_sinonimos.down.sql` into a NEW migration
   folder (next free number) and apply it with `npm run db:migrate`.
3. Revert the code (below), `npm run db:generate`, then `npm run typecheck`,
   `npm run lint`, `npm test`.

## New files (delete on rollback)

- `prisma/migrations/20261007090000_0067_droga_sinonimos/` (keep it: applied migrations are history; the down migration undoes it)
- `modules/drogas/domain/sinonimo.ts`
- `modules/drogas/domain/normalizar.ts` (move its content back into `modules/recetas/domain/normalizar.ts`, which today only re-exports it, and point `modules/drogas/domain/sugerir-clase.ts`, `modules/stock/application/importar-factura-compra.ts` and `modules/stock/application/leer-factura-compra-pdf.ts` back to it)
- `modules/drogas/infrastructure/sinonimo-repository.ts`
- `modules/drogas/application/agregar-sinonimo.ts`, `modules/drogas/application/quitar-sinonimo.ts`
- `modules/drogas/ui/sinonimos-droga.tsx`
- `modules/proveedores/application/sinonimos-drogas.ts`, `modules/proveedores/infrastructure/sinonimos-drogas-repository.ts`
- `shared/db/busqueda-droga.ts`, `shared/ui/sinonimo-hint.tsx`
- this file and the spec (optional)

## Edited files (revert the synonym hunks)

- `prisma/schema.prisma`: `DrogaAlias` (`texto`, `fechaBaja`, `@@unique([tenantId, aliasNormalizado])` back) and the `Droga` doc comment.
- `modules/drogas/infrastructure/droga-repository.ts`: `existeNombreVigente` back to a boolean Prisma `equals … insensitive` check; `listDrogas` search back to `nombre contains`; `sinonimos` / `sinonimoCoincidente` / `DrogaOpcion.sinonimos` removed.
- `modules/drogas/application/crear-droga.ts`, `editar-droga.ts`, `reactivar-droga.ts`, `dar-de-baja-droga.ts` (comment), `get-droga.ts`.
- `modules/drogas/ui/actions.ts` (two actions), `modules/drogas/ui/buscar-drogas-catalogo-action.ts`.
- `app/(app)/catalogos/drogas/page.tsx` (synonyms line), `app/(app)/catalogos/drogas/[id]/page.tsx` ("Otros nombres" panel, baja help text).
- `modules/recetas/infrastructure/importacion-repository.ts` and `modules/stock/infrastructure/factura-compra-repository.ts` (`listAliasesVigentes`, `getDrogaAlias`, `insertDrogaAlias`); `modules/recetas/application/importar-receta.ts` and `modules/stock/application/importar-factura-compra.ts` (`texto`, `esNombre`, audit fields).
- `modules/recetas/infrastructure/receta-repository.ts` (`listDrogasParaReceta` back to Prisma), `modules/recetas/ui/droga-picker.tsx`.
- `modules/stock/infrastructure/partida-repository.ts` (`listStockDrogasSql`, `listAjustesSql`), `modules/stock/infrastructure/valorizado-repository.ts`, `modules/stock/ui/buscar-drogas-stock-action.ts`, `droga-buscador.tsx`, `kardex-droga-filtro.tsx`, `importar-factura-form.tsx`, `app/(app)/stock/ingresar/page.tsx`.
- `modules/proveedores/ui/comparador-filtros.tsx`, `trayectoria-filtro-drogas.tsx`, `app/(app)/comparador-costos/page.tsx`, `app/(app)/proveedores/[id]/historial/page.tsx`.
- `shared/ui/combobox.tsx` (`sinonimos` / `sinonimo` on `ComboboxOption`, `filtrarOpciones`, the hint), `shared/ui/buscador-navegable.tsx`.
- `shared/labels/field-labels.ts` (`sinonimo`, `aliasNormalizado`), `shared/errors/mensajes-invariantes.ts` (`INV-DRG-002`, `INV-DRG-003` — keep them while the 0067 migration file exists: the global-messages test scans every migration), `modules/auditoria/domain/presentacion.ts` (`droga_alias` label).
- `docs/specs/importacion-receta-pdf.md`, `modules/README.md`.

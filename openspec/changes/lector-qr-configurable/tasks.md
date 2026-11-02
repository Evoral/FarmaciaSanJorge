# Tasks

Design: `design.md`. Behavior: `specs/importacion-receta-qr/spec.md` (delta, cases P74–P85).

## 1. Domain

- [x] 1.1 `modules/recetas/domain/modo-lector-qr.ts`: modes, default, labels, `parseModoLectorQr`, `resolverModoLectorQr`
- [x] 1.2 Unit tests for the resolver and the parser (P83)

## 2. Farmacia parameter

- [x] 2.1 Migration `prisma/migrations/20261102120000_0114_parametro_lector_qr_receta/migration.sql`: row `lector_qr_receta` = `CAMARA` (`TEXTO`) for every existing tenant, `ON CONFLICT DO NOTHING`
- [x] 2.2 `prisma/rollbacks/0114_parametro_lector_qr_receta.down.sql`
- [x] 2.3 `docs/rollbacks/lector-qr-configurable.md` (order: code first, then the `.down.sql`)
- [x] 2.4 `scripts/create-tenant.ts`: seed the row for new tenants
- [x] 2.5 `parametros-registry.ts`: `tipo: "OPCION"` with `opciones`; `ValidacionParametro` returns a normalized string; numeric validators return `toString()`; entry `lector_qr_receta`
- [x] 2.6 `editar-parametro.ts`: store the normalized string (no behavior change for numbers)
- [x] 2.7 `list-parametros.ts` returns `tipo` and `opciones`; `ParametroForm` renders a `<select>` for `OPCION`; parametros page passes them through
- [x] 2.8 Unit tests: the new entry accepts only `CAMARA` / `LECTOR` (P77); numeric entries normalize as before

## 3. Reading the mode in `/recetas/nuevo`

- [x] 3.1 `getModoLectorQrFarmacia` in `modules/recetas/infrastructure` (fallback `CAMARA`, P79)
- [x] 3.2 `modules/recetas/application/get-modo-lector-qr.ts` (`defineQuery`, `recetas.crear`)
- [x] 3.3 `app/(app)/recetas/nuevo/page.tsx` → `NuevaReceta` → `ImportarRecetaQr`: `modoLectorFarmacia` and `tenantId`

## 4. Panel

- [x] 4.1 Equipo preference helper (`localStorage` key `fsj.lector-qr.<tenantId>`, `try/catch`, `storage` event) + unit tests with a throwing storage (P82)
- [x] 4.2 `importar-receta-qr.tsx`: effective mode, hide camera button / notice / scanner in `LECTOR`, copy by mode (P74, P75)
- [x] 4.3 Selector "En este equipo" outside the form, after the input, no focus change (P80, P81); switching to `LECTOR` closes an open scanner (P84)
- [x] 4.4 Update the component's header comment

## 5. Verify

- [ ] 5.1 `npm run typecheck`, `npm run lint`, `npm test` (local run on 2026-11-02: no errors in the touched files, the new tests pass; the full run fails only where `exceljs` is missing from node_modules and the generated Prisma client is stale, unrelated to this change: CI is the gate)
- [x] 5.1b Apply migration 0114 to the database (2026-11-02, `npm run db:migrate`; 2 of 2 tenants have the row = `CAMARA`. Another change applied `20261102120000_0114_vencimiento_lote_elaborado` a minute earlier: same number and timestamp, independent SQL, both applied)
- [ ] 5.2 Manual: both modes, equipo selector, Parámetros select and audit (P74–P82, P84)
- [ ] 5.3 Manual: Gadnic CODBAR10 end to end on a real PC (P85)

## 6. Archive

- [ ] 6.1 Merge the delta into `openspec/specs/importacion-receta-qr/spec.md`; also update its non-normative "Alcance" and "Panel y lector USB" sections (mode of the reader, where to set it) and add P74–P85 to "Casos de prueba"
- [ ] 6.2 Move the change to `openspec/changes/archive/YYYY-MM-DD-lector-qr-configurable/`

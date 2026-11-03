# Tasks

Design: `design.md`. Behavior: `specs/cuit-farmacia/spec.md` (delta).

## 1. Database

- [x] 1.1 Migration `prisma/migrations/20261103120000_0115_tenant_cuit_siempre_editable/migration.sql`: drop `trg_tenant_cuit_antes_primer_cierre` and `fsj.tenant_cuit_antes_primer_cierre()`; keep the `cuit` column grant
- [x] 1.2 `prisma/rollbacks/0115_tenant_cuit_siempre_editable.down.sql`: recreate the 0105 function and trigger
- [x] 1.3 `docs/rollbacks/cuit-farmacia.md`: section for this change (code first, then the `.down.sql`)

## 2. Application

- [x] 2.1 `editar-datos-tenant.ts`: remove the cierre check; update the header comment
- [x] 2.2 `get-datos-tenant.ts`: remove `cuitEditable`
- [x] 2.3 `tenant-repository.ts`: remove `tenantTieneCierreDiario` (unused); update the `cuit` comment
- [x] 2.4 `shared/errors/mensajes-invariantes.ts`: keep `INV-PL-005` (still raised by the applied 0105; required by `mensajes-invariantes-global.test.ts`)

## 3. UI

- [x] 3.1 `editar-datos-tenant-form.tsx`: CUIT field always shown, R6 warning under it (`alert alert-warn`, `role="note"`)
- [x] 3.2 `app/(app)/admin/configuracion/farmacia/page.tsx`: drop the CUIT `DatoFijo`

## 4. Tests

- [x] 4.1 `tests/unit/parametros-validacion.test.ts`: update the `cuit` case description
- [x] 4.2 `tests/db/tenant-parametro.test.ts`: update the 0105 case. The "after a cierre diario" case was left out: inserting a `fsj.cierre_diario` row needs a DT, a designación and a jornada, which this file's fixtures do not build

## 5. Verify

- [ ] 5.1 `npm run typecheck`, `npm run lint`, `npm test` (local run on 2026-11-03: no errors in the touched files, the touched tests pass; the remaining failures are the same 10 files that fail without this change: `exceljs` missing from node_modules, `next.config.ts`, unrelated mocks. CI is the gate)
- [x] 5.2 Apply the migration (2026-11-03, `npm run db:migrate`; checked: `trg_tenant_cuit_antes_primer_cierre` and its function are gone, `fsj_app` keeps `UPDATE` on `fsj.tenant.cuit`)
- [ ] 5.3 Manual: change the CUIT in a tenant with signed cierres; the warning shows; the audit has old and new CUIT

## 6. Archive

- [ ] 6.1 Merge the delta into `openspec/specs/cuit-farmacia/spec.md`; also update its `## Purpose` (no longer "stays fixed" / "while being set up"), `## Enforcement` (no app check, no trigger, no accepted race) and `## Code`
- [ ] 6.2 Move the change to `openspec/changes/archive/YYYY-MM-DD-cuit-farmacia-siempre-editable/`

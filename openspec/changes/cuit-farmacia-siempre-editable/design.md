# Design — CUIT de la farmacia siempre editable

Proposal: `proposal.md`. Behavior: `specs/cuit-farmacia/spec.md` (delta).

## Database

- **Migration** `prisma/migrations/<timestamp>_0115_tenant_cuit_siempre_editable/migration.sql` (0115 is the next
  free number today; take the next free one at implementation time, with a timestamp later than every existing
  migration):
  - `DROP TRIGGER IF EXISTS trg_tenant_cuit_antes_primer_cierre ON fsj.tenant;`
  - `DROP FUNCTION IF EXISTS fsj.tenant_cuit_antes_primer_cierre();`
  - Keep `GRANT UPDATE (cuit) ON fsj.tenant TO fsj_app` (0105): it is what lets the app write the CUIT.
  - Header comment: user decision (2026-11-03), spec link, rollback path.
- **Rollback** `prisma/rollbacks/0115_tenant_cuit_siempre_editable.down.sql`: recreate the function and the trigger
  exactly as in migration 0105 (`SET search_path = fsj, extensions`, `REVOKE EXECUTE ... FROM PUBLIC`, the
  `COMMENT`). It fails nothing on existing data: the trigger only checks future updates.
- Untouched: the 0105 migration itself (already applied), `fsj.tenant.cuit` UNIQUE (R5), the cross-tenant trigger
  from 0020.

## Application (`modules/farmacia`)

- `application/editar-datos-tenant.ts`: drop the `tenantTieneCierreDiario` check and the `DomainError`; keep
  `cuit` optional in the input (`omitted = unchanged`) and the audit keys only when it changed (R4). Update the
  header comment (no "only until the first cierre").
- `application/get-datos-tenant.ts`: drop `cuitEditable` and the `DatosTenant` extension; return `TenantDetalle`.
- `infrastructure/tenant-repository.ts`: remove `tenantTieneCierreDiario` if nothing else uses it; update the
  `DatosEditablesTenant.cuit` comment.
- `shared/errors/mensajes-invariantes.ts`: keep `INV-PL-005`. `tests/unit/mensajes-invariantes-global.test.ts`
  requires a message for every INV code raised by any migration, and the applied 0105 still raises it.

## UI

- `modules/farmacia/ui/editar-datos-tenant-form.tsx`: render the CUIT field always (drop the `cuitEditable` prop
  and the "(editable hasta firmar el primer cierre diario)" hint); add the R6 warning right under the field using
  the existing pattern `<div role="note" className="alert alert-warn">` (as in `modules/unidades/ui/unidad-form.tsx`).
  The field keeps `required`, `maxLength={20}` and the `use-form-submit` error marking.
- `app/(app)/admin/configuracion/farmacia/page.tsx`: drop the conditional CUIT `DatoFijo` from "Datos no editables".

## Tests

- `tests/unit/parametros-validacion.test.ts`: the `cuit` case description no longer says "until the first cierre".
- `tests/db/tenant-parametro.test.ts`: update the 0105 comment and test name; add a case where `fsj_app` updates
  the CUIT of a tenant that has a `fsj.cierre_diario` row (only if the existing DB fixtures can insert one without
  building a whole jornada; otherwise leave it out and say so).

## Docs

- `docs/rollbacks/cuit-farmacia.md`: add a section for this change (order: deploy the reverted code first, then
  apply the `.down.sql` as a new migration; what it loses: nothing stored, a CUIT changed in between keeps its value).

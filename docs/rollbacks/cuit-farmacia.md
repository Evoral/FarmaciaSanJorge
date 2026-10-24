# Rollback: CUIT de la farmacia

Spec: `docs/specs/cuit-farmacia.md`. The feature has a **schema change** (migration
`prisma/migrations/20261024120000_0105_tenant_cuit_antes_primer_cierre`), so it is reverted as code + a new forward
migration built from `prisma/rollbacks/0105_tenant_cuit_antes_primer_cierre.down.sql`.

## What the down migration loses

- Nothing stored: a CUIT already changed keeps its new value, and its audit rows stay.

## Order

1. Deploy the reverted code **first**: it never sends `cuit`, so it runs fine against the 0105 schema.
2. Copy `prisma/rollbacks/0105_tenant_cuit_antes_primer_cierre.down.sql` into a NEW migration folder (next free
   number, a timestamp later than every existing one) and apply it. Never edit or delete the applied 0105 migration.
3. `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `docs/specs/cuit-farmacia.md`, `prisma/rollbacks/0105_tenant_cuit_antes_primer_cierre.down.sql` and this file
  (optional)
- `prisma/migrations/20261024120000_0105_tenant_cuit_antes_primer_cierre/` (keep it once applied)

## Edited files (revert the CUIT hunks)

- `modules/farmacia/infrastructure/tenant-repository.ts`: `DatosEditablesTenant.cuit`, `tenantTieneCierreDiario`.
- `modules/farmacia/application/editar-datos-tenant.ts`: `cuit` in the input, the cierre check, the audit keys.
- `modules/farmacia/application/get-datos-tenant.ts`: `DatosTenant`, `cuitEditable`.
- `modules/farmacia/ui/editar-datos-tenant-form.tsx`, `modules/farmacia/ui/actions.ts`: the CUIT field.
- `app/(app)/admin/configuracion/farmacia/page.tsx`: the CUIT `DatoFijo` back to unconditional.
- `shared/errors/mensajes-invariantes.ts`: `INV-PL-005`.
- `tests/unit/parametros-validacion.test.ts`: `cuit` back in the non-editable list.

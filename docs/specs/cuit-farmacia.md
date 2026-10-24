# CUIT de la farmacia

User decision (2026-10-24): the CUIT is the farmacia's legal identifier and stays fixed, but the ADM can set it
from the app while the farmacia is being set up, so a typo made when the tenant was created
(`scripts/create-tenant.ts`) does not need an owner-level fix.

## Rules

- **R1** The CUIT is edited from **Administración › Configuración › Farmacia**, in the same form as the other
  institutional data, with the permiso `config.editar`.
- **R2** It can change only while the tenant has **no signed cierre diario** (no row in `fsj.cierre_diario`). A
  signed cierre's PDF reads the CUIT live from `fsj.tenant` (`modules/cierres/infrastructure/cierre-pdf.ts`), so
  changing it afterwards would rewrite already-signed legal documents.
- **R3** Once the first cierre is signed the form no longer shows the field, and the CUIT appears read-only in the
  "Datos no editables" aside with the reason.
- **R4** A change is audited with the rest of the form (`tenant`, `MODIFICAR`); `cuit` appears in
  `valorAnterior`/`valorNuevo` only when it changed.
- **R5** The CUIT stays unique across tenants (`fsj.tenant.cuit` UNIQUE): a CUIT already used by another tenant is
  refused.

## Enforcement

- App: `editarDatosTenant` refuses a changed CUIT when `tenantTieneCierreDiario` is true (`DomainError` on the
  `cuit` field, message `INV-PL-005`).
- DB (migration 0105): column grant `UPDATE (cuit)` to `fsj_app`, and the trigger
  `fsj.tenant_cuit_antes_primer_cierre` (`INV-PL-005`), which applies to every role, owner included.
- Accepted race: a CUIT edit and the first cierre signed in two concurrent transactions are not serialized
  against each other. It needs the ADM editing the CUIT at the very moment the DT signs the first cierre.

## Code

- `prisma/migrations/20261024120000_0105_tenant_cuit_antes_primer_cierre/`
- `modules/farmacia/infrastructure/tenant-repository.ts`: `DatosEditablesTenant.cuit`, `tenantTieneCierreDiario`.
- `modules/farmacia/application/editar-datos-tenant.ts`, `get-datos-tenant.ts` (`cuitEditable`).
- `modules/farmacia/ui/editar-datos-tenant-form.tsx`, `modules/farmacia/ui/actions.ts`.
- `app/(app)/admin/configuracion/farmacia/page.tsx`.
- `shared/errors/mensajes-invariantes.ts`: `INV-PL-005`.

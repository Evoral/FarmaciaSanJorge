# CUIT de la farmacia

## Purpose

The CUIT is the farmacia's legal identifier and stays fixed, but the ADM can set it from the app while the
farmacia is being set up, so a typo made when the tenant was created (`scripts/create-tenant.ts`) does not need
an owner-level fix. User decision (2026-10-24).

## Requirements

### Requirement: R1 — Edit from Configuración › Farmacia

The CUIT SHALL be edited from **Administración › Configuración › Farmacia**, in the same form as the other
institutional data, and only by a user with the permiso `config.editar`.

#### Scenario: ADM sets the CUIT during setup

- **GIVEN** a user with the permiso `config.editar` and a tenant with no signed cierre diario
- **WHEN** the user changes the CUIT in the Farmacia form and saves
- **THEN** the new CUIT is stored together with the rest of the institutional data

#### Scenario: User without the permiso

- **GIVEN** a user without the permiso `config.editar`
- **WHEN** the user tries to change the CUIT
- **THEN** the change is refused

### Requirement: R2 — Editable only before the first signed cierre

The CUIT MUST change only while the tenant has no signed cierre diario (no row in `fsj.cierre_diario`). A signed
cierre's PDF reads the CUIT live from `fsj.tenant` (`modules/cierres/infrastructure/cierre-pdf.ts`), so changing it
afterwards would rewrite already-signed legal documents.

#### Scenario: No cierre signed yet

- **GIVEN** a tenant with no row in `fsj.cierre_diario`
- **WHEN** the ADM saves a different CUIT
- **THEN** the CUIT changes

#### Scenario: A cierre is already signed

- **GIVEN** a tenant with at least one signed cierre diario
- **WHEN** a changed CUIT reaches `editarDatosTenant`
- **THEN** it is refused with a `DomainError` on the `cuit` field carrying the invariant message `INV-PL-005`

#### Scenario: Direct database update after the first cierre

- **GIVEN** a tenant with at least one signed cierre diario
- **WHEN** any role, owner included, updates `fsj.tenant.cuit` to a different value
- **THEN** the trigger `fsj.tenant_cuit_antes_primer_cierre` refuses it (`INV-PL-005`)

### Requirement: R3 — Read-only after the first cierre

Once the first cierre is signed, the Farmacia form SHALL no longer show the CUIT field, and the CUIT SHALL appear
read-only in the "Datos no editables" aside, with the reason.

#### Scenario: Opening the form after the first cierre

- **GIVEN** a tenant with at least one signed cierre diario
- **WHEN** the ADM opens Administración › Configuración › Farmacia
- **THEN** the form has no CUIT field
- **AND** the CUIT is shown read-only in "Datos no editables" with the reason it cannot change

### Requirement: R4 — Audited with the rest of the form

A change SHALL be audited with the rest of the form (`tenant`, `MODIFICAR`); `cuit` MUST appear in
`valorAnterior`/`valorNuevo` only when it changed.

#### Scenario: The CUIT changed

- **WHEN** the ADM saves the form with a different CUIT
- **THEN** the `tenant` / `MODIFICAR` audit record includes `cuit` in `valorAnterior` and `valorNuevo`

#### Scenario: The CUIT did not change

- **WHEN** the ADM saves the form changing other data but not the CUIT
- **THEN** the audit record does not include `cuit`

### Requirement: R5 — Unique across tenants

The CUIT MUST stay unique across tenants (`fsj.tenant.cuit` UNIQUE): a CUIT already used by another tenant is
refused.

#### Scenario: CUIT of another tenant

- **GIVEN** another tenant already has CUIT X
- **WHEN** the ADM saves CUIT X
- **THEN** the change is refused

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

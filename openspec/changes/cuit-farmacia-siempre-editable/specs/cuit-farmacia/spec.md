# Delta — CUIT de la farmacia

## MODIFIED Requirements

### Requirement: R1 — Edit from Configuración › Farmacia

The CUIT SHALL be edited from **Administración › Configuración › Farmacia**, in the same form as the other
institutional data, and only by a user with the permiso `config.editar`. It SHALL be editable at any time, whether
or not the tenant has signed cierres diarios. User decision (2026-11-03).

#### Scenario: ADM changes the CUIT before the first cierre

- **GIVEN** a user with the permiso `config.editar` and a tenant with no signed cierre diario
- **WHEN** the user changes the CUIT in the Farmacia form and saves
- **THEN** the new CUIT is stored together with the rest of the institutional data

#### Scenario: ADM changes the CUIT after cierres were signed

- **GIVEN** a user with the permiso `config.editar` and a tenant with at least one signed cierre diario
- **WHEN** the user changes the CUIT in the Farmacia form and saves
- **THEN** the new CUIT is stored together with the rest of the institutional data

#### Scenario: Direct database update after the first cierre

- **GIVEN** a tenant with at least one signed cierre diario
- **WHEN** `fsj_app`, in that tenant's session, updates `fsj.tenant.cuit` to a different value
- **THEN** the update succeeds

#### Scenario: User without the permiso

- **GIVEN** a user without the permiso `config.editar`
- **WHEN** the user tries to change the CUIT
- **THEN** the change is refused

## ADDED Requirements

### Requirement: R6 — Warning next to the CUIT field

The Farmacia form SHALL always show the CUIT field, and next to it a warning that stays visible whatever the value,
with the text: "El CUIT identifica legalmente a la farmacia. Si lo cambiás, el CUIT nuevo aparece en todos los
documentos, incluso en los cierres, hojas del libro recetario y fichas ya firmados cuando se vuelvan a ver o
imprimir. El CUIT anterior queda registrado en la auditoría." The CUIT SHALL NOT appear in the "Datos no editables"
aside.

The warning is the only safeguard: signed cierre PDFs, libro recetario pages and fichas de elaboración read the CUIT
live from `fsj.tenant`, so after a change they show the new CUIT. Keeping the previous CUIT on documents already
signed is out of scope (user decision, 2026-11-03).

#### Scenario: Opening the form

- **GIVEN** a user with the permiso `config.editar`, with or without signed cierres diarios in the tenant
- **WHEN** the user opens Administración › Configuración › Farmacia
- **THEN** the form has the CUIT field with the warning next to it
- **AND** "Datos no editables" does not list the CUIT

#### Scenario: Reprinting a cierre signed before the change

- **GIVEN** a cierre diario signed with CUIT A, and the CUIT later changed to B
- **WHEN** the cierre PDF is generated again
- **THEN** it shows CUIT B
- **AND** the audit record of the change keeps CUIT A in `valorAnterior`

## REMOVED Requirements

### Requirement: R2 — Editable only before the first signed cierre

**Reason**: User decision (2026-11-03): a farmacia already operating must be able to change its CUIT. The
consequence R2 protected against (signed documents reprinted with another CUIT) is accepted and explained by the
R6 warning.

**Migration**: drop the trigger `fsj.tenant_cuit_antes_primer_cierre` and its function in a new migration (keep
`GRANT UPDATE (cuit)` from 0105); remove the `tenantTieneCierreDiario` check from `editarDatosTenant`.

### Requirement: R3 — Read-only after the first cierre

**Reason**: Without R2 the CUIT never becomes read-only. Replaced by R6 (field always shown, with a warning).

**Migration**: remove `cuitEditable` from `getDatosTenant`, the form and the page; drop the CUIT `DatoFijo` from
"Datos no editables".

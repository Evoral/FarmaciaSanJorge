## MODIFIED Requirements

### Requirement: P8 — Pharmacy list

`/plataforma` SHALL list the pharmacies 25 per page, searchable by razón social, nombre de fantasía or CUIT, showing nombre, CUIT, estado and saldo, ordered by razón social. Dadas de baja (`fecha_baja`) have their own badge. A pharmacy with an open integrity incident SHALL show an "Integridad" badge linking to its incidents section, fed only by `fsj.plataforma_incidentes_integridad` (P18).

#### Scenario: Search by CUIT
- **WHEN** the superadmin searches "30-12345678"
- **THEN** only pharmacies whose CUIT contains it are listed, with their saldo

#### Scenario: Pharmacy with an open incident
- **GIVEN** a pharmacy with an open integrity incident
- **WHEN** the superadmin opens `/plataforma`
- **THEN** its row shows the integrity badge

#### Scenario: Only resolved incidents
- **GIVEN** a pharmacy whose incidents are all resolved
- **WHEN** the superadmin opens `/plataforma`
- **THEN** its row shows no integrity badge

#### Scenario: Suspended pharmacy with an open incident
- **GIVEN** a SUSPENDIDO pharmacy that kept an open incident
- **WHEN** the superadmin opens `/plataforma`
- **THEN** the row shows both the suspended estado and the integrity badge

### Requirement: P9 — Pharmacy detail

`/plataforma/farmacias/[id]` SHALL show the `fsj.tenant` datos (razón social, nombre de fantasía, CUIT, domicilio, matrícula, zona horaria, creada, estado), the contacto, the saldo, the cuenta corriente (cargos and pagos ordered by fecha, anulados shown struck through with who, when and motivo), the platform audit rows of that pharmacy and its integrity incidents (P17). It MUST NOT read any tenant-scoped table, with one exception: the integrity incidents, read only through the `SECURITY DEFINER` function `fsj.plataforma_incidentes_integridad`, which MUST validate the platform session first (P6, `INV-PLAT-AUTH`) and return only the columns listed in P18. No other function, view or query from `/plataforma` may read a tenant-scoped table.

#### Scenario: Unknown id
- **WHEN** the superadmin opens a detail with an id that is not a tenant
- **THEN** it gets "not found"

#### Scenario: Detail reads nothing else from the tenant
- **WHEN** the superadmin opens the detail of any pharmacy
- **THEN** the only tenant-scoped data reached is the output of `fsj.plataforma_incidentes_integridad`; no asiento, paciente, receta or stock row is read

## ADDED Requirements

### Requirement: P17 — Integrity incidents of a pharmacy

The pharmacy detail SHALL include an "Integridad del libro" section listing its integrity incidents, open first, then resolved, newest first. Each item SHALL show only: libro tipo, número of the first broken asiento, first and last detection dates, number of detections, and estado (ABIERTO, or RESUELTO with its date).

#### Scenario: Pharmacy with an open and a resolved incident
- **GIVEN** a pharmacy with one open incident (asiento 120, 3 detections) and one resolved incident
- **WHEN** the superadmin opens its detail
- **THEN** the section lists the open one first with ABIERTO, libro tipo, número 120, both dates and 3 detections, then the resolved one with its resolution date

#### Scenario: Pharmacy without incidents
- **WHEN** the superadmin opens the detail of a pharmacy that never had an incident
- **THEN** the section says there are no incidents and shows the limitation note

#### Scenario: Incident resolved by reanclaje
- **GIVEN** an incident that the pharmacy's DT resolved by reanclaje
- **WHEN** the superadmin opens the detail
- **THEN** it is listed as RESUELTO with `resuelto_en`, and no badge appears in the list unless another incident is open

#### Scenario: Pharmacy without incidents note
- **GIVEN** a pharmacy with no incidents
- **WHEN** the superadmin opens its detail
- **THEN** the section also states that incidents appear only when a pharmacy user with access to the libro navigates the app, so their absence is not proof of integrity

### Requirement: P18 — Incidents are read only through a guarded function

Incidents SHALL be read only through `fsj.plataforma_incidentes_integridad(p_token_hash, ...)`, `SECURITY DEFINER`, `SET search_path = fsj, extensions`, not granted to PUBLIC, used by both the list badge and the detail. It MUST first validate the session via `fsj.plataforma_actor` (else `INV-PLAT-AUTH`) and MUST return only incident id, tenant id, libro tipo, número, dates, detection count and resolution date, never asiento, hash, paciente or médico data.

#### Scenario: Superadmin session dead
- **GIVEN** a platform session that expired, was revoked, or whose superadmin is INACTIVO
- **WHEN** the function is called with its token hash
- **THEN** it raises `INV-PLAT-AUTH`, returns no rows, and the user is sent to `/login`

#### Scenario: Guard forgotten in TS
- **GIVEN** a use case that called the function without `requireSuperAdmin()`
- **WHEN** it passes an invalid token hash
- **THEN** the database raises `INV-PLAT-AUTH` and nothing is returned

#### Scenario: Function output is fixed
- **WHEN** the function returns rows for a pharmacy
- **THEN** each row has only incident id, tenant id, libro tipo, número, first and last detection dates, detection count and resolution date; the ids are identifiers, not tenant content

#### Scenario: Unknown tenant id
- **WHEN** the function receives an id that is not a tenant
- **THEN** it returns no rows, and the page answers "not found" as in P9

#### Scenario: Pharmacy user
- **GIVEN** a usuario logged in to a pharmacy
- **WHEN** it tries to call the function or open the section
- **THEN** it has no access: `/plataforma` answers "not found" (P5), and a tenant session token hash fails the function's own session validation with `INV-PLAT-AUTH`

#### Scenario: Only open incidents for the list
- **GIVEN** a pharmacy with only resolved incidents
- **WHEN** the list asks the function for open incidents of the page's pharmacies
- **THEN** no row is returned for it and it gets no badge

### Requirement: P19 — Incidents section is view-only

The superadmin SHALL NOT be able to annotate, acknowledge or close an incident. This feature adds no platform write and writes no `fsj.plataforma_auditoria` row, so P7 is unchanged.

#### Scenario: No write actions
- **WHEN** the superadmin opens the incidents section
- **THEN** it offers no control that changes an incident, and viewing it writes no platform audit row

#### Scenario: Suspended pharmacy
- **GIVEN** a SUSPENDIDO pharmacy that has incidents
- **WHEN** the superadmin opens its detail
- **THEN** the incidents are shown as for any pharmacy; suspension does not hide them and no new detections are added while it has no sessions

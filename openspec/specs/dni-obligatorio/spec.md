# DNI obligatorio y normalizado

## Purpose

The DNI is what tells two pacientes apart, so a new paciente cannot be loaded without one. Every DNI (paciente or
usuario) is stored digits only, so "12.345.678" and "12345678" are the same person and collide on the uniqueness
checks. Code: `shared/validation/dni.ts`, `modules/pacientes/domain/paciente.ts` (`dniObligatorio`, `dniOpcional`),
`modules/pacientes/application/crear-paciente.ts` (`altaPacienteInput`), `modules/usuarios/application/crear-usuario.ts`,
`modules/usuarios/application/editar-usuario.ts`.

## Requirements

### Requirement: R1 — The alta of a paciente requires the DNI

The alta oficial (`/clientes`, `pacientes.crear`) and the alta dinámica of the receta flow
(`modules/recetas/ui/paciente-picker.tsx`, `pacientes.crear-desde-receta`) MUST refuse a paciente without a DNI,
marking the DNI field ("Ingresá el DNI del paciente.") and keeping the rest of the input.

#### Scenario: Alta without DNI

- **WHEN** the user creates a paciente from `/clientes` or from the receta's paciente picker with the DNI empty
- **THEN** no paciente is created and the DNI field is marked

### Requirement: R4 — The receta import asks the DNI only for a new paciente

The receta import (PDF/QR) is never blocked by a missing DNI: matching an existing paciente works without one. When it
creates a new paciente and the document brings no DNI, the confirmation MUST show a mandatory DNI field (`pacienteDni`)
and refuse to confirm without it. A typed DNI of another paciente is refused on that field.

#### Scenario: Import of a new paciente whose document brings no DNI

- **GIVEN** a receta read from a PDF/QR without DNI, whose paciente matches no existing one
- **WHEN** the user confirms the import with the DNI field empty
- **THEN** nothing is imported and the DNI field is marked
- **AND** once the DNI is typed, the import creates the paciente with it

### Requirement: R2 — A DNI, once set, is never removed

The edición of a paciente that has a DNI MUST refuse to clear it; it can be corrected. A paciente without a DNI can be
edited without adding one.

#### Scenario: Clearing an existing DNI

- **GIVEN** a paciente with DNI 12345678
- **WHEN** the user saves its edición with the DNI empty
- **THEN** the edición is refused and the DNI field is marked

### Requirement: R3 — Every DNI is stored digits only

A DNI typed for a paciente or a usuario (not a cuenta de sector, whose DNI is derived) SHALL be stripped of every
non-digit character before it is validated (7 or 8 digits), compared for uniqueness and stored.

#### Scenario: Dotted DNI

- **GIVEN** a usuario of the farmacia with DNI 12345678
- **WHEN** another usuario is created with DNI "12.345.678"
- **THEN** it is refused as a duplicate DNI

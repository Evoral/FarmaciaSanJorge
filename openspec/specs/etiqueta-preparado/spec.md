# Etiqueta del preparado

## Purpose

What the printed label of a CONFIRMADA preparación says and how it is laid out: a copy of the farmacia's real
label, from a reference provided by the farmacia on 2026-10-19 (later decisions dated 2026-10-22). Placement on the
printed sheet is governed by `openspec/specs/hoja-etiquetas/spec.md` (see `## Placement`).

## Requirements

### Requirement: Copy of the farmacia's real label

The printed label of a CONFIRMADA preparación SHALL be a copy of the farmacia's real label (reference provided by
the farmacia on 2026-10-19). Earlier rules (DP-28, `openspec/specs/vencimiento-preparado/spec.md` R7, the Rp/
columns) still apply.

#### Scenario: Etiqueta printed

- **WHEN** the etiqueta of a CONFIRMADA preparación is printed
- **THEN** it follows the farmacia's real label and the earlier rules (DP-28, vencimiento-preparado R7, the Rp/ columns)

### Requirement: R1 — Layout: border and top band

Layout: the etiqueta SHALL have a rounded border; a top band with the tenant's own logo
(`openspec/specs/logo-farmacia/spec.md` R6; none -> no logo) and, across a vertical rule, the director técnico, the
domicilio and the two phones (☎ fijo, WhatsApp celular).

#### Scenario: Tenant with a logo

- **GIVEN** a tenant with its own logo
- **WHEN** the etiqueta is printed
- **THEN** the top band shows the logo and, across a vertical rule, the director técnico, the domicilio and the two phones (☎ fijo, WhatsApp celular)

#### Scenario: Tenant without a logo

- **GIVEN** a tenant without a logo
- **WHEN** the etiqueta is printed
- **THEN** the top band has no logo

### Requirement: R1 — Layout: Rp/, the right column and the footer

Below the R1 top band, the etiqueta SHALL show "Rp/" with the fórmula on the left; on the right the paciente,
"Receta N:", "Dosis:", the quantity as a large green number with its forma / vía / fracción de dosis, "Vence:" and
the storage note in red; the médico in the footer.

#### Scenario: Body of the etiqueta

- **WHEN** the etiqueta is printed
- **THEN** "Rp/" and the fórmula are on the left
- **AND** the paciente, "Receta N:", "Dosis:", the quantity as a large green number with its forma / vía / fracción de dosis, "Vence:" and the storage note in red are on the right
- **AND** the médico is in the footer

### Requirement: R2 — Fixed places

Every field SHALL have a fixed place. A missing field leaves its place blank and never moves another one; a long
text shrinks to fit its place (the dosis wraps up to 4 lines in its column).

#### Scenario: Missing field

- **GIVEN** a preparación without a celular phone
- **WHEN** the etiqueta is printed
- **THEN** the celular's place is blank and no other field moves

#### Scenario: Long text

- **WHEN** a field's text does not fit its place
- **THEN** it shrinks to fit

#### Scenario: Long dosis

- **WHEN** the dosis is long
- **THEN** it wraps up to 4 lines in its column

### Requirement: R3 — Phones of the farmacia

The phones SHALL be the farmacia's `tenant.telefono_fijo` / `telefono_celular` (migration 0089), edited in
Configuración → Farmacia.

#### Scenario: Phones edited

- **WHEN** a user with `config.editar` edits the phones in Configuración → Farmacia
- **THEN** etiquetas generated afterwards print them

### Requirement: R4 — Dosis as units per day

"Dosis:" SHALL be the units to take per day, as the paciente reads it: "Media dosis cada 12 horas" with ½-dose
cápsulas prints "2 cáp/día". Units per toma = doses per toma ("media dosis" = 0.5, else 1) /
`fraccion_dosis_por_unidad`, times the tomas per day ("cada N horas" → 24 / N, "N veces al día" → N;
`tomasPorDiaDePosologia`).

#### Scenario: Media dosis cada 12 horas

- **GIVEN** ½-dose cápsulas
- **WHEN** the posología is "Media dosis cada 12 horas"
- **THEN** "Dosis:" prints "2 cáp/día"

#### Scenario: N veces al día

- **GIVEN** cápsulas with `fraccion_dosis_por_unidad` 1
- **WHEN** the posología is "3 veces al día"
- **THEN** "Dosis:" prints "3 cáp/día" (1 dose per toma / 1 × 3 tomas)

### Requirement: R4 — Posología as written, and the fracción

When the form is not counted in units or the posología states no frequency, the R4 "Dosis:" SHALL print the
posología as written (`dosisEtiqueta`). The fracción ("1/2 Dosis") comes from `fraccion_dosis_por_unidad` < 1, only
for forms counted in units (cápsulas, comprimidos, óvulos, supositorios).

#### Scenario: Crema

- **WHEN** the etiqueta of a crema is printed
- **THEN** "Dosis:" prints the posología as written

#### Scenario: No frequency

- **GIVEN** cápsulas whose posología states no frequency
- **WHEN** the etiqueta is printed
- **THEN** "Dosis:" prints the posología as written

#### Scenario: Half-dose cápsulas

- **GIVEN** cápsulas with `fraccion_dosis_por_unidad` 0.5
- **WHEN** the etiqueta is printed
- **THEN** it prints the fracción "1/2 Dosis"

#### Scenario: Whole-dose cápsulas

- **GIVEN** cápsulas with `fraccion_dosis_por_unidad` 1
- **WHEN** the etiqueta is printed
- **THEN** no fracción is printed

### Requirement: R5 — Paciente printed

The paciente SHALL be printed ("Paciente:" + the asiento's paciente text).

#### Scenario: Asiento with a paciente

- **WHEN** the etiqueta is printed
- **THEN** it prints "Paciente:" followed by the asiento's paciente text

### Requirement: R6 — Médico line

The médico SHALL print as "Médico: Nombre Apellido  -  MAT:número", without the MP/MN prefix (as on the real label).

#### Scenario: Médico with an MP matrícula

- **GIVEN** a médico with an MP matrícula
- **WHEN** the etiqueta is printed
- **THEN** the footer prints "Médico: Nombre Apellido  -  MAT:número" without "MP"

### Requirement: R8 — Director técnico is the titular

The director técnico SHALL ALWAYS be the TITULAR, with the matrícula of his designación -- never a suplente
(2026-10-19: the titular is in charge of everything). The titular vigente on the confirmation day; if there was
none that day, the current titular.

#### Scenario: Suplente on duty

- **GIVEN** a confirmation on a day a suplente was on duty and a titular was vigente
- **WHEN** the etiqueta is generated
- **THEN** it prints the titular with the matrícula of his designación

#### Scenario: No titular on the confirmation day

- **GIVEN** no titular vigente on the confirmation day
- **WHEN** the etiqueta is generated
- **THEN** it prints the current titular

### Requirement: R7 — New fields in the snapshot

The new fields SHALL be part of the persisted `etiqueta.contenido` snapshot (optional lines `Teléfono fijo`,
`Celular`, `Dosis:`, `Por unidad:`, and `Paciente`). A snapshot stored before this change still parses: it simply
prints without them.

#### Scenario: Etiqueta generated

- **WHEN** an etiqueta is generated
- **THEN** its `etiqueta.contenido` includes the lines `Teléfono fijo`, `Celular`, `Dosis:`, `Por unidad:` and `Paciente` that apply

#### Scenario: Older snapshot

- **GIVEN** an `etiqueta.contenido` stored before this change
- **WHEN** it is reprinted
- **THEN** it parses and prints without the new fields

### Requirement: R9 — Psicotrópico marked in Rp/

A psicotrópico in "Rp/" SHALL be marked next to its name: "Clonazepam (ps) 0,3 mg" (user decision, 2026-10-22). It
follows the droga's current `tipo_control` = PSICOTROPICO when the etiqueta is generated (estupefacientes are not
marked); it is part of the stored `contenido`, so an etiqueta generated before keeps printing without it.

#### Scenario: Clonazepam

- **GIVEN** Clonazepam 0,3 mg with `tipo_control` = PSICOTROPICO
- **WHEN** the etiqueta is generated
- **THEN** "Rp/" prints "Clonazepam (ps) 0,3 mg"

#### Scenario: Estupefaciente

- **WHEN** the etiqueta of a fórmula with an estupefaciente is generated
- **THEN** the estupefaciente is not marked

#### Scenario: Etiqueta generated before

- **GIVEN** an etiqueta generated before this rule
- **WHEN** it is reprinted
- **THEN** it prints without the mark

## Placement

Placement on the printed page (the PDF is the sheet, the label goes in a chosen cell): `openspec/specs/hoja-etiquetas/spec.md`. This spec only governs what the label says and how it is laid out.

## Code

| # | Code |
|---|---|
| R1 | `modules/preparaciones/infrastructure/etiqueta-pdf.ts` |
| R2 | same |
| R3 | `modules/farmacia` |
| R4 | `modules/preparaciones/domain/etiqueta.ts` (`fraccionDosisEtiqueta`) |
| R5 | `MOSTRAR_PACIENTE_EN_ETIQUETA` |
| R6 | `formatearMedicoEtiqueta` |
| R8 | `getDtTitularParaEtiqueta` (preparacion-repository) |
| R7 | `formatearContenidoEtiqueta`, `parsearContenidoEtiqueta` |
| R9 | `formatearLineaRp` (`domain/etiqueta.ts`), `getPreparacionParaEtiqueta` |

## Rollback

Rollback: `docs/rollbacks/etiqueta-preparado.md`.

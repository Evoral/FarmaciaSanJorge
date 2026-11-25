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
"N° <número>", "Dosis:", the quantity as a large green number with its forma / vía / fracción de dosis, "Vence:" and
the storage note in red; the médico in the footer.

#### Scenario: Body of the etiqueta

- **WHEN** the etiqueta is printed
- **THEN** "Rp/" and the fórmula are on the left
- **AND** the paciente, "N° <número>", "Dosis:", the quantity as a large green number with its forma / vía / fracción de dosis, "Vence:" and the storage note in red are on the right
- **AND** the médico is in the footer

### Requirement: R2 — Fixed places

Every field SHALL have a fixed place. A missing field leaves its place blank and never moves another one; a long
text shrinks to fit its place (the dosis wraps up to 4 lines in its column). Exception (2026-11-11): the forma / vía /
fracción lines present are centered, as a block, on the large quantity's height. Exception (2026-11-18): the R13
wide design's info column is stacked.

#### Scenario: Wide design without dosis

- **GIVEN** the R13 wide design and a preparación without dosis
- **WHEN** the etiqueta is printed
- **THEN** the paciente / vencimiento column is stacked from the top and the paciente grows into the room left

#### Scenario: Forma alone beside the quantity

- **GIVEN** a suspensión with no vía nor fracción line
- **WHEN** the etiqueta is printed
- **THEN** "Suspensión" is centered on the height of the large quantity, not at the top of its place

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

The paciente SHALL be printed ("Paciente:" + the asiento's paciente text). The compact designs (R13) print the
paciente without the "Paciente:" label.

#### Scenario: Asiento with a paciente

- **WHEN** the etiqueta is printed
- **THEN** it prints "Paciente:" followed by the asiento's paciente text

### Requirement: R6 — Médico line

The médico SHALL print as "Médico: Nombre Apellido  -  MAT:número", without the MP/MN prefix (as on the real label).
On every layout (`lineaPrioritaria` + `variantesMedico`), when the full line would shrink below 5 design points to fit
its width, it SHALL fall back to "Nombre Apellido  -  MAT:número"; if still below 5 pt, it SHALL print
"Nombre Apellido" only, shrunk to fit (user decision 2026-11-18: "que el médico se vea aunque sea un dato matrícula o
nombre"). The médico is never dropped.

#### Scenario: Médico with an MP matrícula

- **GIVEN** a médico with an MP matrícula
- **WHEN** the etiqueta is printed
- **THEN** the footer prints "Médico: Nombre Apellido  -  MAT:número" without "MP"

#### Scenario: Fallback when space is tight

- **GIVEN** a label size where the full médico line would shrink below 5 design points
- **WHEN** the etiqueta is printed
- **THEN** it prints "Nombre Apellido  -  MAT:número" without the "Médico:" label
- **AND** if that still shrinks below 5 pt, it prints "Nombre Apellido" only, shrunk to fit
- **AND** the médico is never dropped

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

### Requirement: R10 — Excipientes on the etiqueta

The etiqueta SHALL optionally declare excipientes in "Rp/" to satisfy the legal obligation to declare them
(optional per tenant). When on, "Rp/" lists the principios activos, then the excipientes suffixed ` (excipiente)`
(`MARCA_EXCIPIENTE`): (a) componentes left out of Rp/ (in `ordenarComponentes` order), (b)
`preparacion.excipiente_texto`, (c) ADICIONAL insumos of clase EXCIPIENTE. Identical lines appear once; the
14-line Rp/ cap applies (`columnasRp`).

#### Scenario: Switch on at confirmation

- **GIVEN** a receta with an active drug and excipientes (a componente left out of Rp/, an excipiente used, or an adicional excipiente)
- **WHEN** the user confirms the receta with "Incluir excipientes en la etiqueta" on
- **THEN** "Rp/" prints the principios activos followed by the excipientes, each suffixed with " (excipiente)"
- **AND** identical excipiente lines are listed once

#### Scenario: 14-line Rp/ cap with excipientes

- **GIVEN** a fórmula whose activos and excipientes exceed 14 lines in total
- **WHEN** the etiqueta is generated with excipientes included
- **THEN** the printed "Rp/" is capped at 14 lines, showing the first 13 lines and "… y N más" in the last slot

#### Scenario: Switch off at confirmation

- **WHEN** the user confirms the receta with "Incluir excipientes en la etiqueta" off
- **THEN** Rp/ is the same as without the switch (componentesRp): no line is marked (excipiente)

### Requirement: R10 — Toma workspace switch

The toma workspace (`/preparaciones/recetas/[recetaId]`) SHALL show ONE switch "Incluir excipientes en la etiqueta",
in a box on the left of the "Imprimir etiquetas" panel, ONLY while there are ítems to confirm. It starts at the
tenant default and is sent with the confirmation (`incluirExcipientes` "1"/"0"; missing = tenant default). The
confirmation's audit SHALL record `etiquetaConExcipientes` (only when the form sent the field).

#### Scenario: Toma workspace with ítems to confirm

- **GIVEN** a receta with ítems to confirm
- **WHEN** the user opens the toma workspace (/preparaciones/recetas/[recetaId])
- **THEN** the switch "Incluir excipientes en la etiqueta" is shown in a box on the left of the "Imprimir etiquetas" panel
- **AND** it starts at the tenant default

#### Scenario: Confirmation audit records setting when sent

- **WHEN** the confirmation form sends `incluirExcipientes`
- **THEN** the confirmation audit records `etiquetaConExcipientes` with that boolean value

#### Scenario: Confirmation audit omits setting when missing

- **WHEN** the confirmation form omits `incluirExcipientes`
- **THEN** the confirmation audit does not record `etiquetaConExcipientes`

### Requirement: R10 — Fixed snapshot and default outside toma

The choice SHALL be fixed when the etiqueta is generated (stored as part of the `etiqueta.contenido` snapshot):
reprints show the same content and do not offer the switch; changing the default never alters generated etiquetas.
An etiqueta generated outside the toma (`/preparaciones/[id]`, `generarEtiqueta`) SHALL use the tenant default.

#### Scenario: Reprint does not offer switch

- **GIVEN** a receta with all ítems confirmed
- **WHEN** the user opens the toma workspace or reprints an etiqueta
- **THEN** the switch is not shown
- **AND** the etiqueta prints with the content snapshot fixed at generation

#### Scenario: Etiqueta generated outside the toma

- **WHEN** an etiqueta is generated outside the toma (/preparaciones/[id], `generarEtiqueta`)
- **THEN** it includes excipientes if and only if the tenant default is turned on

### Requirement: R11 — Quantity of forms not counted in units

A form not counted in units (crema, gel, jarabe, solución, suspensión...) SHALL print as its quantity the ítem's
"Cantidad de ... a preparar" as loaded in the receta (`item_receta.cantidad_total` and its unit), with the forma and
vía in singular. Forms counted in units (cápsulas, comprimidos, óvulos, supositorios), or a form with no cantidad
total loaded, keep the unit count. The snapshot line reads "Cantidad: 100 g — Crema — Uso externo".

#### Scenario: Crema with a cantidad a preparar

- **GIVEN** a crema whose "Cantidad de crema a preparar" is 100 g
- **WHEN** the etiqueta is printed
- **THEN** the large quantity prints "100 g" with "Crema" and "Uso externo"

#### Scenario: Cápsulas keep the unit count

- **GIVEN** 30 cápsulas
- **WHEN** the etiqueta is printed
- **THEN** the large quantity prints "30" with "Cápsulas"

### Requirement: R12 — Rp/ fills its blank area

The fórmula SHALL use the blank area left of the panel with a minimal margin (user decision, 2026-11-11). The Rp/ block
is CENTERED in its area on every layout: leftover width is shared equally before, between and after columns
(`distribuirColumnasRp`, n+1 equal gaps); vertical centering is unchanged. With two columns (`columnasRp`), each
column SHALL be as wide as its own widest line; the one font size shrinks only as needed to fit width and height.

#### Scenario: One long line among many drugs

- **GIVEN** a fórmula in two columns where one line is much longer than the rest
- **WHEN** the etiqueta is printed
- **THEN** the column with the long line is wider than the other one
- **AND** the font is larger than if both columns had half the width each

#### Scenario: Minimal margin

- **WHEN** the etiqueta is printed
- **THEN** the fórmula starts just inside the frame and reaches just short of the panel's rule and the footer's rule

#### Scenario: Short columns

- **GIVEN** one or two short lines
- **WHEN** the etiqueta is printed
- **THEN** the block sits centered horizontally and vertically in the area

#### Scenario: Wide fórmula

- **GIVEN** a fórmula as wide as the area
- **WHEN** the etiqueta is printed
- **THEN** it keeps no side gap

### Requirement: R14 — Solución de uso interno o externo

A solución SHALL be loaded as "Solución uso interno" or "Solución uso externo"; every solución loaded before
2026-11-25 is uso interno (migration 0135). Its etiqueta SHALL read "Solución" as forma and "Uso interno" / "Uso
externo" as vía. The fondo rojo configuration (hoja-etiquetas R16) SHALL list both formas separately.

#### Scenario: Solución de uso externo en rojo

- **GIVEN** "Solución uso externo" configured to print on a red background
- **WHEN** the etiqueta of a 100 mL solución de uso externo is printed
- **THEN** it reads "100 mL", "Solución", "Uso externo" on the red background, and a solución de uso interno prints white

### Requirement: R12 — Rp/ condensed before it shrinks

When the width, not the height, limits the fórmula's size, its type SHALL first get narrower (at most 15 % narrower,
`CONDENSACION_MINIMA_RP`) so it grows toward what the free height allows. Every drug stays on one line; a fórmula that
already fits, or one limited by its height, is not condensed (user decision, 2026-11-25).

#### Scenario: Long line with free height

- **GIVEN** a 100 × 42 mm etiqueta whose fórmula has one long drug line and half the area's height free
- **WHEN** the etiqueta is printed
- **THEN** the fórmula's type is narrower and larger than without condensing, and each drug is still on one line

### Requirement: R13 — Compact designs for very wide or very tall sizes

The design SHALL be chosen by aspect ratio (ancho/alto) closest on a log scale (`disposicionCompacta`): classic 100 × 42
(2.38), WIDE 100 × 25 (4, ratio ≥ 3.09), or TALL 50 × 60 (0.83, ratio ≤ 1.41) (user decision 2026-11-18). Standard
proportions (80 × 30, 100 × 42) and elaborated lots keep classic design. No field is dropped; domicilio and phones
shrink first. WIDE and TALL designs adapt layout and hierarchy to fit extreme dimensions while preserving readability.

#### Scenario: 60 × 15 → wide

- **GIVEN** a 60 × 15 label size (aspect ratio 4.0 ≥ 3.09)
- **WHEN** the etiqueta is printed
- **THEN** it selects the WIDE compact design (100 × 25 mm)
- **AND** the top band shows the logo, the DT name bold and large with " - MAT. x" (DT label drops before name shrinks; matrícula never drops), and domicilio + "Tel. … · Cel. …" in one small line
- **AND** Rp/ sits on the left beside its mark
- **AND** the panel shows the large green quantity with forma/vía/fracción, the paciente without "Paciente:" in up to two large lines, "Vence: …" bold and large with "N° x" small on the same baseline, dosis (up to 2 lines), and storage note in red at the bottom
- **AND** the médico runs across the whole footer

#### Scenario: 40 × 60 → tall

- **GIVEN** a 40 × 60 label size (aspect ratio 0.67 ≤ 1.41)
- **WHEN** the etiqueta is printed
- **THEN** it selects the TALL compact design (50 × 60 mm)
- **AND** everything is stacked and centered: logo, DT name bold on its own line, "Director Técnico · MAT. x" under it, domicilio, phones
- **AND** Rp/ spans across the full width
- **AND** paciente (bold, no "Paciente:"), "N° x · Vence: …", quantity with its forma, dosis, and storage note are stacked
- **AND** the médico is in the footer

#### Scenario: 80 × 30 → classic

- **GIVEN** an 80 × 30 label size (aspect ratio 2.67)
- **WHEN** the etiqueta is printed
- **THEN** it keeps the classic 100 × 42 design

#### Scenario: Paciente with a comma in two lines

- **GIVEN** a WIDE compact design and a paciente with a comma ("Martínez, Sofía")
- **WHEN** the etiqueta is printed
- **THEN** the paciente is split at the comma into two lines ("Martínez," / "Sofía") without the "Paciente:" label
- **AND** it is printed as large as the room allows (max 10 pt)

#### Scenario: No DT name drop of matrícula

- **GIVEN** a compact design where space for the director técnico is constrained
- **WHEN** the line shrinks below 5 design points
- **THEN** the "Director Técnico" label drops to keep the name legible
- **AND** the matrícula is never dropped

#### Scenario: Médico fallback on wide

- **GIVEN** a WIDE compact design where the full médico line would shrink below 5 design points
- **WHEN** the etiqueta is printed
- **THEN** it prints "Nombre Apellido  -  MAT:número" across the whole footer
- **AND** if still below 5 pt, it prints "Nombre Apellido" only, shrunk to fit
- **AND** the médico is never dropped

## Placement

Placement on the printed page (the PDF is the sheet, the label goes in a chosen cell): `openspec/specs/hoja-etiquetas/spec.md`. This spec only governs what the label says and how it is laid out.

## Code

| # | Code |
|---|---|
| R1 | `modules/preparaciones/infrastructure/etiqueta-pdf.ts`, `etiqueta-pdf-trazos.ts` |
| R2 | same |
| R3 | `modules/farmacia` |
| R4 | `modules/preparaciones/domain/etiqueta.ts` (`fraccionDosisEtiqueta`) |
| R5 | `MOSTRAR_PACIENTE_EN_ETIQUETA` |
| R6 | `formatearMedicoEtiqueta`, `modules/preparaciones/infrastructure/etiqueta-pdf-trazos.ts` (`variantesMedico`, `lineaPrioritaria`) |
| R8 | `getDtTitularParaEtiqueta` (preparacion-repository) |
| R7 | `formatearContenidoEtiqueta`, `parsearContenidoEtiqueta` |
| R9 | `formatearLineaRp` (`domain/etiqueta.ts`), `getPreparacionParaEtiqueta` |
| R11 | `cantidadTotalEtiqueta`, `armarContenidoEtiqueta`, `formatearContenidoEtiqueta`, `parsearContenidoEtiqueta` (`domain/etiqueta.ts`), `getPreparacionParaEtiqueta`, `etiqueta-pdf.ts` (`dibujarPanel`) |
| R10 | `modules/preparaciones/domain/etiqueta.ts` (`MARCA_EXCIPIENTE`, `lineasExcipientesRp`, `OpcionesEtiqueta`, `armarContenidoEtiqueta`), `modules/preparaciones/application/generar-etiqueta.ts`, `confirmar-reservas-receta.ts`, `modules/preparaciones/infrastructure/preparacion-repository.ts` (`getPreparacionParaEtiqueta`, `getIncluirExcipientesEnEtiqueta`), `modules/preparaciones/ui/reserva-acciones.tsx` (`EtiquetasDeReceta`), `imprimir-etiqueta-dialog.tsx`, `actions.ts` (`confirmarReservasRecetaAction`) |
| R12 | `modules/preparaciones/infrastructure/etiqueta-pdf-trazos.ts` (`distribuirColumnasRp`, `dibujarFormula`), `etiqueta-pdf.ts` (`AREA_RP`, `distribuirColumnasRp`, `dibujarRp`) |
| R13 | `modules/preparaciones/infrastructure/etiqueta-pdf-compacta.ts` (`disposicionCompacta`, `dibujarApaisada`, `dibujarAlta`, `lineasPaciente`, `variantesDt`), `etiqueta-pdf.ts` (`dibujarEtiqueta` picks the design, `colocarEtiqueta` takes the design space) |

## Rollback

Rollback: `docs/rollbacks/etiqueta-preparado.md`.

## ADDED Requirements

All of `openspec/specs/insumos-preparacion/spec.md` (I1-I12) is new in this change; it is merged there already. Summary:

### Requirement: I1 — Material row in the ficha
A "Material" row SHALL show under the excipiente with a buscador of the vigente drogas of clase MATERIAL and its quantity in the droga's unidad base.

#### Scenario: Material chosen
- **WHEN** the user chooses a material
- **THEN** its quantity is typed in the droga's unidad base, shown with that unidad's symbol

### Requirement: I2 — Cápsulas pre-fill
For a CAPSULA ítem the Material's quantity SHALL be pre-filled with the number of cápsulas, no material chosen; a quantity without a material MUST be ignored.

#### Scenario: No cápsula chosen
- **GIVEN** the cápsulas' quantity pre-filled and no material chosen
- **WHEN** the ítem is marked as preparada
- **THEN** nothing is refused and no material stock is reserved

### Requirement: I3 — Agregar insumo
"Agregar insumo" SHALL add any number of rows with a buscador of clase EXCIPIENTE or MATERIAL, each removable while not reserved.

#### Scenario: Extra insumo
- **WHEN** the user presses "Agregar insumo" and chooses a droga
- **THEN** a row with that droga and its quantity field is added

### Requirement: I4-I12 — Same mechanics as the excipiente
The insumos SHALL be saved as filled in, require their quantity once chosen, be reserved, re-planned, descontado and released like the excipiente; a droga MUST NOT repeat across excipiente + material + adicionales; EXCIPIENTE adicionales go into the libro's fórmula, materials never.

#### Scenario: Same droga as the excipiente
- **GIVEN** Ludipress chosen as excipiente
- **WHEN** Ludipress is sent as an insumo adicional
- **THEN** it is refused with a clear message

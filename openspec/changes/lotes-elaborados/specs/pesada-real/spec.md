## ADDED Requirements

### Requirement: P13 — Dose below the balance

When a non-manual MASA línea's physical weight is below one balance division, the system SHALL NOT limit it: pesada real SHALL be prefilled with the exact esperada and the form SHALL offer a diluted lot or creating one. "Crear dilución" SHALL open the dialog in-place, preserve typed data, and pick the new lot on success. The button SHALL require permiso `stock.lote.elaborar` (`DatosConfirmacion.puedeElaborarLote`). P3 is unchanged.

#### Scenario: Exact precarga

- **GIVEN** a 0,001 g balance and an esperada of 0,00015 g from a lot at 100 %
- **WHEN** the línea is shown
- **THEN** the pesada real is prefilled with 0,15 mg, not 0
- **AND** the form offers "usar lote diluido" or "crear dilución" (when the user has permiso `stock.lote.elaborar`)

#### Scenario: Crear dilución opens dialog without leaving pesaje

- **GIVEN** a línea below the balance division and a user with `stock.lote.elaborar`
- **WHEN** the user clicks "crear dilución"
- **THEN** the "Elaborar lote" dialog opens without leaving the pesaje
- **AND** all existing typed values in the pesaje form are preserved
- **AND** on successful elaboration, the newly created diluted lot is automatically chosen for that línea

#### Scenario: Diluted in the moment

- **GIVEN** the same línea
- **WHEN** the preparer weighs 1 mg of the droga onto the excipiente and types 1 mg
- **THEN** it is accepted under P3 and 1 mg of the droga is consumed

#### Scenario: From a diluted lot

- **GIVEN** the same dose and a lot of the droga at 0,1 %
- **WHEN** that lot is chosen
- **THEN** the esperada is 0,15 g and P3 applies as usual

## MODIFIED Requirements

### Requirement: Triturados and diluciones

A trituración/dilución SHALL be done either in the moment (the droga consumed is its real weighing, P13) or elaborated beforehand as a diluted lot of the droga (elaboracion-lote EL2), weighed like any partida with its potencia. The preparer decides.

#### Scenario: Dilución in the moment

- **WHEN** a droga is diluted on top of excipiente while preparing
- **THEN** no separate stock is created and the droga consumed is its real weighing

#### Scenario: Dilución as a lot

- **GIVEN** a partida of the droga elaborated as a dilución at 1 %
- **WHEN** it is chosen for a línea
- **THEN** the physical weight is the active x 100

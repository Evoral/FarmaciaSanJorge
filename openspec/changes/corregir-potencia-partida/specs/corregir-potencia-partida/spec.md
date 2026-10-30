# Spec: Corregir pureza de una partida

## ADDED Requirements

### Requirement: CP1 — Edición de pureza con motivo obligatorio

The command `corregirPotenciaPartida` SHALL allow updating `potencia_declarada` on an existing partida of the tenant. It SHALL require the permission `stock.partida.potencia.corregir`, a valid percentage (`0 < p <= 100`, or empty to reset to no-correction / 100%), and a non-empty `motivo`.

#### Scenario: Corrección válida de pureza
- **GIVEN** a user with the permission `stock.partida.potencia.corregir` and an existing partida with 100% purity
- **WHEN** the user submits a new purity of 98.5% with the motivo "Error de tipeo en el ingreso de factura"
- **THEN** the partida's `potencia_declarada` is updated to 98.5

#### Scenario: Restablecimiento a 100% (sin corrección)
- **GIVEN** a partida with declared purity of 95%
- **WHEN** the user submits an empty or 100% purity with a valid motivo
- **THEN** `potencia_declarada` is set to NULL (no correction, 100%)

#### Scenario: Intento sin motivo
- **GIVEN** a valid new purity
- **WHEN** the user submits the form with an empty motivo
- **THEN** the operation is rejected with a validation error on the `motivo` field

#### Scenario: Valor de pureza fuera de rango
- **WHEN** the user submits a purity of 0%, negative, or greater than 100%
- **THEN** the operation is rejected with a validation error on `potenciaDeclaradaNueva`

---

### Requirement: CP2 — Inmutabilidad del pasado y efecto a futuro

Updating `potencia_declarada` on a partida SHALL NOT modify any past `fsj.movimiento_stock`, `fsj.pesada_real`, `fsj.ficha_tecnica`, or `fsj.cierre_diario`. Future preparation splits (`proponerRepartoActivo`) and physical weight calculations (`fisicoParaActivo`) MUST consume the lot using the updated purity value.

#### Scenario: Partida con consumos previos
- **GIVEN** a partida that was already consumed in past preparations with `potencia_aplicada = 100`
- **WHEN** its purity is corrected to 90%
- **THEN** previous `movimiento_stock.potencia_aplicada` and previous `pesada_real` rows remain intact
- **AND** the next preparation allocating this lot computes physical weights using 90%

---

### Requirement: CP3 — Guardia contra reservas activas en preparación

The command MUST refuse the correction if the lot has active reservations (`cantidadReservada > 0`), avoiding concurrent calculation discrepancies with preparations currently being prepared (`INICIADA`) in the laboratory.

#### Scenario: Partida reservada en preparación en curso
- **GIVEN** a partida with `cantidadReservada > 0` due to an in-progress preparation
- **WHEN** a user attempts to correct its purity
- **THEN** the operation is refused with a domain error indicating that active preparations must be confirmed or discarded first

---

### Requirement: CP4 — Control de concurrencia optimista y bloqueo

`corregirPotenciaPartida` MUST lock the partida row (`lockPartidaParaAccion`) before reading and perform an optimistic update checking the previous purity value, preventing concurrent update races.

#### Scenario: Dos correcciones simultáneas sobre la misma partida
- **GIVEN** two administrators attempting to correct the purity of the same lot concurrently
- **WHEN** both submit different values
- **THEN** the first one succeeds
- **AND** the second one is refused with a conflict error asking to retry

---

### Requirement: CP5 — Registro y trazabilidad en auditoría

Every purity change SHALL be audited in `fsj.auditoria` on the entity `partida` with action `MODIFICAR`, storing `valorAnterior: { potenciaDeclarada }`, `valorNuevo: { potenciaDeclarada }`, and the user's `motivo`.

#### Scenario: Auditoría de corrección de pureza
- **GIVEN** a successful purity correction
- **WHEN** inspecting `/admin/auditoria`
- **THEN** an audit row is recorded under entity `partida` / `MODIFICAR` with the previous and new purity values and the explanatory motivo

---

### Requirement: CP6 — Interfaz en el detalle de la partida

The page `/partidas/[id]` SHALL display a "Corregir pureza" panel in the sidebar when the session user has `stock.partida.potencia.corregir`. The form SHALL display the current purity, provide a numeric input for the new purity, a required textarea for the motivo, and keep user input upon validation errors.

#### Scenario: Usuario con permiso visualiza el formulario
- **GIVEN** an authenticated user with `stock.partida.potencia.corregir` opening `/partidas/[id]`
- **WHEN** the page loads
- **THEN** the "Corregir pureza" form is displayed with the current value as help text

#### Scenario: Usuario sin permiso
- **GIVEN** a user without `stock.partida.potencia.corregir`
- **WHEN** opening `/partidas/[id]`
- **THEN** the "Corregir pureza" form is not rendered

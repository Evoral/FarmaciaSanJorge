## ADDED Requirements

### Requirement: EL1 — An elaborated lot is a partida

Elaborating a lot SHALL consume partidas of its components and create ONE partida with `origen = ELABORACION_PROPIA`, no proveedor, and exactly one `INGRESO_ELABORACION` equal to its `cantidad_inicial`. Every consumption SHALL be an `EGRESO_ELABORACION` tied to the same `elaboracion_lote`, in one transaction.

#### Scenario: Jarabe simple elaborated

- **GIVEN** a fórmula of jarabe simple and partidas of its materias primas with stock
- **WHEN** 1000 ml are elaborated
- **THEN** each materia prima gets an `EGRESO_ELABORACION`
- **AND** a new partida of jarabe simple holds 1000 ml with origen `ELABORACION_PROPIA`

### Requirement: EL2 — Dilución

A dilución SHALL produce a partida of the SAME droga as its principal component. Its `potencia_declarada` SHALL be the active consumed of that droga divided by the cantidad producida, x 100, rounded down. The active in the new partida MUST equal the active consumed (INV-EL2, tolerance 10^-4).

#### Scenario: Droga X at 1 %

- **GIVEN** a partida of droga X at 100 % and a partida of lactosa
- **WHEN** 1 g of X and 99 g of lactosa are elaborated into 100 g
- **THEN** a partida of droga X with `potencia_declarada` 1 and 100 g is created

#### Scenario: Dilución of a diluted lot

- **GIVEN** a partida of droga X at 1 %
- **WHEN** 10 g of it and 90 g of lactosa are elaborated into 100 g
- **THEN** the new partida of droga X declares 0,1 %

### Requirement: EL3 — Fórmula

A droga MAY have one fórmula: components (droga, cantidad, unidad) for a `cantidad_referencia` of the product. A component MUST NOT be the droga itself nor have its own fórmula. Elaborating with a fórmula SHALL precarga its components scaled to the cantidad to produce; the consumed quantities MAY differ.

#### Scenario: Fórmula scaled

- **GIVEN** a fórmula of 100 ml with 85 g of azúcar
- **WHEN** 1000 ml are to be elaborated
- **THEN** the precarga proposes 850 g of azúcar

### Requirement: EL4 — Costo of the lot

The produced partida's `costo_unitario` SHALL be the sum of each consumed quantity times its partida's `costo_unitario`, divided by the cantidad producida. A missing costo de proveedor MUST NOT block elaborating.

#### Scenario: Costo from the consumed partidas

- **GIVEN** 1 g of droga X at $1000/g and 99 g of lactosa at $10/g
- **WHEN** 100 g are elaborated
- **THEN** the new partida costs (1000 + 990) / 100 = $19,90/g

### Requirement: EL5 — Vencimiento

The produced partida's vencimiento SHALL default to the earliest vencimiento vigente among the consumed partidas. It MAY be set earlier, never later. A consumed partida MUST NOT be expired (INV-S10).

#### Scenario: Later vencimiento refused

- **GIVEN** consumed partidas expiring 2027-03-01 and 2027-06-01
- **WHEN** the lot is elaborated with vencimiento 2027-05-01
- **THEN** it is refused

### Requirement: EL6 — Controlled drogas

Controlled drogas SHALL be elaborated like any other while the tenant's contralor is not active (the pharmacy keeps it outside the system). Once it is active, INV-L08 applies: until the elaboration asientos are defined, elaborating a controlled droga MUST be refused with a clear message.

#### Scenario: Contralor not active

- **GIVEN** a tenant without the contralor activated and a droga with `tipo_control` PSICOTROPICO
- **WHEN** a dilución of it is elaborated
- **THEN** it is accepted like any other droga

#### Scenario: Contralor active

- **GIVEN** a tenant with the contralor activated
- **WHEN** a dilución of a controlled droga is elaborated
- **THEN** it is refused, saying the contralor asientos for elaboración are not defined yet

### Requirement: EL7 — Stock físico and activo

The stock of a droga SHALL be shown as físico (sum of `cantidad_disponible`) and activo (sum of `cantidad_disponible` x potencia / 100, NULL potencia = 100). The stock mínimo alert SHALL compare the activo.

#### Scenario: Pure and diluted lots

- **GIVEN** droga X with 10 g at 100 % and 100 g at 1 %
- **WHEN** its stock is shown
- **THEN** físico is 110 g and activo is 11 g

### Requirement: EL8 — Permiso and operator

Elaborating SHALL require the permiso `stock.lote.elaborar`, which is PIN-configurable for cuentas de sector. Editing a fórmula SHALL require `drogas.editar`. The lot records who elaborated it.

#### Scenario: Without the permiso

- **GIVEN** a user without `stock.lote.elaborar`
- **WHEN** they try to elaborate a lot
- **THEN** it is refused

### Requirement: EL9 — Lote code

The system SHALL assign the lote code of an elaborated lot; the user SHALL NOT type it. The code SHALL be `DIL-` for a dilución or `ELA-` for a lot from its materias primas, then the jornada as `YYYYMMDD`, then the next number of that tipo in the jornada in the tenant (user decision 2026-10-29: the prefix tells what the lot is when it is searched). Two elaborations SHALL never get the same code; a code already taken by a lot without proveedor of the same droga SHALL be skipped.

#### Scenario: Second dilución of the day

- **GIVEN** the jornada 2026-10-29 already has the dilución `DIL-20261029-1` and the lot `ELA-20261029-1`
- **WHEN** a dilución is elaborated
- **THEN** its lote is `DIL-20261029-2`

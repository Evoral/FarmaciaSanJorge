## ADDED Requirements

### Requirement: R38 — Costo from a fórmula

A droga without a usable costo de proveedor but with a fórmula (elaboracion-lote EL3) SHALL be costed as the sum of each component's cantidad x its usable costo de proveedor, divided by the `cantidad_referencia`. A costo de proveedor of the droga itself, when usable, wins. The snapshot records fuente FORMULA.

#### Scenario: Jarabe simple priced from its fórmula

- **GIVEN** jarabe simple without a costo de proveedor and a fórmula of 100 ml with 85 g of azúcar at $2/g
- **WHEN** a cotización uses 10 ml of it
- **THEN** the línea costs 10 x (85 x 2 / 100) = $17 with fuente FORMULA

## MODIFIED Requirements

### Requirement: R27 — No costo de proveedor, no price

A droga with no usable costo de proveedor, and no fórmula whose components all have one (R38), SHALL have no price (2026-10-28): partidas never price a línea. The cotización is refused and the presupuesto names the droga without a price, or, for a fórmula, the component without one.

#### Scenario: CP13 — Cotización without costo de proveedor

- **GIVEN** a droga without a costo de proveedor, with stock
- **WHEN** a cotización is calculated
- **THEN** it is refused and no price is stored
- **AND** the presupuesto names the droga without a price

#### Scenario: Fórmula with a component without costo

- **GIVEN** jarabe simple with a fórmula whose azúcar has no costo de proveedor
- **WHEN** a cotización uses jarabe simple
- **THEN** it is refused and the presupuesto names azúcar as the droga without a price

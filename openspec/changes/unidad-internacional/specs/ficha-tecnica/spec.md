# Delta: ficha-tecnica

## MODIFIED Requirements

### Requirement: R9 — Conversión de unidades

La conversión de unidades SHALL hacerse solo dentro de la misma `tipoMagnitud`, usando `UnidadMedida.factorABase`.
Nunca peso ↔ volumen, y nunca `ACTIVIDAD` (U.I.) ↔ otra magnitud: el paso de U.I. a gramos es de la partida
(`openspec/specs/unidad-internacional/spec.md` UI6), nunca de la ficha.

#### Scenario: T5 — Conversión

- **WHEN** se calcula un componente TOTAL 1200 MILIGRAMO
- **THEN** 1.200 GRAMO

#### Scenario: Sólido en un vehículo líquido

- **GIVEN** el jarabe de T4: Sulfato de zinc en MILIGRAMO y total en MILILITRO
- **WHEN** se calcula el CSP
- **THEN** no se convierte peso a volumen: el CSP es enrase manual (R4)

#### Scenario: Activo en U.I. en una crema

- **GIVEN** CREMA · total 50 GRAMO, con Vitamina A 500.000 U.I. TOTAL y Crema base null GRAMO CSP
- **WHEN** se calcula la ficha
- **THEN** Vitamina A queda en 500.000 U.I. y Crema base es enrase manual (R4)

### Requirement: INV-S12 — Consumo de la línea

**INV-S12** SHALL ser: el consumo de una línea no manual es exactamente `cantidadAPesar`; el de una línea manual es
la cantidad registrada al confirmar (> 0). The consumption (`movimiento_stock`) is in the droga's unidad base,
`cantidadAPesar` in the línea's unit: they are compared after converting (migration 0073;
`openspec/specs/reserva-stock-preparacion/spec.md` R12). A línea in U.I. is compared in active terms: the grams of
each movement times its `actividad_aplicada`. A línea weighed as cantidad manual por falta de equivalencia
(`equivalencia_manual`, unidad-internacional UI7) is consumed like a manual línea; one línea never mixes manual and
computed movements.

#### Scenario: Línea en gramos, droga en miligramos

- **GIVEN** una línea no manual con `cantidadAPesar` en GRAMO y una droga cuya unidad base es MILIGRAMO
- **WHEN** se controla el consumo
- **THEN** se comparan después de convertir

#### Scenario: Línea manual sin cantidad

- **WHEN** se confirma una línea manual con cantidad registrada 0
- **THEN** no cumple INV-S12

#### Scenario: Línea en U.I.

- **GIVEN** una línea de 500.000 U.I. consumida con 3 g a 100.000 U.I./g y 5 g a 40.000 U.I./g
- **WHEN** se controla el consumo
- **THEN** cumple INV-S12 (500.000 U.I. activas)

#### Scenario: Línea con movimientos manuales y calculados

- **WHEN** una línea tiene un movimiento con `equivalencia_manual` y otro sin
- **THEN** no cumple INV-S12

# Unidades internacionales (U.I.)

## Purpose

Drugs prescribed and supplied in international units: U.I. in recetas, U.I./g in partidas, the pesada in grams
through each lot, the cantidad manual fallback, the cotización, and the etiqueta and libro printing U.I.

> Decisiones del usuario (2026-11-24): D1..D8 in
> `openspec/changes/archive/2026-11-24-unidad-internacional/proposal.md`.

## Requirements

### Requirement: UI1 — Unidad y magnitud

The catalog SHALL offer `UNIDAD_INTERNACIONAL` (símbolo `U.I.`) as the base unit of the magnitude `ACTIVIDAD`.
Nothing SHALL convert `ACTIVIDAD` to or from another magnitude (INV-M01).

#### Scenario: U.I. no se convierte a unidades
- **GIVEN** a quantity of 10 U.I.
- **WHEN** something tries to convert it to UNIDAD (u) or GRAMO
- **THEN** the conversion is refused

### Requirement: UI2 — Droga que se dosifica en U.I.

A droga of clase DROGA SHALL be markable "se dosifica en U.I.", in its alta and its edit. The droga SHALL hold no
equivalence between U.I. and mass. Only a marked droga accepts U.I. in a receta and U.I. partidas. The marca SHALL
not be removed while the droga has a U.I. partida with balance.

#### Scenario: Excipiente no se marca
- **WHEN** the user marks a droga of clase EXCIPIENTE as "se dosifica en U.I."
- **THEN** it is rejected

#### Scenario: Quitar la marca con stock en U.I.
- **GIVEN** a marked droga with a U.I. partida with balance > 0
- **WHEN** the user removes the marca
- **THEN** it is rejected

### Requirement: UI3 — Receta en U.I. o en masa

A componente of a marked droga SHALL be loadable in U.I. as TOTAL, POR_DOSIS or CONCENTRACION over a referencia
("10.000 U.I./g"), or in a mass unit as today. U.I. SHALL be refused for an unmarked droga, as a percentage
(CONCENTRACION without referencia), and in CS/CSP.

#### Scenario: Cápsulas de vitamina D3 en U.I.
- **GIVEN** a marked droga "Vitamina D3" and an ítem of 30 cápsulas
- **WHEN** the componente is loaded as 50.000 U.I. POR_DOSIS
- **THEN** the receta is accepted and the ficha's línea is 1.500.000 U.I. (plus exceso)

#### Scenario: Crema con concentración en U.I.
- **GIVEN** a crema with total 50 g
- **WHEN** a marked droga is loaded as CONCENTRACION 10.000 U.I./g
- **THEN** the ficha's línea is 500.000 U.I. and its prescripción reads "10000 U.I./g × 50 g"

#### Scenario: Droga no marcada
- **WHEN** a componente of an unmarked droga is loaded in U.I.
- **THEN** it is rejected with an error on that componente, and the rest of the form keeps its values

### Requirement: UI4 — Partida en gramos o en U.I.

A partida of a marked droga SHALL be loaded in grams (purity % optional) or in U.I., declaring "X U.I. cada Y <masa>"
(or the inverse), stored as U.I./g. The kind is an explicit choice with no default, and never changes after intake.
A U.I. partida without U.I./g, with both % and U.I./g, or of an unmarked droga SHALL be refused by the app and the
database, in every path that creates a partida (alta, factura, existencia inicial, lote elaborado).

#### Scenario: Fila de existencia inicial sin tipo
- **GIVEN** a planilla row of a marked droga with neither Potencia nor U.I./g
- **WHEN** it is saved
- **THEN** it stays as an incomplete draft and is not passed to stock

#### Scenario: Certificado "1000 U.I. cada 10 g"
- **WHEN** a partida is loaded as 1000 U.I. cada 10 g
- **THEN** it stores 100 U.I./g

#### Scenario: Partida en gramos de una droga marcada
- **GIVEN** a marked droga
- **WHEN** a partida is loaded in grams without U.I.
- **THEN** it is accepted as a gram partida

#### Scenario: Partida U.I. sin valor
- **WHEN** a partida is loaded as U.I. without its U.I./g
- **THEN** it is rejected, and the form keeps every other value

#### Scenario: Dilución de un lote en U.I.
- **GIVEN** 10 g of a 100.000 U.I./g lot diluted to 100 g
- **WHEN** the elaboración passes to stock
- **THEN** the new partida is a U.I. partida at 10.000 U.I./g

### Requirement: UI5 — Corregir U.I./g

"Corregir pureza" SHALL correct the U.I./g of a U.I. partida with the same rules as the percentage: permission
`stock.partida.potencia.corregir`, mandatory motivo, refused with an active reserva, audited with old and new value,
effective for future preparations only. It SHALL not turn a gram partida into a U.I. one or vice versa.

#### Scenario: Error de tipeo
- **GIVEN** a U.I. partida at 1.000 U.I./g with no reserva
- **WHEN** the user corrects it to 100 U.I./g with motivo "Error de tipeo"
- **THEN** future preparations use 100 U.I./g and past movements keep their `actividad_aplicada`

### Requirement: UI6 — Pesada de una línea en U.I.

A línea in U.I. SHALL be split only over U.I. partidas (FEFO, abiertas first, as today), each weighed in grams:
`gramos = U.I. / (U.I./g)`, rounded UP to `DECIMALES_PESO_FISICO`. Each movement SHALL record its
`actividad_aplicada`. A línea in mass SHALL be split only over gram partidas.

#### Scenario: Dos lotes con distinta actividad
- **GIVEN** a línea of 500.000 U.I. and two U.I. partidas: A (100.000 U.I./g, 3 g left, oldest) and B (40.000 U.I./g)
- **WHEN** the split is proposed
- **THEN** it takes 3 g of A (300.000 U.I.) and 5 g of B (200.000 U.I.)

### Requirement: UI7 — Cantidad manual por falta de equivalencia

For a marked droga with no partida convertible with the línea (U.I. línea and only gram lots, or mass línea and only
U.I. lots), the línea SHALL be a cantidad manual: the DT types the physical quantity, no correction applies, it is
recorded as `equivalencia_manual` and highlighted for review. With convertible partidas that are not enough, it is a
faltante as today and the DT may switch the whole línea to manual; with enough, manual is refused. A línea is never
part computed, part manual.

#### Scenario: Manual con stock suficiente
- **GIVEN** a línea of 50.000 U.I. and U.I. partidas that cover it
- **WHEN** the línea is sent as cantidad manual
- **THEN** it is refused: the línea is computed from the lot

#### Scenario: Receta en U.I. sin lotes en U.I.
- **GIVEN** a línea of 50.000 U.I. and only gram partidas of the droga
- **WHEN** the reserva is opened
- **THEN** the línea asks for a cantidad manual and is highlighted

#### Scenario: Receta en mg con solo lotes en U.I.
- **GIVEN** a línea of 1,25 mg and only U.I. partidas of the droga
- **WHEN** the reserva is opened
- **THEN** the línea asks for a cantidad manual and is highlighted

#### Scenario: Lote en U.I. insuficiente
- **GIVEN** a línea of 500.000 U.I. and U.I. partidas holding 300.000 U.I. in total
- **WHEN** the split is proposed
- **THEN** the línea is a faltante of 200.000 U.I., with the option to switch it to cantidad manual

#### Scenario: Droga no marcada
- **GIVEN** a droga without the marca
- **WHEN** its línea has a faltante
- **THEN** no cantidad manual is offered (unchanged behavior)

### Requirement: UI8 — Excipiente con un activo en U.I.

With a línea in U.I., the excipiente SHALL be used as typed (no drogas' weight subtracted), and the preparación SHALL
show that the U.I. droga's weight is not subtracted.

#### Scenario: Cápsulas con excipiente por unidad
- **GIVEN** cápsulas with a U.I. línea and an excipiente typed as 0,4 g per cápsula
- **WHEN** the excipiente is computed
- **THEN** it is 0,4 g × units, and the notice "El peso de Vitamina D3 (U.I.) no está descontado del excipiente" is shown

### Requirement: UI9 — Cotización de una línea en U.I.

The cotización SHALL cost a U.I. línea through the first U.I. partida in FEFO order (its grams by UI6); without a U.I.
partida the línea is "sin precio" (R27).

#### Scenario: Sin lote en U.I.
- **GIVEN** a U.I. línea and no U.I. partida
- **WHEN** the presupuesto is computed
- **THEN** the línea is flagged sin precio and nothing fails

### Requirement: UI10 — Etiqueta y libro recetario en U.I.

The etiqueta's Rp/ and the libro recetario's fórmula SHALL print the quantity as prescribed, in U.I., never the grams
weighed.

#### Scenario: Etiqueta
- **GIVEN** a preparación of cápsulas with Vitamina D3 50.000 U.I. POR_DOSIS
- **WHEN** the etiqueta is printed
- **THEN** Rp/ reads "Vitamina D3 50.000 U.I."

#### Scenario: Libro recetario
- **WHEN** the asiento of that preparación is written
- **THEN** its fórmula reads "Vitamina D3 50.000 U.I."

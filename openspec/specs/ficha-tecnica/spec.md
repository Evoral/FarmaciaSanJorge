# Cálculo de ficha técnica (LineaPesaje)

## Purpose

Cómo se generan las líneas de pesaje (`LineaPesaje`) de una ficha técnica a partir de un ítem de receta y sus
componentes: cantidad teórica, conversión de unidades, exceso, enrase manual y validaciones.

> Fuente: definición del usuario (DP-06c, 2026-09-21). Fuente de verdad para el punto 7.1 del plan.
> Las notas marcadas **[ACLARACIÓN]** son deducciones de consistencia entre reglas y casos de prueba; no agregan requisitos nuevos.

## Requirements

### Requirement: Alcance — función pura

Las `LineaPesaje` de una `FichaTecnica` SHALL generarse a partir de un `ItemReceta` y sus `ComponenteItemReceta`
con una función pura, sin acceso a base de datos ni UI: `calcularFichaTecnica(item: ItemRecetaInput, componentes:
ComponenteInput[], parametros: ParametrosPesaje): LineaPesajeCalculada[]` (o error de validación). La función MUST
NOT leer ni escribir base de datos.

#### Scenario: Cálculo de un ítem

- **WHEN** se calcula la ficha de un ítem con sus componentes y los parámetros de pesaje
- **THEN** la función devuelve las líneas calculadas o un error de validación
- **AND** no lee ni escribe base de datos

### Requirement: Decimal de precisión fija

Todo cálculo SHALL usar numeric/decimal de precisión fija. Float MUST NOT usarse en ningún paso (prohibido).

#### Scenario: Exceso sin float

- **GIVEN** exceso 5 %
- **WHEN** se calcula un componente TOTAL 1.234 GRAMO
- **THEN** la cantidad a pesar es exactamente 1.2957

### Requirement: Fracción de dosis por unidad

`fraccionDosisPorUnidad` del ítem SHALL valer 1 por defecto; «½ dosis» = 0.5.

#### Scenario: Media dosis

- **WHEN** la receta indica «½ dosis» por unidad
- **THEN** `fraccionDosisPorUnidad` es 0.5

### Requirement: Modo de expresión

`modoExpresion` del componente SHALL ser uno de: `TOTAL` (cantidad para todo el preparado); `POR_DOSIS` (cantidad
por dosis; se multiplica por fracción y unidades); `CS` (cantidad suficiente, sin total a completar, «jarabe simple
cs»); `CSP` (cantidad suficiente para completar `cantidadTotal`, «vaselina csp 30»). `modoExpresion` **reemplaza**
al booleano `esCantidadSuficiente` del diagrama.

#### Scenario: Vaselina csp 30

- **WHEN** la receta indica «vaselina csp 30» en una crema de 30 gramos
- **THEN** la vaselina es un componente `CSP` que completa `cantidadTotal`

### Requirement: Principio activo copiado del catálogo

`esPrincipioActivo` no lo carga el usuario: al guardar la receta SHALL copiarse de la clase de la droga en el
catálogo (`true` si es `DROGA`; migración 0063).

#### Scenario: Componente de clase DROGA

- **WHEN** se guarda una receta con un componente cuya droga es de clase `DROGA`
- **THEN** su `esPrincipioActivo` es `true` sin que el usuario lo cargue

#### Scenario: Componente de otra clase

- **WHEN** se guarda una receta con un componente cuya droga no es de clase `DROGA`
- **THEN** su `esPrincipioActivo` es `false`

### Requirement: Componentes sin orden

Los componentes de un ítem **no tienen orden** (migración 0065: a la farmacia no le importa). Donde se listan o se
calculan SHALL ordenarse con una sola regla: primero los que tienen cantidad (TOTAL, POR_DOSIS), después CS y al
final CSP; a igualdad, por nombre de droga (`modules/elaboracion/domain/orden-componentes.ts`).

#### Scenario: Listado de los componentes de T4

- **GIVEN** el ítem de T4: Sulfato de zinc TOTAL, Jarabe simple CS, Sorbitol CSP
- **WHEN** se listan sus componentes
- **THEN** el orden es Sulfato de zinc, Jarabe simple, Sorbitol

#### Scenario: Dos componentes con cantidad

- **GIVEN** dos componentes TOTAL o POR_DOSIS
- **WHEN** se listan o se calculan
- **THEN** van por nombre de droga

### Requirement: Orden de las líneas de salida

El `orden` de cada `LineaPesaje` de salida SHALL ser la posición de la línea: la de su componente según la regla de
orden de los componentes (cantidad, CS, CSP; luego nombre de droga).

#### Scenario: Líneas de T4

- **GIVEN** el ítem de T4
- **WHEN** se calculan sus líneas
- **THEN** Sulfato de zinc, Jarabe simple y Sorbitol quedan en ese orden

### Requirement: Parámetros de pesaje

Los `ParametrosPesaje` SHALL ser por tenant, en `parametro`: `excesoPesadaPorcentaje` con default 0.
`precisionBalanza` no interviene en la ficha (R8): la usa la pesada real (`openspec/specs/pesada-real/spec.md`).

#### Scenario: Tenant con los valores por defecto

- **GIVEN** un tenant que no cambió los parámetros de pesaje
- **WHEN** se calcula una ficha
- **THEN** usa exceso 0 %

### Requirement: Línea de pesaje de salida

Cada `LineaPesaje` de salida SHALL llevar `drogaId`; `cantidadTeorica` (Decimal | null), antes del exceso;
`excesoAplicado`, el porcentaje aplicado; `cantidadAPesar` (Decimal | null), el activo con exceso, sin redondear;
`unidadMedida`, la unidad base de la magnitud; `esEnraseManual` (true = la cantidad la registra el farmacéutico al
preparar); y `orden`.

#### Scenario: Línea de T6

- **GIVEN** exceso 5 %
- **WHEN** se calcula un componente TOTAL 1.234 GRAMO
- **THEN** la línea tiene `cantidadTeorica` 1.234, `excesoAplicado` 5, `cantidadAPesar` 1.2957 y `unidadMedida` GRAMO

### Requirement: R1 — TOTAL

Para un componente `TOTAL`, `cantidadTeorica` SHALL ser la cantidad convertida a la unidad base de su magnitud.

#### Scenario: Ácido salicílico de T1

- **GIVEN** Ácido salicílico 3 GRAMO TOTAL
- **WHEN** se calcula la línea
- **THEN** Ácido salicílico 3.000 g

### Requirement: R2 — POR_DOSIS

Para un componente `POR_DOSIS`, `cantidadTeorica` SHALL ser cantidad × fraccionDosisPorUnidad × cantidadUnidades,
convertida a unidad base.

#### Scenario: T3 — Cápsulas, asiento 34147

- **GIVEN** CAPSULA · unidades 30 · fracción 0.5 · total null
- **AND** Mazindol 3 MILIGRAMO POR_DOSIS; Ludipress null GRAMO CSP
- **WHEN** se calcula la ficha
- **THEN** Mazindol 0.045 g · Ludipress enrase manual
- **AND** con CSP en cápsulas V4 no aplica

### Requirement: R3 — CSP en formas no capsulares, misma magnitud

Si `formaFarmaceutica` no es CAPSULA ni COMPRIMIDO, y todos los componentes no-CSP y `unidadTotal` pertenecen a la
misma `tipoMagnitud`, la `cantidadTeorica` del CSP SHALL ser `cantidadTotal − Σ cantidadTeorica(resto de
componentes)`, todo en unidad base. **[ACLARACIÓN] R3 y R6:** los componentes CS se excluyen tanto de la resta de R3
como de la comprobación de "misma magnitud" (ver T4).

#### Scenario: T1 — Crema, asiento 34163

- **GIVEN** CREMA · total 30 GRAMO · unidades 1 · fracción 1
- **AND** Ácido salicílico 3 GRAMO TOTAL; Vaselina sólida null GRAMO CSP
- **WHEN** se calcula la ficha
- **THEN** Ácido salicílico 3.000 g · Vaselina sólida 27.000 g

#### Scenario: T2 — Crema, asiento 34164

- **GIVEN** CREMA · total 30 GRAMO
- **AND** Hidroquinona 1.2 GRAMO TOTAL; Crema base null GRAMO CSP
- **WHEN** se calcula la ficha
- **THEN** Hidroquinona 1.200 g · Crema base 28.800 g

### Requirement: R4 — CSP con magnitudes distintas

Si algún componente o el total difieren en `tipoMagnitud` (ej. mg de sólido en ml de jarabe), la línea CSP SHALL
quedar con `esEnraseManual = true`, `cantidadTeorica = null`, `cantidadAPesar = null`.

#### Scenario: T4 — Jarabe, asiento 34162

- **GIVEN** JARABE · total 120 MILILITRO · unidades 1
- **AND** Sulfato de zinc 1200 MILIGRAMO TOTAL; Jarabe simple null MILILITRO CS; Sorbitol null MILILITRO CSP
- **WHEN** se calcula la ficha
- **THEN** Sulfato de zinc 1.200 g · Jarabe simple enrase manual · Sorbitol enrase manual (R4)

### Requirement: R5 — CSP en cápsulas o comprimidos

Un componente CSP en CAPSULA o COMPRIMIDO SHALL ser siempre `esEnraseManual = true`. El excipiente se completa por
volumen al preparar.

#### Scenario: Ludipress de T3

- **GIVEN** CAPSULA · unidades 30 · fracción 0.5 · total null, con Ludipress null GRAMO CSP
- **WHEN** se calcula la ficha
- **THEN** Ludipress es enrase manual

### Requirement: R6 — CS

Un componente CS SHALL ser siempre `esEnraseManual = true`. No participa del cálculo de R3. **[ACLARACIÓN] R3 y
R6:** los componentes CS se excluyen tanto de la resta de R3 como de la comprobación de "misma magnitud" (ver T4).

#### Scenario: Jarabe simple de T4

- **GIVEN** Jarabe simple null MILILITRO CS en el jarabe de T4
- **WHEN** se calcula la ficha
- **THEN** Jarabe simple es enrase manual

#### Scenario: CS fuera de la resta de R3

- **GIVEN** una forma no capsular con un componente CS, un CSP y el resto de los componentes y `unidadTotal` de la misma `tipoMagnitud`
- **WHEN** R3 calcula el CSP
- **THEN** el CS no se resta del total ni cuenta para la comprobación de "misma magnitud"

### Requirement: R7 — Exceso de pesada

Sobre toda línea no manual SHALL aplicarse `cantidadConExceso = cantidadTeorica × (1 + excesoPesadaPorcentaje / 100)`.

#### Scenario: T6 — Exceso

- **GIVEN** exceso 5 %
- **WHEN** se calcula un componente TOTAL 1.234 GRAMO
- **THEN** teórica 1.234 · a pesar 1.2957

#### Scenario: Línea manual

- **GIVEN** exceso 5 %
- **WHEN** se calcula una línea de enrase manual
- **THEN** su `cantidadTeorica` y su `cantidadAPesar` quedan nulas

### Requirement: R8 — Redondeo

`cantidadAPesar` SHALL ser `cantidadConExceso` sin redondear: es el principio activo requerido. Lo que se pesa es el
peso físico de cada partida (activo × 100 / potencia), y la pesada real lo redondea a `precisionBalanza`. El cálculo
de R3 usa `cantidadTeorica` de los activos.

#### Scenario: Dosis menor que la precisión de la balanza

- **GIVEN** precisión 0.001 g y una cápsula con 0,15 mg POR_DOSIS de una droga
- **WHEN** se calcula la ficha
- **THEN** la cantidad a pesar es 0.00015 g, no 0
- **AND** con una partida al 0,1 % la pesada real espera 0,150 g físicos

#### Scenario: CSP con un activo con exceso

- **GIVEN** una crema cuyo activo TOTAL tiene una `cantidadAPesar` distinta de su `cantidadTeorica` por el exceso
- **WHEN** R3 calcula el CSP
- **THEN** resta la `cantidadTeorica` del activo, no su `cantidadAPesar`

### Requirement: R9 — Conversión de unidades

La conversión de unidades SHALL hacerse solo dentro de la misma `tipoMagnitud`, usando `UnidadMedida.factorABase`.
Nunca peso ↔ volumen.

#### Scenario: T5 — Conversión

- **WHEN** se calcula un componente TOTAL 1200 MILIGRAMO
- **THEN** 1.200 GRAMO

#### Scenario: Sólido en un vehículo líquido

- **GIVEN** el jarabe de T4: Sulfato de zinc en MILIGRAMO y total en MILILITRO
- **WHEN** se calcula el CSP
- **THEN** no se convierte peso a volumen: el CSP es enrase manual (R4)

### Requirement: V1 — Ítem sin componentes

`calcularFichaTecnica` SHALL devolver un error de validación, sin generar ficha, cuando el `ItemReceta` no tiene
componentes.

#### Scenario: Ítem vacío

- **WHEN** se calcula un ítem sin componentes
- **THEN** devuelve error y no genera ficha

### Requirement: V2 — Más de un CSP

`calcularFichaTecnica` SHALL devolver un error de validación, sin generar ficha, cuando hay más de un componente CSP.

#### Scenario: T8 — Error V2

- **WHEN** se calcula un ítem con dos componentes CSP
- **THEN** error

### Requirement: V4 — CSP sin total

`calcularFichaTecnica` SHALL devolver un error de validación, sin generar ficha, cuando hay CSP presente y
`cantidadTotal` o `unidadTotal` nulos. **[ACLARACIÓN]** Solo aplica a formas no capsulares. Para CAPSULA/COMPRIMIDO
el total no es requerido (T3).

#### Scenario: Crema con CSP sin total

- **WHEN** se calcula una CREMA con un componente CSP y `cantidadTotal` o `unidadTotal` nulos
- **THEN** devuelve error y no genera ficha

#### Scenario: Cápsulas con CSP sin total

- **GIVEN** CAPSULA · unidades 30 · fracción 0.5 · total null, con un componente CSP
- **WHEN** se calcula la ficha
- **THEN** V4 no aplica: no hay error por el total nulo

### Requirement: V5 — Los componentes superan el total

`calcularFichaTecnica` SHALL devolver un error de validación, sin generar ficha, cuando R3 da resultado ≤ 0: los
componentes superan el total.

#### Scenario: T7 — Error V5

- **WHEN** se calcula una CREMA total 30 g · activo 31 g TOTAL · CSP
- **THEN** error

#### Scenario: R3 da exactamente 0

- **GIVEN** CREMA total 30 GRAMO, un activo 30 GRAMO TOTAL y un CSP
- **WHEN** se calcula la ficha
- **THEN** R3 da 30 − 30 = 0 y devuelve error

### Requirement: V6 — Cantidad faltante

`calcularFichaTecnica` SHALL devolver un error de validación, sin generar ficha, cuando un componente TOTAL o
POR_DOSIS tiene cantidad nula o ≤ 0.

#### Scenario: TOTAL sin cantidad

- **WHEN** se calcula un componente TOTAL con cantidad nula
- **THEN** devuelve error y no genera ficha

#### Scenario: POR_DOSIS con cantidad 0

- **WHEN** se calcula un componente POR_DOSIS con cantidad 0
- **THEN** devuelve error y no genera ficha

### Requirement: V7 — Cantidad en CS o CSP

`calcularFichaTecnica` SHALL devolver un error de validación, sin generar ficha, cuando un componente CS o CSP tiene
cantidad no nula.

#### Scenario: CSP con cantidad

- **WHEN** se calcula un componente CSP con cantidad cargada
- **THEN** devuelve error y no genera ficha

### Requirement: V8 — Fracción de dosis fuera de rango

`calcularFichaTecnica` SHALL devolver un error de validación, sin generar ficha, cuando `fraccionDosisPorUnidad` es
≤ 0 o > 1.

#### Scenario: Fracción 0

- **WHEN** se calcula un ítem con `fraccionDosisPorUnidad` 0
- **THEN** devuelve error y no genera ficha

#### Scenario: Fracción mayor a 1

- **WHEN** se calcula un ítem con `fraccionDosisPorUnidad` 1.5
- **THEN** devuelve error y no genera ficha

#### Scenario: Fracción 1

- **WHEN** se calcula un ítem con `fraccionDosisPorUnidad` 1
- **THEN** no hay error V8

### Requirement: V9 — Unidades no positivas

`calcularFichaTecnica` SHALL devolver un error de validación, sin generar ficha, cuando `cantidadUnidades` es ≤ 0.

#### Scenario: Cero unidades

- **WHEN** se calcula un ítem con `cantidadUnidades` 0
- **THEN** devuelve error y no genera ficha

### Requirement: Casos de prueba exactos

Los casos de prueba T1–T8 SHALL pasar exactos. Cada uno es un escenario de la regla que ejercita: T1 y T2 en R3, T3
en R2, T4 en R4, T5 en R9, T6 en R7, T7 en V5, T8 en V2.

#### Scenario: Resultado de un caso de prueba

- **WHEN** se calcula cualquiera de los casos T1–T8
- **THEN** el resultado coincide exactamente con el del caso

### Requirement: Líneas congeladas

Las líneas generadas SHALL persistirse congeladas. Un cambio posterior en Droga o UnidadMedida no las recalcula.
Las líneas existentes MUST NOT recalcularse leyendo el maestro.

#### Scenario: Cambio en el maestro

- **GIVEN** una ficha con sus líneas generadas
- **WHEN** cambia la Droga o la UnidadMedida de una de sus líneas
- **THEN** las líneas existentes no cambian

### Requirement: Cantidad real de una línea manual

Una línea con `esEnraseManual = true` SHALL recibir su cantidad real al confirmar la preparación. Esa cantidad se
guarda en el `MovimientoStock` (EGRESO_PREPARACION) y en `DetalleAsiento`, no en `LineaPesaje`.

#### Scenario: Confirmación con una línea manual

- **WHEN** se confirma una preparación con una línea de enrase manual
- **THEN** la cantidad registrada queda en el `MovimientoStock` EGRESO_PREPARACION y en `DetalleAsiento`
- **AND** la `LineaPesaje` sigue con sus cantidades nulas

### Requirement: Egreso de stock por línea

Para líneas no manuales, el egreso de stock SHALL ser exactamente `cantidadAPesar`, salvo que se registre la pesada
real (`openspec/specs/pesada-real/spec.md`, migración 0088): entonces es la pesada real. Para líneas manuales, es la
cantidad registrada por el farmacéutico.

#### Scenario: Línea no manual sin pesada real

- **WHEN** se confirma una línea no manual sin pesada real registrada
- **THEN** egresa exactamente su `cantidadAPesar`

#### Scenario: Línea no manual con pesada real

- **WHEN** se confirma una línea no manual con pesada real registrada
- **THEN** egresa la pesada real

#### Scenario: Línea manual

- **WHEN** se confirma una línea manual
- **THEN** egresa la cantidad registrada por el farmacéutico

### Requirement: Ficha vigente o desactualizada

Una ficha SHALL ser **vigente** para su ítem cuando es la última versión y recalcular las líneas con los datos
actuales del ítem (y los parámetros de pesaje actuales) da exactamente sus líneas (`mismasLineasPesaje`, la misma
regla que decide si la regeneración tras editar crea una versión nueva). Si no, está **desactualizada** (2026-10-15,
`openspec/specs/reserva-stock-preparacion/spec.md` R18-R20).

#### Scenario: Parámetro de pesaje cambiado

- **GIVEN** la última versión de la ficha de un ítem
- **WHEN** cambia `excesoPesadaPorcentaje` y recalcular las líneas ya no da exactamente sus líneas
- **THEN** la ficha está desactualizada

#### Scenario: Versión anterior

- **WHEN** una ficha no es la última versión de su ítem
- **THEN** no es vigente

### Requirement: Ficha desactualizada sin reserva

Sobre una ficha **desactualizada** MUST NOT reservarse stock hasta generar una versión nueva (`fichas.generar`).
Editar la receta no genera fichas a quien no tiene `fichas.generar` (GA2 de
`openspec/specs/presupuesto-receta/spec.md`); el laboratorio la genera desde la toma.

#### Scenario: Reserva sobre una ficha desactualizada

- **GIVEN** un ítem cuya ficha está desactualizada
- **WHEN** se intenta reservar stock
- **THEN** se rechaza hasta generar una versión nueva

#### Scenario: Edición sin fichas.generar

- **GIVEN** un usuario sin `fichas.generar`
- **WHEN** edita la receta
- **THEN** no se generan fichas; el laboratorio la genera desde la toma

### Requirement: Sin versión nueva con una preparación viva

Una versión nueva de la ficha MUST NOT generarse mientras el ítem tiene una preparación viva: CONFIRMADA (como
siempre) o INICIADA con stock reservado («Liberá la reserva antes de generar una nueva versión»).

#### Scenario: Preparación iniciada con stock reservado

- **GIVEN** un ítem con una preparación INICIADA con stock reservado
- **WHEN** se genera una versión nueva de su ficha
- **THEN** se rechaza con «Liberá la reserva antes de generar una nueva versión»

#### Scenario: Preparación confirmada

- **GIVEN** un ítem con una preparación CONFIRMADA
- **WHEN** se genera una versión nueva de su ficha
- **THEN** se rechaza

### Requirement: INV-R04 — Cantidades de la línea

**INV-R04** SHALL ser: `cantidadAPesar > 0` si la línea no es manual; `cantidadAPesar` y `cantidadTeorica` nulas si
es manual. Ambas congeladas al generarse.

#### Scenario: Línea no manual

- **WHEN** se genera una línea no manual
- **THEN** su `cantidadAPesar` es > 0

#### Scenario: Línea manual

- **WHEN** se genera una línea de enrase manual
- **THEN** su `cantidadAPesar` y su `cantidadTeorica` son nulas

### Requirement: INV-S12 — Consumo de la línea

**INV-S12** SHALL ser: el consumo de una línea no manual es exactamente `cantidadAPesar`; el de una línea manual es
la cantidad registrada al confirmar (> 0). The consumption (`movimiento_stock`) is in the droga's unidad base,
`cantidadAPesar` in the línea's unit: they are compared after converting (migration 0073;
`openspec/specs/reserva-stock-preparacion/spec.md` R12).

#### Scenario: Línea en gramos, droga en miligramos

- **GIVEN** una línea no manual con `cantidadAPesar` en GRAMO y una droga cuya unidad base es MILIGRAMO
- **WHEN** se controla el consumo
- **THEN** se comparan después de convertir

#### Scenario: Línea manual sin cantidad

- **WHEN** se confirma una línea manual con cantidad registrada 0
- **THEN** no cumple INV-S12

### Requirement: No hacer

El cálculo MUST NOT: calcular el CSP de cápsulas por diferencia de peso; restar mg de un sólido a ml de un vehículo;
usar la cantidad con exceso de los activos para calcular el CSP; redondear el activo a la balanza; recalcular líneas existentes leyendo el maestro;
permitir que el usuario edite `cantidadAPesar` de una línea no manual; usar float en ningún paso.

#### Scenario: CSP de cápsulas

- **WHEN** se calcula el CSP de un ítem en cápsulas
- **THEN** no se calcula por diferencia de peso: es enrase manual (R5)

#### Scenario: Edición de la cantidad a pesar

- **GIVEN** una línea no manual
- **WHEN** el usuario intenta editar su `cantidadAPesar`
- **THEN** no se le permite

## Alcance

Generar las `LineaPesaje` de una `FichaTecnica` a partir de un `ItemReceta` y sus `ComponenteItemReceta`.
Función pura, sin acceso a base de datos ni UI:

```ts
calcularFichaTecnica(
  item: ItemRecetaInput,
  componentes: ComponenteInput[],
  parametros: ParametrosPesaje,
): LineaPesajeCalculada[] // o error de validación
```

## Modelo

### ItemReceta (campos usados)

| Campo | Tipo | Nota |
|---|---|---|
| formaFarmaceutica | FormaFarmaceutica | |
| cantidadTotal | Decimal \| null | total del preparado ("csp 30 gr") |
| unidadTotal | UnidadMedida \| null | |
| cantidadUnidades | Integer | cápsulas o envases |
| fraccionDosisPorUnidad | Decimal | default 1. "½ dosis" = 0.5 |

### ComponenteItemReceta

| Campo | Tipo |
|---|---|
| drogaId | UUID |
| cantidad | Decimal \| null |
| unidadMedida | UnidadMedida |
| modoExpresion | ModoExpresion |
| esPrincipioActivo | Boolean |

`modoExpresion` **reemplaza** al booleano `esCantidadSuficiente` del diagrama.

`esPrincipioActivo` no lo carga el usuario: al guardar la receta se copia de la clase de la droga en el catálogo (`true` si es `DROGA`; migración 0063).

Los componentes de un ítem **no tienen orden** (migración 0065: a la farmacia no le importa). Donde se listan o se calculan se ordenan con una sola regla: primero los que tienen cantidad (TOTAL, POR_DOSIS), después CS y al final CSP; a igualdad, por nombre de droga (`modules/elaboracion/domain/orden-componentes.ts`).

### Enum ModoExpresion

```
TOTAL      cantidad para todo el preparado
POR_DOSIS  cantidad por dosis; se multiplica por fracción y unidades
CS         cantidad suficiente, sin total a completar ("jarabe simple cs")
CSP        cantidad suficiente para completar cantidadTotal ("vaselina csp 30")
```

### ParametrosPesaje (por tenant, en `parametro`)

| Campo | Default |
|---|---|
| excesoPesadaPorcentaje | 0 |

### LineaPesaje (salida)

| Campo | Tipo | Nota |
|---|---|---|
| drogaId | UUID | |
| cantidadTeorica | Decimal \| null | antes del exceso |
| excesoAplicado | Decimal | porcentaje aplicado |
| cantidadAPesar | Decimal \| null | activo con exceso, sin redondear (R8) |
| unidadMedida | UnidadMedida | unidad base de la magnitud |
| esEnraseManual | Boolean | true = la cantidad la registra el farmacéutico al preparar |
| orden | Integer | posición de la línea: la de su componente según la regla de orden de arriba |

## Validaciones (devuelven error, no generan ficha)

Las validaciones V1, V2 y V4–V9 son los requirements de igual ID. V3 ya no existe:

- ~~**V3** — Componente CSP que no ocupa el último orden.~~ **Eliminada** (migración 0065): los componentes ya no tienen orden.

## Invariantes

- La función no lee ni escribe base de datos.
- Todo cálculo usa numeric/decimal de precisión fija. Prohibido float.
- Las líneas generadas se persisten congeladas. Un cambio posterior en Droga o UnidadMedida no las recalcula.
- Una línea con `esEnraseManual = true` recibe su cantidad real al confirmar la preparación. Esa cantidad se guarda en el `MovimientoStock` (EGRESO_PREPARACION) y en `DetalleAsiento`, no en `LineaPesaje`.
- Para líneas no manuales, el egreso de stock es exactamente `cantidadAPesar`, salvo que se registre la pesada real (`openspec/specs/pesada-real/spec.md`, migración 0088): entonces es la pesada real. Para líneas manuales, es la cantidad registrada por el farmacéutico.
- `orden` de salida sigue la regla de orden de los componentes (cantidad, CS, CSP; luego nombre de droga).

**Versiones, vigencia y preparación** (2026-10-15, `openspec/specs/reserva-stock-preparacion/spec.md` R18-R20):

- Una ficha es **vigente** para su ítem cuando es la última versión y recalcular las líneas con los datos actuales del ítem (y los parámetros de pesaje actuales) da exactamente sus líneas (`mismasLineasPesaje`, la misma regla que decide si la regeneración tras editar crea una versión nueva). Si no, está **desactualizada**: no se puede reservar stock sobre ella hasta generar una versión nueva (`fichas.generar`). Editar la receta no genera fichas a quien no tiene `fichas.generar` (GA2 de `openspec/specs/presupuesto-receta/spec.md`); el laboratorio la genera desde la toma.
- No se genera una versión nueva mientras el ítem tiene una preparación viva: CONFIRMADA (como siempre) o INICIADA con stock reservado («Liberá la reserva antes de generar una nueva versión»).

**Impacto en invariantes previos del plan:**

- **INV-R04** pasa a ser: `cantidadAPesar > 0` si la línea no es manual; `cantidadAPesar` y `cantidadTeorica` nulas si es manual. Ambas congeladas al generarse.
- **INV-S12** pasa a ser: el consumo de una línea no manual es exactamente `cantidadAPesar`; el de una línea manual es la cantidad registrada al confirmar (> 0). The consumption (`movimiento_stock`) is in the droga's unidad base, `cantidadAPesar` in the línea's unit: they are compared after converting (migration 0073; `openspec/specs/reserva-stock-preparacion/spec.md` R12).

## No hacer

- No calcular el CSP de cápsulas por diferencia de peso.
- No restar mg de un sólido a ml de un vehículo.
- No usar la cantidad con exceso de los activos para calcular el CSP.
- No redondear el activo a la balanza: se redondea el peso físico en la pesada real.
- No recalcular líneas existentes leyendo el maestro.
- No permitir que el usuario edite `cantidadAPesar` de una línea no manual.
- No usar float en ningún paso.

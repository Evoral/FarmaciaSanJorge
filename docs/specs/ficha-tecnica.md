# SPEC — Cálculo de ficha técnica (LineaPesaje)

> Fuente: definición del usuario (DP-06c, 2026-09-21). Fuente de verdad para el punto 7.1 del plan.
> Las notas marcadas **[ACLARACIÓN]** son deducciones de consistencia entre reglas y casos de prueba; no agregan requisitos nuevos.

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
| orden | Integer |

`modoExpresion` **reemplaza** al booleano `esCantidadSuficiente` del diagrama.

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
| precisionBalanza | 0.001 (en GRAMO) |
| excesoPesadaPorcentaje | 0 |

### LineaPesaje (salida)

| Campo | Tipo | Nota |
|---|---|---|
| drogaId | UUID | |
| cantidadTeorica | Decimal \| null | antes de exceso y redondeo |
| excesoAplicado | Decimal | porcentaje aplicado |
| cantidadAPesar | Decimal \| null | redondeada a la balanza |
| unidadMedida | UnidadMedida | unidad base de la magnitud |
| esEnraseManual | Boolean | true = la cantidad la registra el farmacéutico al preparar |
| orden | Integer | igual al del componente |

## Reglas de cálculo

- **R1 — TOTAL.** `cantidadTeorica` = cantidad convertida a la unidad base de su magnitud.
- **R2 — POR_DOSIS.** `cantidadTeorica` = cantidad × fraccionDosisPorUnidad × cantidadUnidades, convertida a unidad base.
- **R3 — CSP en formas no capsulares, misma magnitud.** Si `formaFarmaceutica` no es CAPSULA ni COMPRIMIDO, y todos los componentes no-CSP y `unidadTotal` pertenecen a la misma `tipoMagnitud`: `cantidadTeorica` = cantidadTotal − Σ cantidadTeorica(resto de componentes), todo en unidad base.
- **R4 — CSP con magnitudes distintas.** Si algún componente o el total difieren en `tipoMagnitud` (ej. mg de sólido en ml de jarabe): `esEnraseManual = true`, `cantidadTeorica = null`, `cantidadAPesar = null`.
- **R5 — CSP en cápsulas o comprimidos.** Siempre `esEnraseManual = true`. El excipiente se completa por volumen al preparar.
- **R6 — CS.** Siempre `esEnraseManual = true`. No participa del cálculo de R3.
- **R7 — Exceso de pesada.** Sobre toda línea no manual: `cantidadConExceso = cantidadTeorica × (1 + excesoPesadaPorcentaje / 100)`.
- **R8 — Redondeo.** `cantidadAPesar` = cantidadConExceso redondeada a múltiplo de `precisionBalanza`, modo half-up. El cálculo de R3 usa `cantidadTeorica` de los activos, no la cantidad redondeada.
- **R9 — Conversión de unidades.** Solo dentro de la misma `tipoMagnitud`, usando `UnidadMedida.factorABase`. Nunca peso ↔ volumen.

**[ACLARACIÓN] R3 y R6:** los componentes CS se excluyen tanto de la resta de R3 como de la comprobación de "misma magnitud" (ver T4).

## Validaciones (devuelven error, no generan ficha)

- **V1** — ItemReceta sin componentes.
- **V2** — Más de un componente CSP.
- **V3** — Componente CSP que no ocupa el último orden.
- **V4** — CSP presente y `cantidadTotal` o `unidadTotal` nulos.
  **[ACLARACIÓN]** Solo aplica a formas no capsulares. Para CAPSULA/COMPRIMIDO el total no es requerido (T3).
- **V5** — R3 da resultado ≤ 0: los componentes superan el total.
- **V6** — TOTAL o POR_DOSIS con cantidad nula o ≤ 0.
- **V7** — CS o CSP con cantidad no nula.
- **V8** — fraccionDosisPorUnidad ≤ 0 o > 1.
- **V9** — cantidadUnidades ≤ 0.

## Invariantes

- La función no lee ni escribe base de datos.
- Todo cálculo usa numeric/decimal de precisión fija. Prohibido float.
- Las líneas generadas se persisten congeladas. Un cambio posterior en Droga o UnidadMedida no las recalcula.
- Una línea con `esEnraseManual = true` recibe su cantidad real al confirmar la preparación. Esa cantidad se guarda en el `MovimientoStock` (EGRESO_PREPARACION) y en `DetalleAsiento`, no en `LineaPesaje`.
- Para líneas no manuales, el egreso de stock es exactamente `cantidadAPesar`. Para líneas manuales, es la cantidad registrada por el farmacéutico.
- `orden` de salida respeta el de entrada.

**Impacto en invariantes previos del plan:**

- **INV-R04** pasa a ser: `cantidadAPesar > 0` si la línea no es manual; `cantidadAPesar` y `cantidadTeorica` nulas si es manual. Ambas congeladas al generarse.
- **INV-S12** pasa a ser: el consumo de una línea no manual es exactamente `cantidadAPesar`; el de una línea manual es la cantidad registrada al confirmar (> 0).

## Casos de prueba (deben pasar exactos)

- **T1 — Crema, asiento 34163.** CREMA · total 30 GRAMO · unidades 1 · fracción 1. Ácido salicílico 3 GRAMO TOTAL; Vaselina sólida null GRAMO CSP → Ácido salicílico 3.000 g · Vaselina sólida 27.000 g.
- **T2 — Crema, asiento 34164.** CREMA · total 30 GRAMO. Hidroquinona 1.2 GRAMO TOTAL; Crema base null GRAMO CSP → Hidroquinona 1.200 g · Crema base 28.800 g.
- **T3 — Cápsulas, asiento 34147.** CAPSULA · unidades 30 · fracción 0.5 · total null. Mazindol 3 MILIGRAMO POR_DOSIS; Ludipress null GRAMO CSP → Mazindol 0.045 g · Ludipress enrase manual. (Con CSP en cápsulas V4 no aplica.)
- **T4 — Jarabe, asiento 34162.** JARABE · total 120 MILILITRO · unidades 1. Sulfato de zinc 1200 MILIGRAMO TOTAL; Jarabe simple null MILILITRO CS; Sorbitol null MILILITRO CSP → Sulfato de zinc 1.200 g · Jarabe simple enrase manual · Sorbitol enrase manual (R4).
- **T5 — Conversión.** TOTAL 1200 MILIGRAMO → 1.200 GRAMO.
- **T6 — Exceso y redondeo.** Exceso 5 %, precisión 0.01. TOTAL 1.234 GRAMO → teórica 1.234 · con exceso 1.2957 · a pesar 1.30.
- **T7 — Error V5.** CREMA total 30 g · activo 31 g TOTAL · CSP → error.
- **T8 — Error V2.** Dos componentes CSP → error.

## No hacer

- No calcular el CSP de cápsulas por diferencia de peso.
- No restar mg de un sólido a ml de un vehículo.
- No usar la cantidad redondeada de los activos para calcular el CSP.
- No recalcular líneas existentes leyendo el maestro.
- No permitir que el usuario edite `cantidadAPesar` de una línea no manual.
- No usar float en ningún paso.

## Pendiente de confirmar

- **Redondeo en volumen y unidades.** `precisionBalanza` está definida en GRAMO. No hay regla para redondear una línea no manual de magnitud VOLUMEN (ej. glicerina 10 ml TOTAL) o UNIDADES.

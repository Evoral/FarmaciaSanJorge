# Control table: ficha-tecnica

Original: `git show 8e1ac1c:openspec/specs/ficha-tecnica/spec.md`.

Spanish kept throughout (the one English sentence inside INV-S12 stays English, as in the original); only the CLI
keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The title drops its "SPEC — " prefix. R1–R9, V1, V2, V4–V9
keep their IDs (code cites "R7", "R8", "R1-R9", "V1..V9"; `parametros-registry.ts` shows users "ficha-tecnica/spec.md,
regla R8"). No rule was split. Rules without an ID (Modelo notes, Invariantes, Versiones, Impacto, No hacer) became
requirements without a new number; INV-R04 and INV-S12 are named by the plan IDs the original uses. The test cases
T1–T8 are scenarios with their exact numbers and every element (forma, total, unidades, fracción, components,
outputs, the "V4 no aplica" note of T3, the "(R4)" of T4); a requirement "Casos de prueba exactos" keeps "deben pasar
exactos" and maps each T to its scenario.

Numbers computed by the converter (all in **derived** scenarios): V5 "R3 da exactamente 0" (CREMA total 30 GRAMO,
activo 30 GRAMO TOTAL: 30 − 30 = 0 ≤ 0 → error); V8 1.5 (> 1). Every other number comes from T1–T8.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Title | `# Cálculo de ficha técnica (LineaPesaje)` | — | "SPEC — " dropped. |
| "> Fuente" / "> [ACLARACIÓN]" blockquote | `## Purpose` (verbatim) | — | A one-sentence "what it is for" added before it. |
| Alcance (text + signature block) | "Alcance — función pura" (signature as inline code) + `## Alcance` (verbatim) | "Cálculo de un ítem" (direct) | Also carries Invariantes bullet 1 ("no lee ni escribe base de datos"). |
| Modelo › ItemReceta table: `fraccionDosisPorUnidad` default 1, "½ dosis" = 0.5 | "Fracción de dosis por unidad" | "Media dosis" (direct) | The other columns are definitions; the table stays verbatim in `## Modelo` (cited by `schema.prisma`). |
| Modelo › ComponenteItemReceta table; `modoExpresion` reemplaza `esCantidadSuficiente`; Enum ModoExpresion block | "Modo de expresión" + `## Modelo` (verbatim) | "Vaselina csp 30" (**derived**) | Enum meanings written inline in the requirement. |
| Modelo › `esPrincipioActivo` copiado (0063) | "Principio activo copiado del catálogo" | "Componente de clase DROGA" (direct); "Componente de otra clase" (**derived**: false) | — |
| Modelo › componentes sin orden (0065) | "Componentes sin orden" | "Listado de los componentes de T4" (**derived**); "Dos componentes con cantidad" (direct) | — |
| Modelo › ParametrosPesaje table | "Parámetros de pesaje" | "Tenant con los valores por defecto" (**derived**) | — |
| Modelo › LineaPesaje (salida) table | "Línea de pesaje de salida" | "Línea de T6" (**derived**: T6 read as a línea) | — |
| Modelo › `orden` column; Invariantes bullet 6 | "Orden de las líneas de salida" | "Líneas de T4" (**derived**) | — |
| R1 | R1 | "Ácido salicílico de T1" (direct, from T1) | — |
| R2 | R2 | T3 (direct, full test case) | — |
| R3 + [ACLARACIÓN] R3 y R6 | R3 | T1, T2 (direct) | The aclaración is in both R3 and R6, marked [ACLARACIÓN]. |
| R4 | R4 | T4 (direct, full) | — |
| R5 | R5 | "Ludipress de T3" (direct) | — |
| R6 + [ACLARACIÓN] | R6 | "Jarabe simple de T4", "CS fuera de la resta de R3" (direct) | — |
| R7 | R7 | T6 (direct, full); "Línea manual" (**derived**: "sobre toda línea no manual" + INV-R04 nulls) | — |
| R8 | R8 | "Redondeo de T6", "CSP con un activo redondeado" (direct) | — |
| R9 | R9 | T5 (direct); "Sólido en un vehículo líquido" (**derived**, from T4/R4) | — |
| "Validaciones (devuelven error, no generan ficha)" | each V requirement: "SHALL devolver un error de validación, sin generar ficha" | — | Heading kept as `## Validaciones (...)` holding V3, plus one pointer sentence added by the converter ("Las validaciones V1, V2 y V4–V9 son los requirements de igual ID. V3 ya no existe:"), so the "Validaciones" citations in `mensajes-validacion.ts` still resolve. |
| V1 | V1 | "Ítem vacío" (direct) | — |
| V2 | V2 | T8 (direct) | — |
| V3 (eliminada, 0065) | `## Validaciones (...)` (verbatim, struck through) | — | A removed rule: not a requirement. |
| V4 + [ACLARACIÓN] | V4 | "Crema con CSP sin total" (direct); "Cápsulas con CSP sin total" (direct, T3 note) | — |
| V5 | V5 | T7 (direct); "R3 da exactamente 0" (**derived**, computed) | — |
| V6 | V6 | "TOTAL sin cantidad", "POR_DOSIS con cantidad 0" (direct) | — |
| V7 | V7 | "CSP con cantidad" (direct) | — |
| V8 | V8 | "Fracción 0" (direct); "Fracción mayor a 1" (**derived**: 1.5), "Fracción 1" (**derived**: boundary) | — |
| V9 | V9 | "Cero unidades" (direct) | — |
| Invariantes bullet 2 (decimal, prohibido float) + No hacer "No usar float" | "Decimal de precisión fija" | "Exceso y redondeo sin float" (**derived**, T6 numbers) | — |
| Invariantes bullet 3 (congeladas) | "Líneas congeladas" | "Cambio en el maestro" (direct) | Also carries No hacer "No recalcular líneas existentes leyendo el maestro". |
| Invariantes bullet 4 (cantidad real de línea manual) | "Cantidad real de una línea manual" | direct | — |
| Invariantes bullet 5 (egreso; pesada real 0088) | "Egreso de stock por línea" | three (direct) | — |
| Versiones bullet 1 | "Ficha vigente o desactualizada", "Ficha desactualizada sin reserva" | "Parámetro de pesaje cambiado" (**derived**); "Versión anterior", "Reserva sobre una ficha desactualizada", "Edición sin fichas.generar" (direct) | Split in two (over 500). Part 2 names its antecedent ("Sobre una ficha desactualizada"). The date and the R18-R20 reference stay in part 1. |
| Versiones bullet 2 | "Sin versión nueva con una preparación viva" | both (direct) | "No se genera" written "MUST NOT generarse". |
| Impacto › INV-R04 | "INV-R04 — Cantidades de la línea" | both (direct) | — |
| Impacto › INV-S12 | "INV-S12 — Consumo de la línea" | "Línea en gramos, droga en miligramos", "Línea manual sin cantidad" (**derived**) | — |
| Invariantes, Versiones, Impacto (whole section) | `## Invariantes` (verbatim) | — | Kept verbatim; `estado-ficha.ts` cites "Versiones, vigencia y preparación". |
| Casos de prueba T1–T8 "(deben pasar exactos)" | scenarios named T1–T8 + "Casos de prueba exactos" | "Resultado de un caso de prueba" (direct) | No separate test-case section kept (precedent: reglas-precio). |
| No hacer (6 bullets) | "No hacer" + `## No hacer` (verbatim) | "CSP de cápsulas" (direct); "Edición de la cantidad a pesar" (**derived**) | — |
| Pendiente de confirmar | `## Pendiente de confirmar` (verbatim) | — | Known gap, not a rule. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

Derived scenarios: 16 of 56.

## Conflicts and stale points (kept as written)

- R8 rounds every non-manual línea to `precisionBalanza`; the code does not round non-MASA líneas
  (`calcular-ficha-tecnica.test.ts`: "non-MASA non-manual lines are NOT rounded ... pending confirmation"). The
  original's own "Pendiente de confirmar" names this gap; R8 is kept as written.
- INV-S12 ("el consumo de una línea no manual es exactamente `cantidadAPesar`") predates the pesada real: per
  `openspec/specs/pesada-real/spec.md` P6 a línea with a `fsj.pesada_real` row is checked against `cantidad_real`.
  Invariantes bullet 5 already says so; INV-S12 was not updated.
- `parametros-registry.ts` limits `precision_balanza` to {0.1, 0.01, 0.001}; the spec documents only the default
  (the registry's comment says so). Not a conflict.
- "Sin versión nueva" message: the reserva-stock-preparacion review found `generar-ficha-tecnica.ts` adds "(una
  preparación en curso)" (pre-existing).

`openspec validate ficha-tecnica --type spec --strict`: valid (CLI 1.14.1). 36 requirements, 56 scenarios. `chk.py`
silent: every requirement text parsed by the CLI matches the file.

## Review (2026-10-26)

Independent review (separate agent): APPROVE. Rules, T1-T8 and computed numbers confirmed in code. Fixed: "Línea manual" no longer says no exceso is applied (the code still stores `excesoAplicado`; only the quantities are null).

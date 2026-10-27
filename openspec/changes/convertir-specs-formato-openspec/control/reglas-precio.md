# Control table: reglas-precio

Original: `git show 1916dcb:openspec/specs/reglas-precio/spec.md`.

The original has no rule IDs, so the requirements have none (design §1). Its test cases RP1–RP8 keep their IDs as
scenario names. Spanish kept throughout; only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The
title drops its "SPEC — " prefix. Every scenario number comes from the original (Fórmula, Caída, Ejemplos table with
piso 20.000 and the tramos «≤ 100.000 → +100 %» / «> 100.000 → +70 %», RP1–RP8); no number was computed.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Title | `# Reglas de precio: tramos de margen por costo y precio mínimo` | — | "SPEC — " prefix dropped. |
| "> Fuente: …" blockquote | `## Purpose` (verbatim) | — | A one-line "what it is for" sentence added before it, taken from the title. |
| "> Código: …" blockquote | `## Código` (verbatim) | — | — |
| Fórmula block | "Fórmula del precio final" (block verbatim in the body) | RP4 (direct: 15.000 → 30.000, also the Ejemplos row) | The CLI's parsed text stops at the blank line before the block; the block stays in the requirement body. |
| Table: Costo | "Costo de una preparación" | RP8 (direct) | — |
| Table: Origen del costo | "Origen del costo por línea" | "Ítem con líneas de los dos orígenes" (**derived**) | — |
| Table: Tramos | "Tramos" | "Costo 0 en el primer tramo" (direct: Ejemplos row 0 → +100 %); "Costo por encima del último tope" (direct: row 100.001 → +70 %) | — |
| Table: Límite | "Límite de un tramo" | RP1, RP2 (direct) | — |
| Table: Margen | "Margen sobre todo el costo" | "Costo en el segundo tramo" (direct: row 100.001 → 170.001,70) | — |
| Table: Precio mínimo | "Precio mínimo" | RP3 (direct, with row 5.000); "Precio del tramo igual al piso" (direct: row 10.000); RP5 (direct, with row 0) | — |
| Caída de precio en el límite (intencional) | "Caída de precio en el límite (intencional)" | "El precio baja al cruzar el límite" (direct) | Example kept in the requirement text; "no se corrige ni se suaviza" written "MUST NOT corregirse ni suavizarse". |
| Ejemplos table (6 rows) | Scenarios of Fórmula, Tramos, Margen, Precio mínimo | see rows above | Every row is used, with its numbers unchanged. |
| Validación: three bullets + heading "(sin superposiciones ni huecos por construcción)" | "Validación de los tramos" | RP7 (direct) | — |
| Validación: where it is validated (domain, CHECKs, indexes, INV-PR-002) | "Validación en el dominio y en la base" | "Tope no creciente en el formulario" (**derived**: "mensajes por tramo") | — |
| Modelo bullet 1 (INV-PR-001 versioning) | "Versionado (INV-PR-001)" | "Guardar una versión nueva" (**derived**) | — |
| Modelo bullet 2 (`regla_precio.margen` obsoleta) | "Margen de la cabecera obsoleto" | "Versión nueva" (**derived**) | — |
| Modelo bullet 3 (data migration) | "Migración de datos" | "Versión anterior a los tramos" (**derived**); RP6 (direct) | RP6 placed here: it is the "precios no cambian" case. |
| Modelo bullet 4 (`margen_aplicado`, `precio_minimo_aplicado`) | "Datos aplicados en la cotización" | "Cotización con piso aplicado" (**derived**: Ejemplos row 5.000 read through this rule; "100" is the "+100 %" of the tramo) | — |
| Permisos | "Permiso de edición" | "Usuario sin el permiso" (**derived**: "se edita con" read as "only with") | — |
| Interfaz | "Interfaz" | "Pantalla de configuración", "Cotización de un ítem" (**derived**) | — |
| Casos de prueba RP1–RP8 | Scenarios named RP1–RP8 | — | No separate test-case section is kept (precedent: sinonimos-droga). |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

## Conflicts and stale points (kept as written)

- "Origen del costo" cites `costos-proveedor.md` (R25–R28); the file is now `openspec/specs/costos-proveedor/spec.md`.
  The rule IDs still match.
- Checked against `modules/precios/domain/regla-precio.ts`: tramo lookup is `costo <= costoHasta` (inclusive top),
  `precioMinimoAplicado = precioTramo < precioMinimo` (equal is not marked), no rounding of the final price, and the
  validation messages match the Validación bullets. No conflict found.

`openspec validate reglas-precio --type spec --strict`: valid (CLI 1.14.1). 16 requirements, 22 scenarios.

## Review (2026-10-26)

Independent review (separate agent): APPROVE. RP1-RP8 keep their exact numbers; all 8 derived scenarios
confirmed in code (`costo <= costoHasta`; floor only when `precioTramo < precioMinimo`; RP7 validation; costs
summed per ítem before the tramo; NULL `margen` on new versions; 0052 backfill; permiso via `defineCommand`).
Adjusted: "Tope no creciente en el formulario" now says the message indicates the tramo; the code shows one
form-level alert prefixed "Tramos de margen › n.º 2 › Costo hasta: ...", not an inline message (the original's
"mensajes por tramo" is equally loose).

## Fix after commit (2026-10-26)

The formula sat in a fenced block inside the "Fórmula del precio final" requirement; the CLI drops fenced blocks
from requirement text, so `openspec show` returned the requirement without its formula. It is now inline code
(same formula, unchanged).

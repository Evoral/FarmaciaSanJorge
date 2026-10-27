# Control table: domicilios

Original: `git show b110c3a:openspec/specs/domicilios/spec.md`.

Mixed language kept as in the original: the English intro, table header and format line stay English; D1–D6 stay
Spanish. Only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are added. D1–D6 keep their IDs; no rule was split.
The "Where each one lives" rows and the intro and format sentences became requirements without a number. No number
was computed.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Intro: user decision, two domicilios, migration 0099 | `## Purpose` (verbatim) | — | One "what it is for" sentence added before it. |
| Intro: "When only one is loaded, it is used for both" | "One domicilio loaded is used for both" | "Receta with only its domicilio" (**derived**: the envío as the use) | — |
| Table row: Domicilio del cliente | "Domicilio del cliente" | "Editing the ficha" (direct) | Table also kept verbatim in `## Where each one lives`. |
| Table row: Domicilio de entrega del cliente | "Domicilio de entrega del cliente" | "Cliente without domicilio de entrega" (**derived**); "A receta never writes it" (**derived**: "Solo su ficha") | — |
| Table row: Domicilio de la receta | "Domicilio de la receta" | "Cliente moves after the receta" (**derived**: "Se guarda por receta") | — |
| Table row: Domicilio de entrega de la receta | "Domicilio de entrega de la receta" | "Receta form" (direct) | — |
| D1 | D1 | "Cliente con los dos domicilios", "Cliente sin domicilio de entrega" (direct) | — |
| D2 | D2 | "Documento con domicilio", "Documento sin domicilio" (direct) | — |
| D3 | D3 | "Confirmar sin cambios", "Domicilio corregido a mano" (direct); "Alta de cliente desde la importación" (**derived**: "con ese mismo criterio") | — |
| D4 | D4 | "Edición de la receta" (direct) | "nunca cambia" written "SHALL NOT cambiar nunca". |
| D5 | D5 | "Receta con domicilio de entrega", "Receta sin domicilio de entrega" (direct) | — |
| D6 | D6 | "Envío de una receta sin domicilios" (direct) | — |
| Format line (free text, trimmed, `''` = `NULL`, máx. 300, not in the asiento or its hash) | "Formato de los domicilios" | "Blank domicilio" (**derived**: trim then `''` = `NULL`); "Libro recetario" (direct) | — |
| Code, Rollback | `## Code` (verbatim) | — | — |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. 12 requirements, 19
scenarios, 6 derived.

## Conflicts and stale points (kept as written)

- D6 checked in code: `actualizarDomicilioReceta` (`modules/entregas/infrastructure/entrega-repository.ts`) writes
  `domicilioEntrega`, audited with `valorAnterior/valorNuevo: { domicilioEntrega }`. No conflict here, but two other
  specs still say the envío writes `receta.domicilio_paciente`: `envios-repartidores` E4 (not in this tanda) and
  `importacion-receta-pdf` › "Domicilio del paciente" (recorded in its control table).

`openspec validate domicilios --type spec --strict`: valid (CLI 1.14.1); CLI text check: OK.

## Review (2026-10-26)

Independent review: APPROVE with fixes. Fixed: "A receta never writes it" and "Cliente moves after the receta" re-marked explicitly as **derived**. 12 requirements, 19 scenarios, 6 derived (unchanged).

Pre-existing, kept as written: `importacion-receta-qr` › Límites de los avisos says "el tope solo corre en el camino del QR", contradicting `modules/recetas/application/leer-receta-pdf.ts:176` (`acotarAvisos` on the PDF path too).

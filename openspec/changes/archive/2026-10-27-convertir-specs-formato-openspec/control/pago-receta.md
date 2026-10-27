# Control table: pago-receta

Original: `git show b110c3a:openspec/specs/pago-receta/spec.md`.

Spanish kept throughout; only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The title drops its
"SPEC — " prefix. P1–P9 keep their IDs. Rules over the 500-character limit or holding two behaviors were split into
requirements carrying the same ID, each naming its antecedent: P3 ×2, P4 ×4, P5 ×2, P6 ×2, P8 ×2. Rules without an
ID (Alcance, Modelo, Permisos, Auditoría, Listados, Casos borde) became requirements without a number. No number was
computed.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Estado blockquote (status, 0071/0076, rollbacks) + Decisión line | `## Estado` (verbatim) | — | Decisión line also in `## Purpose`. |
| Alcance ¶1 (marca, quién/cuándo, crear/entregar/detalle) | "Marca Pagada / Impaga" | "Receta marcada pagada", "Momentos para registrar el pago" (direct) | `## Alcance` kept verbatim. |
| Alcance: Fuera de alcance | "Solo una marca" | "Registrar un pago" (**derived**) | — |
| Alcance: Relación con el plan (DP-30) | `## Alcance` (verbatim) | — | Non-normative. |
| Modelo table (three columns) | "Columnas del pago" | "Receta anterior a la migración 0071" (direct) | `## Modelo` kept verbatim. |
| Modelo: `receta_pagada_check` | "Las tres columnas cambian juntas" | "Pagada sin momento ni usuario" (**derived**) | — |
| Modelo: El pago NO es un estado | "El pago no es un estado de la receta" | "Pagada y pendiente de preparación" (direct) | "No se agregó `PAGADA`" is a decision record: verbatim in `## Decisiones`, not a requirement. |
| P1 | P1 | "Marcar pagada", "Valores enviados por el cliente" (direct, the latter from the enforcement column); "Desmarcar" (**derived**: the three column values) ; "Desmarcar y volver a marcar" (direct, Casos borde) | — |
| P2 | P2 | "Alta sin tocar la casilla", "Alta con la casilla tildada" (direct) | — |
| P3 | P3 "Pago al entregar" + P3 "Switch … de solo subida" | one each (direct) | Split. |
| P4 | P4 ×4 (solo pagada; retiro presencial; envío; rechazo sin pago) | "Receta impaga sin marcar al entregar", "Retiro presencial marcando el pago", "Envío impago", "Confirmar la firma de un envío impago", "Momentos para marcar el pago de un envío" (Casos borde), "Botón deshabilitado" (direct) | Split. |
| P5 | P5 "Pago en el detalle" + P5 "Switch bloqueado…" | "Marcar desde el detalle" (**derived**: example state and permiso); "Detalle de una receta entregada y pagada" (direct) | Split. |
| P6 (+ enforcement column: "Anular una receta pagada no toca la marca") | P6 "…menos ANULADA" + P6 "En ENTREGADA solo se puede marcar" | "Receta anulada", "Anular una receta pagada", "Entregada e impaga" (Casos borde), "Desmarcar una receta entregada" (direct) | Split; the normative sentence from the enforcement column is in P6 part 1. |
| P7 | P7 | "Marcar una receta ya pagada" (direct) | — |
| P8 | P8 "Switch … en la edición" + P8 "Espacio de toma de /preparaciones" | "Pago olvidado en la carga inicial" (direct); "Edición de una receta ya pagada sin tocar el switch" (**derived**: no audit row, P7 applied); "Guardar desde el espacio de toma" (direct) | Split. |
| P9 | P9 | "Usuario suspendido" (direct, Casos borde) | — |
| Reglas table "Dónde se hace cumplir" column | `## Reglas` (whole table verbatim) | — | Kept as the enforcement map. |
| Permisos: intro + crear/importar + ver/filtrar rows | "Permisos existentes" | "Marcar al crear" (direct) | Table not kept; every cell is in the requirement text. |
| Permisos: entregar row | "Permiso para marcar al entregar" | "Quien entrega sin recetas.editar" (direct) | — |
| Permisos: detalle row | "Permiso para marcar o desmarcar desde el detalle" | "Usuario sin recetas.editar" (**derived**) | — |
| Auditoría: intro, crear/importar, detalle, "misma transacción" | "Auditoría de todo cambio de pagada" | "Marcar desde el detalle", "Alta pagada" (direct) | — |
| Auditoría: entrega | "Auditoría del pago en la entrega" | "Entrega que marca el pago" (direct) | — |
| Listado de recetas: columna + filtro | "Columna y filtro Pago en el listado de recetas" | "Filtrar las impagas" (direct) | — |
| Listado de recetas: Excel | "Pago en el Excel de recetas" | "Exportar con el filtro de pago" (direct) | — |
| Listado de recetas: no contador de impagas | `## Decisiones` (verbatim) | — | Decision record, not a requirement. |
| Listado de recetas: sin índice nuevo | `## Decisiones` (verbatim) | — | Non-normative design note. |
| Listado de entregas: pago | "Pago en el listado de entregas" | "Entrega pendiente impaga" (direct) | — |
| Listado de entregas: precio | "Precio en el listado de entregas" | three direct; "Usuario sin cotizaciones.ver" (**derived**) | — |
| Listado de entregas: anular entrega (A6) | "Anular una entrega registrada por error" | "Anular la entrega y dejar la receta impaga" (**derived**: the choice to leave it impaga) | — |
| Casos borde: entregada e impaga; envío; dos usuarios; desmarcar y volver a marcar | scenarios under P6, P4, "Bloqueo de la receta al marcar", P1 | see rows above | The `SELECT … FOR UPDATE` sentence became the requirement "Bloqueo de la receta al marcar" ("Dos usuarios a la vez", direct). |
| Casos borde: receta anulada (detalle no ofrece la acción) | "Receta anulada sin acción de pago en el detalle" | "Detalle de una receta anulada" (direct) | "no ofrece" written "SHALL mostrarse sin la acción". |
| Casos borde: usuario suspendido; históricos no se revalidan | P9 scenario + "Usuario suspendido o dado de baja" (original wording) | "Usuario dado de baja después de marcar" (**derived**) | — |
| Código que lo implementa | same-named section (verbatim) | — | — |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. 34 requirements, 48
scenarios, 9 derived.

## Conflicts and stale points (kept as written)

None found in the text. Code was not read for this spec beyond what other specs needed.

`openspec validate pago-receta --type spec --strict`: valid (CLI 1.14.1); CLI text check: OK.

## Review (2026-10-26)

Independent review: APPROVE with fixes. Fixed: the two "No se agregó" decision records (`PAGADA` in `EstadoReceta`, contador de impagas) left the requirements and sit verbatim in `## Decisiones` (with the "Sin índice nuevo" note); P8 /preparaciones, detalle anulado and registros históricos rephrased as the original states them ("no envía `pagada` y SHALL dejar el pago como está", "SHALL mostrarse sin la acción", "SHALL NOT poder ser `pagada_por_id` de un registro nuevo; los históricos no se revalidan"); P8 "sin tocar el switch" marked derived (no audit row). Now 34 requirements, 48 scenarios, 9 derived.

Pre-existing, kept as written: `importacion-receta-qr` › Límites de los avisos says "el tope solo corre en el camino del QR", contradicting `modules/recetas/application/leer-receta-pdf.ts:176` (`acotarAvisos` on the PDF path too).

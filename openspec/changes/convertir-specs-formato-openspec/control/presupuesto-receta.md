# Control table: presupuesto-receta

Original: `git show 1916dcb:openspec/specs/presupuesto-receta/spec.md`.

The original has no rule IDs, so the requirements have none (design §1). Its test cases PR1–PR8 and GA1–GA4 keep
their IDs as scenario names. Spanish kept throughout; only the CLI keywords are English. The title drops its
"SPEC — " prefix. Code cites the sections "Edición" and "Generación automática al confirmar" by name
(`editar-receta.ts`, `recetas-m3-lock-order.test.ts`, `generar-fichas-y-cotizaciones.ts`, `avisos-generacion.ts`):
both names survive as requirement names. The only numbers in scenarios (3 g / 2 g, 600 ms) are the original's.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| "> Fuente: …" (user request 2026-09-30) | `## Purpose` (verbatim) | — | A one-line "what it is for" sentence added before it. |
| "> Se apoya en … [ACLARACIÓN] …" | `## Referencias` (verbatim) | — | — |
| Alcance 1–2 + Fuera de alcance | `## Purpose` (verbatim) | — | — |
| Alcance 1 (presupuesto en vivo, incl. edición, revisado 2026-10-16) | "Presupuesto en vivo" | "Edición de una receta guardada" (**derived**) | — |
| Table: Permiso | "Permiso de `recetas.presupuestar`" | "Usuario sin el permiso" (**derived**) | — |
| Table: Entrada | "Entrada del presupuesto" | "Receta todavía no guardada" (**derived**) | — |
| Table: Efectos | "Sin efectos (INV-R02)" | PR6 (direct) | "Ninguno" written "MUST NOT tener efectos". |
| En memoria 1 (ficha) | "Ficha de cada ítem en memoria" | "Misma ficha que la generada" (**derived**) | — |
| En memoria 2, first sentence (same calc, regla vigente) | "Costo de la receta completa" | PR1 (direct) | — |
| En memoria 2, "pero acumulado por droga…" + "Con el reparto acumulado, …" | "Costo acumulado por droga" | PR7 (direct) | Split from the previous row; the later sentence after the Resultado table joined here. |
| Origen del costo por línea, sentence 1 | "Origen del costo por línea" | "Línea con costo de proveedor y sin stock", "Línea sin costo de proveedor" (**derived**) | Split in four (500-character limit). |
| Origen, sentence 2 (simulation runs for all líneas) | "Simulación de stock en todas las líneas" | "Ítems siguientes ven el consumo de una línea de proveedor" (**derived**) | — |
| Origen, sentence 3 (faltante informativo) | "Faltante informativo en líneas de proveedor" | "Línea de proveedor sin stock suficiente" (**derived**) | — |
| Origen, sentence 4 (panel shows origin) | "Origen de cada línea en el panel" | "Ítem con una línea de proveedor" (**derived**) | — |
| "Ambos pasos comparten el código…" | "Mismo código que los comandos" | "Presupuesto y cotización de un ítem" (**derived**; limited to one ítem with nothing changed, because the saved cotización costs each ítem against the full stock, second [ACLARACIÓN]) | — |
| Resultado: Sin regla | "Sin regla de precio vigente" | PR4 (direct) | — |
| Resultado: Ítem calculable | "Ítem calculable" | PR2, PR3 (direct) | — |
| Resultado: Ítem no calculable | "Ítem no calculable" | PR5 (direct) | — |
| Resultado: Total | "Total del presupuesto" | "Un ítem no calculable" (**derived**) | — |
| Resultado: Stock de la receta | "Advertencia de stock de la receta" | "Demanda mayor que el stock" (direct: the original's Cafeína message); PR8 (direct) | — |
| [ACLARACIÓN] ×2 | `## Aclaraciones` (verbatim) | — | The original says they add no requirements, so they stay non-normative. |
| Interfaz bullet 1 (panel, hidden without permiso) | "Panel Presupuesto" | "Sin permiso" (**derived**) | See conflict 1. |
| Interfaz bullet 2 (600 ms, after PDF import, «Recalcular») | "Recálculo automático" | "Componente incompleto", "Componentes completos" (**derived**) | — |
| Interfaz bullet 3 (stale response discarded) | "Respuestas viejas descartadas" | "Respuesta fuera de orden" (**derived**) | — |
| Interfaz bullet 4 (never blocks confirm) | "El presupuesto nunca impide confirmar" | "Presupuesto con errores" (**derived**) | — |
| §2 intro, steps 1–2 | "Generación automática al confirmar" | "Receta confirmada" (**derived**) | — |
| §2 table: Independencia | "Independencia de los pasos" | "Falla la cotización" (**derived**) | — |
| §2 table: Permisos | "Permisos de la generación" | GA2 (direct); "Usuario sin `cotizaciones.calcular`" (**derived**) | — |
| §2 table: Errores | "Errores de la generación" | GA1 (direct) | — |
| §2 table: Aviso en la URL | "Aviso en la URL" | "Código no reconocido" (**derived**) | — |
| Edición ¶1 | "Edición — regeneración de fichas desactualizadas" | GA3 (direct) | "no toca" written "MUST NOT tocar". |
| Edición ¶2 | "Edición — no se quita un ítem con ficha" | GA4 (direct) | "No se puede quitar" written "MUST NOT quitarse". |
| Edición ¶3 | "Edición — accesos manuales" | "Regenerar desde el detalle" (**derived**) | — |
| Casos de prueba PR1–PR8, GA1–GA4 | Scenarios named with their IDs | — | No separate test-case section is kept (precedent: sinonimos-droga). |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

## Conflicts and stale points (kept as written)

1. Interfaz bullet 1 places the panel "en el alta manual y en la importación"; Alcance 1 (revisado 2026-10-16)
   also lists the edición of a saved receta, and the code shows it in every mode (`modules/recetas/ui/receta-form.tsx`:
   "show the live price in every mode"). The bullet was not updated in the 2026-10-16 revision.
2. File references use the old flat names (`ficha-tecnica.md`, `reglas-precio.md`, `costos-proveedor.md`,
   `reserva-stock-preparacion.md`); the specs now live in `openspec/specs/<n>/spec.md`.
3. Checked: the panel's debounce is 600 ms (`presupuesto-panel.tsx`, `DEBOUNCE_MS = 600`).

`openspec validate presupuesto-receta --type spec --strict`: valid (CLI 1.14.1). 29 requirements, 34 scenarios.

## Review (2026-10-26)

Independent review (separate agent): CHANGES NEEDED → fixed. Nothing lost, weakened or translated; PR1-PR8 and
GA1-GA4 keep their exact numbers. Derived scenarios: 21, not 20. Fixed:
- "Presupuesto con errores" said the receta is confirmed; the original says only that the presupuesto never
  blocks confirming, and `crear-receta.ts` still rejects a droga/unidad inexistente o de baja. The THEN now says
  the presupuesto does not block or disable confirming.
- "Regenerar desde el detalle" was unconditional; the links are gated by `puedeVerFichas` / `puedeVerCotizacion`
  (`app/(app)/recetas/[id]/page.tsx`). A GIVEN on the permisos was added.
- "Receta confirmada" now states its happy-path preconditions: with no regla de precio vigente or a failing
  V1-V9, `generar-fichas-y-cotizaciones.ts` leaves an aviso instead.

Accepted as derived: "Presupuesto y cotización de un ítem" asserts the same price for one ítem; the code
supports it (same `calcularLineasFicha`, same costing).

Confirmed conflict: the Interfaz bullet ("alta manual y en la importación") is stale; the edición also shows the
panel (`receta-form.tsx`, `editar/page.tsx`).

Pre-existing, kept as written: the panel heading in code is "Precio", not «Presupuesto»; the sin-regla message
in code is longer than «No hay regla de precios configurada»; Alcance 2 says "ítems cuya fórmula cambió" while
Edición says "ficha quedó desactualizada".

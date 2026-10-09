# SPEC — Presupuesto en la carga de recetas y ficha/cotización automáticas

> Fuente: pedido del usuario (2026-09-30): «en el mostrador, apenas se carga la receta, mostrar el precio para que el cliente decida si sigue. Si el cliente no sigue, no se guarda nada. Si sigue, la ficha y la cotización no deberían requerir los pasos manuales actuales».
> Se apoya en `ficha-tecnica.md` (cálculo de la ficha, V1–V9) y en la cotización existente (FASE 7.4, DP-09). Las notas **[ACLARACIÓN]** son deducciones de consistencia; no agregan requisitos.

## Alcance

1. **Presupuesto en vivo** mientras se carga una receta (alta manual e importación desde PDF). No guarda nada.
2. **Ficha técnica y cotización automáticas** al confirmar la receta (y al editarla, solo para los ítems cuya fórmula cambió).

Fuera de alcance: reservar stock, guardar presupuestos, presupuesto en la edición de una receta ya guardada.

## 1. Presupuesto — consulta `recetas.presupuestar`

| Aspecto | Regla |
|---|---|
| Permiso | `cotizaciones.calcular` (las mismas personas que cotizan un ítem guardado). |
| Entrada | Los ítems del formulario en curso, con la misma forma que `itemsJson`. Sin receta. |
| Efectos | Ninguno (INV-R02): no escribe fichas, cotizaciones ni movimientos; no bloquea ni reserva partidas. No se audita (es una consulta; además fichas y cotizaciones están fuera de la auditoría, plan §14). |

En memoria:

1. **Ficha de cada ítem**: el mismo cálculo que `fichas.generar` (unidades base, parámetros de pesaje del tenant y calculadora pura de `ficha-tecnica.md`).
2. **Costo de la receta completa**: el mismo cálculo que `cotizaciones.calcular` (jornada del tenant, partidas elegibles, reparto y calculadora pura) con la regla de precio vigente (tramos de margen por costo y precio mínimo, `reglas-precio.md`; cada ítem se cotiza con su propio costo), pero **acumulado por droga en el orden de los ítems**: el primer ítem consume de los saldos elegibles y el siguiente ve solo lo que queda. Así, dos ítems que usan la misma droga no pueden aparecer ambos cubiertos.

Ambos pasos comparten el código con los comandos existentes (`calcularLineasFicha`; `calcularCotizacion` y su reparto), de modo que el presupuesto y la cotización posterior aplican las mismas reglas.

### Resultado

| Caso | Resultado |
|---|---|
| Sin regla de precio vigente | Un único mensaje: «No hay regla de precios configurada». No se calcula nada. |
| Ítem calculable | Precio final, costo de insumos y, si corresponde: **Parcial** (algún excipiente se completa al preparar: enrase manual, costo 0) e **Incompleta** (stock insuficiente: se cotiza lo que hay e informa lo que falta por droga). |
| Ítem no calculable (V1–V9, droga o unidad inexistente o dada de baja) | Mensaje en lugar del precio. No interrumpe el resto. |
| Total | Suma de los ítems calculables. Si alguno no se pudo calcular, se indica que el total no lo incluye. |
| Stock de la receta | Si la demanda total de una droga en la receta supera el stock elegible, advertencia destacada a nivel receta: «Falta stock de Cafeína para toda la receta: se necesitan 3 g y hay 2 g disponibles.» Nunca bloquea. |

Con el reparto acumulado, `Incompleta`, los faltantes y el costo de cada ítem reflejan la receta completa.

[ACLARACIÓN] El stock comprometido por **otras** recetas pendientes no se descuenta en ningún cálculo: nada reserva stock (INV-R02).

[ACLARACIÓN] La cotización que se guarda al confirmar (por ítem) sigue costeando cada ítem contra el stock completo, como la cotización manual: descontar los demás ítems no sería consistente una vez que alguno ya se preparó (su stock ya salió y se descontaría dos veces).

### Interfaz

- Panel «Presupuesto» junto al botón de confirmar, en el alta manual y en la importación. Se oculta sin `cotizaciones.calcular`.
- Se recalcula solo, unos 600 ms después del último cambio, cuando todos los componentes tienen droga, unidad y cantidad válida. Tras importar un PDF, el primer cálculo ocurre en cuanto las drogas quedan identificadas. Botón «Recalcular».
- Una respuesta que llega después de un pedido más nuevo se descarta.
- El presupuesto nunca impide confirmar.

## 2. Generación automática al confirmar

Después de que `recetas.crear` o `recetas.importar` **confirman** (la transacción de la receta ya terminó), por cada ítem:

1. Se genera la ficha técnica (`fichas.generar`, versión 1).
2. Si la ficha se generó, se calcula y guarda la cotización (`cotizaciones.calcular`).

| Regla | Detalle |
|---|---|
| Independencia | Cada paso es un caso de uso aparte, con su propia transacción. Un error nunca deshace la receta. |
| Permisos | Sin `fichas.generar` no se genera nada; sin `cotizaciones.calcular` se generan solo las fichas. Sin aviso. |
| Errores | La receta queda guardada y su detalle muestra: «No se pudo generar la ficha técnica del ítem N: <motivo>. Podés generarla desde la receta.» (o el equivalente para la cotización). |
| Aviso en la URL | Solo códigos: paso, número de ítem y un código de una lista cerrada (`?aviso=f1-V5`). Nunca texto libre ni datos personales. La página arma el mensaje a partir del código e ignora lo que no reconoce. |

### Edición

`recetas.editar` no toca las fichas (son inmutables, INV-R05). Después de editar se aplica la misma generación, pero solo para los ítems cuya ficha quedó desactualizada: si las líneas recalculadas son idénticas a las de la última versión, no se crea una versión nueva ni se recotiza.

No se puede **quitar** un ítem que ya tiene ficha técnica (o cotización): fichas y cotizaciones son de solo inserción y referencian el ítem. La edición lo rechaza con «No se puede quitar el ítem N porque ya tiene ficha técnica. Si la receta se cargó mal, anulala y cargala de nuevo.» (N según el orden del detalle de la receta). Modificar el contenido de un ítem existente sigue permitido.

Los accesos manuales «Ficha técnica» y «Cotización» del detalle se mantienen para revisar, imprimir o regenerar.

## Casos de prueba

- **PR1** — Ítem normal: precio = max(costo × (1 + margen del tramo/100), precio mínimo) — ver `reglas-precio.md`.
- **PR2** — Cápsulas con excipiente CSP: resultado **Parcial**, el excipiente figura como «se completa al preparar».
- **PR3** — Stock insuficiente: resultado **Incompleta**, con el faltante por droga.
- **PR4** — Sin regla de precio: mensaje único, sin precios.
- **PR5** — Ítem con V8 o droga dada de baja: mensaje en ese ítem, los demás se calculan.
- **PR6** — El presupuesto no escribe fichas ni cotizaciones.
- **PR7** — Dos ítems con la misma droga y stock para uno solo: el segundo queda **Incompleta** y aparece la advertencia de stock de la receta.
- **PR8** — Dos ítems con la misma droga y stock para ambos: sin advertencia.
- **GA1** — Falla la ficha de un ítem: la receta queda guardada, aviso con el motivo, sin cotización para ese ítem.
- **GA2** — Usuario sin `fichas.generar`: no se genera nada y no hay aviso.
- **GA3** — Edición sin cambios en un ítem: no se crea una nueva versión de su ficha.
- **GA4** — Edición que quita un ítem con ficha: se rechaza y no se modifica nada; editar el contenido de ese ítem sí se permite.

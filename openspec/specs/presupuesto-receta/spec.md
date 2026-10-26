# Presupuesto en la carga de recetas y ficha/cotización automáticas

## Purpose

Mostrar el precio de una receta mientras se carga, sin guardar nada, y generar su ficha técnica y su cotización
automáticamente al confirmarla.

> Fuente: pedido del usuario (2026-09-30): «en el mostrador, apenas se carga la receta, mostrar el precio para que el cliente decida si sigue. Si el cliente no sigue, no se guarda nada. Si sigue, la ficha y la cotización no deberían requerir los pasos manuales actuales».

Alcance:

1. **Presupuesto en vivo** mientras se carga una receta (alta manual, importación desde PDF y edición de una receta guardada -- revisado 2026-10-16). No guarda nada.
2. **Ficha técnica y cotización automáticas** al confirmar la receta (y al editarla, solo para los ítems cuya fórmula cambió).

Fuera de alcance: reservar stock (eso lo hace el laboratorio al marcar un ítem como preparado, `reserva-stock-preparacion.md`), guardar presupuestos.

## Requirements

### Requirement: Presupuesto en vivo

Mientras se carga una receta (alta manual, importación desde PDF y edición de una receta guardada -- revisado
2026-10-16) SHALL mostrarse un **presupuesto en vivo**, que no guarda nada.

#### Scenario: Edición de una receta guardada

- **GIVEN** un usuario con `cotizaciones.calcular`
- **WHEN** edita una receta guardada
- **THEN** ve el presupuesto en vivo
- **AND** no se guarda nada hasta que confirma

### Requirement: Permiso de `recetas.presupuestar`

La consulta `recetas.presupuestar` SHALL requerir `cotizaciones.calcular` (las mismas personas que cotizan un ítem
guardado).

#### Scenario: Usuario sin el permiso

- **GIVEN** un usuario sin `cotizaciones.calcular`
- **WHEN** se pide `recetas.presupuestar`
- **THEN** se rechaza

### Requirement: Entrada del presupuesto

La consulta SHALL recibir los ítems del formulario en curso, con la misma forma que `itemsJson`. Sin receta.

#### Scenario: Receta todavía no guardada

- **WHEN** se presupuesta una receta que todavía no se guardó
- **THEN** el cálculo usa los ítems del formulario en curso, sin receta

### Requirement: Sin efectos (INV-R02)

La consulta MUST NOT tener efectos (INV-R02): no escribe fichas, cotizaciones ni movimientos; no bloquea ni reserva
partidas. No se audita (es una consulta; además fichas y cotizaciones están fuera de la auditoría, plan §14).

#### Scenario: PR6 — El presupuesto no escribe

- **WHEN** se calcula un presupuesto
- **THEN** no se escriben fichas ni cotizaciones

### Requirement: Ficha de cada ítem en memoria

En memoria, la ficha de cada ítem SHALL calcularse con el mismo cálculo que `fichas.generar` (unidades base,
parámetros de pesaje del tenant y calculadora pura de `ficha-tecnica.md`).

#### Scenario: Misma ficha que la generada

- **WHEN** se presupuesta un ítem
- **THEN** sus líneas son las que calcularía `fichas.generar` con los mismos datos

### Requirement: Costo de la receta completa

En memoria, el costo SHALL calcularse con el mismo cálculo que `cotizaciones.calcular` (jornada del tenant,
partidas elegibles, reparto y calculadora pura) con la regla de precio vigente (tramos de margen por costo y precio
mínimo, `reglas-precio.md`; cada ítem se cotiza con su propio costo).

#### Scenario: PR1 — Ítem normal

- **WHEN** se presupuesta un ítem normal
- **THEN** precio = max(costo × (1 + margen del tramo/100), precio mínimo) — ver `reglas-precio.md`

### Requirement: Costo acumulado por droga

El costo SHALL acumularse **por droga en el orden de los ítems**: el primer ítem consume de los saldos elegibles y
el siguiente ve solo lo que queda. Así, dos ítems que usan la misma droga no pueden aparecer ambos cubiertos. Con el
reparto acumulado, `Incompleta`, los faltantes y el costo de cada ítem reflejan la receta completa.

#### Scenario: PR7 — Dos ítems con la misma droga y stock para uno solo

- **GIVEN** dos ítems con la misma droga y stock para uno solo
- **WHEN** se presupuesta la receta
- **THEN** el segundo queda **Incompleta**
- **AND** aparece la advertencia de stock de la receta

### Requirement: Origen del costo por línea

Origen del costo por línea (`costos-proveedor.md`, R25–R30): una droga con costo de proveedor utilizable SHALL
costearse con él (toda la cantidad × costo, haya o no stock) y una droga sin costo de proveedor, **exactamente como
antes**, con las partidas (fallback).

#### Scenario: Línea con costo de proveedor y sin stock

- **GIVEN** una droga con costo de proveedor utilizable y sin stock
- **WHEN** se presupuesta un ítem que la usa
- **THEN** la línea cuesta toda la cantidad × el costo de proveedor

#### Scenario: Línea sin costo de proveedor

- **GIVEN** una droga sin costo de proveedor
- **WHEN** se presupuesta un ítem que la usa
- **THEN** la línea se costea con las partidas, exactamente como antes

### Requirement: Simulación de stock en todas las líneas

La simulación acumulada de stock SHALL seguir corriendo para **todas** las líneas, también las de proveedor, para
que los faltantes de los ítems siguientes sean correctos; el costo de una línea de proveedor nunca depende de ella.

#### Scenario: Ítems siguientes ven el consumo de una línea de proveedor

- **GIVEN** dos ítems con la misma droga, que tiene costo de proveedor, y stock para uno solo
- **WHEN** se presupuesta la receta
- **THEN** el segundo ítem informa el faltante de esa droga
- **AND** las dos líneas cuestan toda su cantidad × el costo de proveedor

### Requirement: Faltante informativo en líneas de proveedor

El faltante de una línea de proveedor SHALL ser solo informativo («Sin stock suficiente para prepararla») y **no**
marca el ítem como **Incompleta**; la advertencia de stock de la receta sigue mostrando la demanda que supera el
stock.

#### Scenario: Línea de proveedor sin stock suficiente

- **GIVEN** una línea costeada con costo de proveedor y sin stock suficiente
- **WHEN** se presupuesta la receta
- **THEN** la línea muestra «Sin stock suficiente para prepararla» y el ítem no queda **Incompleta**
- **AND** la advertencia de stock de la receta muestra la demanda que supera el stock

### Requirement: Origen de cada línea en el panel

El panel SHALL indicar, por ítem, el origen de cada línea cuando alguna se costeó con proveedor.

#### Scenario: Ítem con una línea de proveedor

- **WHEN** alguna línea de un ítem se costeó con costo de proveedor
- **THEN** el panel indica el origen de cada línea de ese ítem

### Requirement: Mismo código que los comandos

Ambos pasos SHALL compartir el código con los comandos existentes (`calcularLineasFicha`; `calcularCotizacion` y su
reparto), de modo que el presupuesto y la cotización posterior aplican las mismas reglas.

#### Scenario: Presupuesto y cotización de un ítem

- **GIVEN** una receta de un solo ítem, sin cambios de stock, costos ni regla de precio entre el presupuesto y la confirmación
- **WHEN** se confirma la receta y se genera su cotización
- **THEN** la cotización da el mismo precio que el presupuesto

### Requirement: Sin regla de precio vigente

Sin regla de precio vigente, el resultado SHALL ser un único mensaje: «No hay regla de precios configurada». No se
calcula nada.

#### Scenario: PR4 — Sin regla de precio

- **GIVEN** que no hay regla de precio vigente
- **WHEN** se presupuesta una receta
- **THEN** se muestra un mensaje único, sin precios

### Requirement: Ítem calculable

Un ítem calculable SHALL mostrar precio final, costo de insumos y, si corresponde: **Parcial** (algún excipiente se
completa al preparar: enrase manual, costo 0) e **Incompleta** (stock insuficiente en una línea costeada con
partidas: se cotiza lo que hay e informa lo que falta por droga; una línea costeada con costo de proveedor no la
provoca).

#### Scenario: PR2 — Cápsulas con excipiente CSP

- **WHEN** se presupuestan cápsulas con excipiente CSP
- **THEN** el resultado es **Parcial** y el excipiente figura como «se completa al preparar»

#### Scenario: PR3 — Stock insuficiente

- **WHEN** se presupuesta un ítem sin stock suficiente
- **THEN** el resultado es **Incompleta**, con el faltante por droga

### Requirement: Ítem no calculable

Un ítem no calculable (V1–V9, droga o unidad inexistente o dada de baja) SHALL mostrar un mensaje en lugar del
precio. No interrumpe el resto.

#### Scenario: PR5 — Ítem con V8 o droga dada de baja

- **WHEN** se presupuesta una receta con un ítem con V8 o con una droga dada de baja
- **THEN** ese ítem muestra un mensaje y los demás se calculan

### Requirement: Total del presupuesto

El total SHALL ser la suma de los ítems calculables. Si alguno no se pudo calcular, se indica que el total no lo
incluye.

#### Scenario: Un ítem no calculable

- **GIVEN** una receta con un ítem no calculable
- **WHEN** se presupuesta
- **THEN** el total suma los demás ítems e indica que no incluye ese

### Requirement: Advertencia de stock de la receta

Si la demanda total de una droga en la receta supera el stock elegible, SHALL mostrarse una advertencia destacada a
nivel receta: «Falta stock de Cafeína para toda la receta: se necesitan 3 g y hay 2 g disponibles.» Nunca bloquea.

#### Scenario: Demanda mayor que el stock

- **GIVEN** 2 g de Cafeína elegibles y una receta que necesita 3 g
- **WHEN** se presupuesta
- **THEN** se muestra «Falta stock de Cafeína para toda la receta: se necesitan 3 g y hay 2 g disponibles.»
- **AND** no bloquea

#### Scenario: PR8 — Dos ítems con la misma droga y stock para ambos

- **GIVEN** dos ítems con la misma droga y stock para ambos
- **WHEN** se presupuesta la receta
- **THEN** no hay advertencia

### Requirement: Panel Presupuesto

Un panel «Presupuesto» SHALL mostrarse junto al botón de confirmar, en el alta manual y en la importación. Se oculta
sin `cotizaciones.calcular`.

#### Scenario: Sin permiso

- **GIVEN** un usuario sin `cotizaciones.calcular`
- **WHEN** carga una receta
- **THEN** no ve el panel «Presupuesto»

### Requirement: Recálculo automático

El presupuesto SHALL recalcularse solo, unos 600 ms después del último cambio, cuando todos los componentes tienen
droga, unidad y cantidad válida. Tras importar un PDF, el primer cálculo ocurre en cuanto las drogas quedan
identificadas. Botón «Recalcular».

#### Scenario: Componente incompleto

- **GIVEN** un componente sin cantidad válida
- **WHEN** el usuario sigue cargando
- **THEN** el presupuesto no se recalcula solo

#### Scenario: Componentes completos

- **GIVEN** todos los componentes tienen droga, unidad y cantidad válida
- **WHEN** pasan unos 600 ms desde el último cambio
- **THEN** el presupuesto se recalcula

### Requirement: Respuestas viejas descartadas

Una respuesta que llega después de un pedido más nuevo SHALL descartarse.

#### Scenario: Respuesta fuera de orden

- **GIVEN** dos pedidos de presupuesto seguidos
- **WHEN** la respuesta del primero llega después de pedido el segundo
- **THEN** se descarta

### Requirement: El presupuesto nunca impide confirmar

El presupuesto MUST NOT impedir confirmar.

#### Scenario: Presupuesto con errores

- **GIVEN** un presupuesto con un ítem no calculable
- **WHEN** el usuario intenta confirmar la receta
- **THEN** el presupuesto no bloquea ni deshabilita la confirmación

### Requirement: Generación automática al confirmar

Después de que `recetas.crear` o `recetas.importar` **confirman** (la transacción de la receta ya terminó), por cada
ítem SHALL: 1. generarse la ficha técnica (`fichas.generar`, versión 1); 2. si la ficha se generó, calcularse y
guardarse la cotización (`cotizaciones.calcular`).

#### Scenario: Receta confirmada

- **GIVEN** un usuario con `fichas.generar` y `cotizaciones.calcular`, una regla de precio vigente y fichas calculables
- **WHEN** confirma una receta
- **THEN** cada ítem tiene su ficha técnica versión 1 y su cotización

### Requirement: Independencia de los pasos

Cada paso SHALL ser un caso de uso aparte, con su propia transacción. Un error nunca deshace la receta.

#### Scenario: Falla la cotización

- **WHEN** la cotización de un ítem falla después de generada su ficha
- **THEN** la receta y la ficha quedan guardadas

### Requirement: Permisos de la generación

La generación SHALL respetar los permisos: sin `fichas.generar` no se genera nada; sin `cotizaciones.calcular` se
generan solo las fichas. Sin aviso.

#### Scenario: GA2 — Usuario sin `fichas.generar`

- **GIVEN** un usuario sin `fichas.generar`
- **WHEN** confirma o edita una receta
- **THEN** no se genera nada y no hay aviso
- **AND** si editó un ítem, su ficha queda **desactualizada**: la toma del laboratorio la muestra así, no deja reservar stock sobre ella y ofrece «Generar ficha técnica» a quien tiene el permiso (`reserva-stock-preparacion.md` R18)

#### Scenario: Usuario sin `cotizaciones.calcular`

- **GIVEN** un usuario con `fichas.generar` y sin `cotizaciones.calcular`
- **WHEN** confirma una receta
- **THEN** se generan solo las fichas, sin aviso

### Requirement: Errores de la generación

Ante un error, la receta SHALL quedar guardada y su detalle muestra: «No se pudo generar la ficha técnica del ítem
N: <motivo>. Podés generarla desde la receta.» (o el equivalente para la cotización).

#### Scenario: GA1 — Falla la ficha de un ítem

- **WHEN** falla la ficha de un ítem al confirmar
- **THEN** la receta queda guardada y se muestra el aviso con el motivo
- **AND** no hay cotización para ese ítem

### Requirement: Aviso en la URL

El aviso en la URL SHALL llevar solo códigos: paso, número de ítem y un código de una lista cerrada
(`?aviso=f1-V5`). Nunca texto libre ni datos personales. La página arma el mensaje a partir del código e ignora lo
que no reconoce.

#### Scenario: Código no reconocido

- **WHEN** la URL trae un `aviso` que no está en la lista cerrada
- **THEN** la página lo ignora

### Requirement: Edición — regeneración de fichas desactualizadas

`recetas.editar` MUST NOT tocar las fichas (son inmutables, INV-R05). Después de editar SHALL aplicarse la misma
generación, pero solo para los ítems cuya ficha quedó desactualizada: si las líneas recalculadas son idénticas a las
de la última versión, no se crea una versión nueva ni se recotiza.

#### Scenario: GA3 — Edición sin cambios en un ítem

- **WHEN** se edita una receta sin cambiar un ítem
- **THEN** no se crea una nueva versión de su ficha

### Requirement: Edición — no se quita un ítem con ficha

Un ítem que ya tiene ficha técnica (o cotización) MUST NOT **quitarse**: fichas y cotizaciones son de solo inserción
y referencian el ítem. La edición lo rechaza con «No se puede quitar el ítem N porque ya tiene ficha técnica. Si la
receta se cargó mal, anulala y cargala de nuevo.» (N según el orden del detalle de la receta). Modificar el
contenido de un ítem existente sigue permitido.

#### Scenario: GA4 — Edición que quita un ítem con ficha

- **WHEN** una edición quita un ítem con ficha
- **THEN** se rechaza y no se modifica nada
- **AND** editar el contenido de ese ítem sí se permite

### Requirement: Edición — accesos manuales

Los accesos manuales «Ficha técnica» y «Cotización» del detalle SHALL mantenerse para revisar, imprimir o
regenerar.

#### Scenario: Regenerar desde el detalle

- **GIVEN** un usuario con permiso para ver fichas y cotizaciones
- **WHEN** abre el detalle de una receta
- **THEN** tiene los accesos «Ficha técnica» y «Cotización»

## Referencias

> Se apoya en `ficha-tecnica.md` (cálculo de la ficha, V1–V9) y en la cotización existente (FASE 7.4, DP-09). Las notas **[ACLARACIÓN]** son deducciones de consistencia; no agregan requisitos.

## Aclaraciones

[ACLARACIÓN] El presupuesto y la cotización no reservan stock (INV-R02) y cuestan contra el saldo **físico**: no descuentan lo que otras recetas pendientes van a usar ni lo que las preparaciones en curso ya **reservaron** (la reserva de stock existe desde 2026-10-08, `reserva-stock-preparacion.md`; ahí, «Open»). Es una estimación de precio, no una reserva.

[ACLARACIÓN] La cotización que se guarda al confirmar (por ítem) sigue costeando cada ítem contra el stock completo, como la cotización manual: descontar los demás ítems no sería consistente una vez que alguno ya se preparó (su stock ya salió y se descontaría dos veces).

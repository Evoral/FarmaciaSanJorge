# Libro recetario, anulación, histórico y libros contralor

## Purpose

Corrección de asientos del libro recetario (anulación y asiento rectificativo), correlativo, numeración, impresión e
integridad del libro, libros contralor y firma de la jornada. Fuente de verdad para los puntos 1.11–1.13 y las fases
8–10 del plan. Donde contradice al plan original, manda este documento.

## Requirements

### Requirement: Pago fuera de esta máquina de estados

El pago de la receta (marca `pagada`, migración 0071) SHALL ser una dimensión aparte: no es un estado de la receta ni forma parte de esta máquina de estados. Ver `openspec/specs/pago-receta/spec.md`.

#### Scenario: Receta pagada

- **GIVEN** una receta con la marca `pagada`
- **WHEN** se consulta su estado
- **THEN** la marca de pago no es un estado de la receta ni forma parte de esta máquina de estados

### Requirement: Principio — lo asentado no se deshace

El sistema SHALL cumplir el principio: lo asentado no se deshace. No se borra, no se edita, no se reutiliza su número, no se devuelve droga al stock, y no se modifica una jornada firmada. Motivos típicos de corrección: el paciente no retira, el médico revoca la prescripción, se detecta un error de dato después de asentar.

#### Scenario: Corregir un asiento

- **GIVEN** un asiento registrado
- **WHEN** se lo corrige
- **THEN** el asiento no se borra, no se edita y su número no se reutiliza
- **AND** no se devuelve droga al stock ni se modifica una jornada firmada

### Requirement: Corrección en jornada abierta

En una jornada abierta (sin cierre), el asiento original SHALL pasar a `ANULADO` y se registra una `AnulacionAsiento` en el mismo día. El original conserva su número correlativo. El egreso de stock se mantiene, el preparado físico se descarta y, con droga controlada, se segrega para inspección.

#### Scenario: Anulación en jornada abierta

- **GIVEN** un asiento de una jornada sin cierre, con droga controlada
- **WHEN** se lo corrige
- **THEN** el asiento pasa a `ANULADO`, con una `AnulacionAsiento` en el mismo día, y conserva su número
- **AND** el egreso de stock se mantiene y el preparado se descarta y se segrega para inspección

### Requirement: Corrección en jornada firmada

En una jornada firmada, el asiento original **no se toca**: SHALL quedar `VIGENTE` en su jornada sellada. Se registra un **asiento rectificativo nuevo** en la jornada en curso, que referencia al original, y el rectificativo toma el siguiente número del libro. El egreso de stock se mantiene, el preparado físico se descarta y, con droga controlada, se segrega para inspección.

#### Scenario: Rectificativo en jornada firmada

- **GIVEN** un asiento de una jornada firmada
- **WHEN** se lo corrige
- **THEN** el original queda `VIGENTE` en su jornada sellada
- **AND** se registra un asiento rectificativo nuevo en la jornada en curso, con el siguiente número del libro, que referencia al original

### Requirement: INV-L09 — Un asiento nunca se edita (revisado)

Un asiento nunca SHALL editarse. Se corrige por anulación (jornada abierta) o por asiento rectificativo (jornada firmada), siempre con motivo y autorización del DT.

#### Scenario: Corrección con motivo y autorización

- **GIVEN** un asiento con un dato a corregir
- **WHEN** se lo corrige
- **THEN** la corrección es una anulación (jornada abierta) o un asiento rectificativo (jornada firmada)
- **AND** lleva motivo y autorización del DT

### Requirement: INV-L02 — Anulación solo con la jornada sin cierre (revisado)

La transición `VIGENTE → ANULADO` SHALL ser posible solo mientras la jornada del asiento no tiene `CierreDiario`. Coherente con INV-C03.

#### Scenario: Jornada con cierre

- **GIVEN** un asiento `VIGENTE` cuya jornada tiene `CierreDiario`
- **WHEN** se intenta pasarlo a `ANULADO`
- **THEN** la transición no es posible

### Requirement: INV-L18 — Rectificativo con un original de jornada firmada

Un asiento rectificativo SHALL referenciar exactamente un asiento original de una jornada **firmada**, con fecha anterior a la propia. No existe un rectificativo sin original.

#### Scenario: Rectificativo válido

- **GIVEN** un asiento rectificativo
- **WHEN** se lo registra
- **THEN** referencia exactamente un asiento original de una jornada firmada, con fecha anterior a la propia

### Requirement: INV-L19 — A lo sumo un rectificativo por original

Un asiento original SHALL tener a lo sumo un rectificativo de anulación.

#### Scenario: Segundo rectificativo

- **GIVEN** un asiento original que ya tiene un rectificativo de anulación
- **WHEN** se intenta registrar otro rectificativo de anulación sobre él
- **THEN** el original no puede tener un segundo rectificativo

### Requirement: INV-L20 — Sin reversión de stock ni contralor

Anular o rectificar un asiento no SHALL generar movimientos de stock ni asientos contralor de reversión.

#### Scenario: Anulación sin reversión

- **WHEN** se anula o rectifica un asiento
- **THEN** no se genera ningún movimiento de stock ni asiento contralor de reversión

### Requirement: Rectificativo como AsientoRecetario (deducción)

(deducción) El rectificativo SHALL ser un `AsientoRecetario` con origen `RECTIFICATIVO` (nuevo valor de enum): numerado, encadenado en el hash y vinculado al cierre de la jornada en curso, que el DT firma como cualquier otro asiento. Así la corrección queda en el libro del día en que se hace, que es lo que exige no tocar la jornada sellada.

#### Scenario: Rectificativo en el libro del día

- **WHEN** se registra un rectificativo
- **THEN** es un `AsientoRecetario` con origen `RECTIFICATIVO`, numerado y encadenado en el hash
- **AND** queda vinculado al cierre de la jornada en curso, que el DT firma como cualquier otro asiento

### Requirement: Asiento sin efecto por rectificativo (deducción)

(deducción) Al consultar el libro, un asiento con rectificativo SHALL mostrarse como "sin efecto por asiento Nº X", aunque en la base siga `VIGENTE` (su jornada está sellada y su hash forma parte del cierre).

#### Scenario: Consulta de un asiento rectificado

- **GIVEN** un asiento `VIGENTE` con rectificativo Nº X
- **WHEN** se consulta el libro
- **THEN** el asiento se muestra como "sin efecto por asiento Nº X"

### Requirement: D3 — Rectificativo por error de dato

(resuelto, D1/D2/D3/D4, decisión del usuario 2026-09-23) Un rectificativo por "error de dato" SHALL SOLO dejar sin efecto el asiento original -- NO transcribe datos correctos (D3). El asiento rectificativo únicamente marca el original "sin efecto" y copia su snapshot congelado (paciente/médico/fórmula) sin líneas de detalle.

#### Scenario: Rectificativo sin datos corregidos

- **WHEN** se registra un rectificativo por error de dato
- **THEN** marca el original "sin efecto" y copia su snapshot congelado (paciente/médico/fórmula)
- **AND** no transcribe datos correctos ni tiene líneas de detalle

### Requirement: D3 — Corrección de un dato mal cargado

La corrección de un dato mal cargado SHALL hacerse dando de alta una receta y una preparación nuevas, con los datos correctos.

#### Scenario: Dato mal cargado

- **GIVEN** un asiento con un dato mal cargado
- **WHEN** se corrige el dato
- **THEN** se da de alta una receta y una preparación nuevas, con los datos correctos

### Requirement: D1 — Autorización del rectificativo

La autorización del rectificativo SHALL vivir en una tabla propia, `fsj.rectificacion_asiento` (migración 0033) -- tenant, `asientoRectificativoId` único, `motivo`, `autorizadoPorId` (debe ser DT vigente hoy, mismo chequeo que `anulacion_asiento_validar`), `registradoPorId`.

#### Scenario: Autorizante del rectificativo

- **WHEN** se registra la autorización de un rectificativo
- **THEN** queda en `fsj.rectificacion_asiento` con su motivo, quien lo registra y `autorizadoPorId`, que debe ser DT vigente hoy

### Requirement: INV-L21 — Una rectificacion_asiento por rectificativo (nuevo)

Todo asiento RECTIFICATIVO SHALL tener exactamente una `rectificacion_asiento` -- validado en ambas direcciones (inmediato del lado `rectificacion_asiento`; con un constraint trigger DEFERRABLE INITIALLY DEFERRED del lado `asiento_recetario`, porque el asiento se inserta ANTES de su autorización en la misma transacción).

#### Scenario: Rectificativo sin autorización

- **GIVEN** una transacción que inserta un asiento RECTIFICATIVO
- **WHEN** la transacción termina sin su `rectificacion_asiento`
- **THEN** el constraint trigger diferido del lado `asiento_recetario` la rechaza

### Requirement: D1 — Comando rectificarAsiento

El comando `rectificarAsiento` (`modules/libro/application/rectificar-asiento.ts`, mismo permiso `libro.anulacion.solicitar` y misma co-firma de DT que `anularAsiento`) SHALL aplicar solo a asientos SISTEMA cuya jornada YA está firmada -- si la jornada sigue abierta, el mensaje remite a `anularAsiento` en su lugar.

#### Scenario: Rectificar con la jornada abierta

- **GIVEN** un asiento SISTEMA cuya jornada sigue abierta
- **WHEN** se ejecuta `rectificarAsiento`
- **THEN** no se aplica y el mensaje remite a `anularAsiento`

### Requirement: D2 — Registro y corrección por ítem

D2 (revisado, decisión del usuario 2026-09-23, reemplaza la versión original de D2; REEMPLAZADO para asientos nuevos por D8, 2026-10-16 -- se conserva como descripción de los asientos por ítem ya existentes). En esos asientos, el libro recetario SHALL registrarse y corregirse POR ÍTEM; anular o rectificar UN asiento afecta SOLO a ese ítem.

#### Scenario: Anular el asiento de un ítem

- **GIVEN** una receta con dos ítems, cada uno con su asiento SISTEMA por ítem
- **WHEN** se anula el asiento de un ítem
- **THEN** la anulación afecta solo a ese ítem

### Requirement: D2 — Ítems de la receta

En D2, una receta SHALL poder tener varios `item_receta`, cada uno con su propia preparación y (una vez confirmada) su propio asiento SISTEMA.

#### Scenario: Receta con varios ítems por ítem

- **GIVEN** una receta registrada por ítem con varios `item_receta`
- **WHEN** se confirma la preparación de un ítem
- **THEN** ese ítem tiene su propio asiento SISTEMA

### Requirement: D2 — Estado sin efecto de los ítems

En la MISMA transacción, tras el INSERT del lado del asiento, SHALL recalcularse el estado de TODOS los ítems de la receta (`todosLosItemsSinEfecto`, `modules/libro/infrastructure/receta-coupling-repository.ts`): un ítem está "sin efecto" cuando su preparación llegó a `CONFIRMADA` y su asiento SISTEMA está `ANULADO` o ya tiene un rectificativo.

#### Scenario: Recalcular tras anular

- **WHEN** se anula o rectifica el asiento de un ítem
- **THEN** en la misma transacción se recalcula el estado de todos los ítems de la receta

### Requirement: D2 — Anulación de la receta por ítems sin efecto

La receta SHALL pasar a `ANULADA` con `motivoAnulacion = "Todos los ítems quedaron sin efecto (último: asiento Nº X): <motivo>"` (y se audita) SOLO cuando, después de esta operación, TODOS sus ítems quedaron sin efecto. Si al menos un ítem sigue pendiente de preparación o tiene un asiento `VIGENTE` sin rectificativo, la receta queda SIN CAMBIOS.

#### Scenario: Último ítem sin efecto

- **GIVEN** una receta con un solo ítem que no está sin efecto
- **WHEN** se anula el asiento de ese ítem con un motivo
- **THEN** la receta pasa a `ANULADA` con `motivoAnulacion` "Todos los ítems quedaron sin efecto (último: asiento Nº X): <motivo>" y se audita

#### Scenario: Queda un ítem vigente

- **GIVEN** una receta con un ítem cuyo asiento sigue `VIGENTE` sin rectificativo
- **WHEN** se anula el asiento de otro ítem
- **THEN** la receta queda sin cambios

### Requirement: D2 — Receta entregada y estado derivado

Si la receta ya está `ENTREGADA` (estado terminal), SHALL dejarse como está de todas formas -- en ambos casos la operación sobre el asiento sigue adelante. No se agregó una columna de estado por ítem (`item_receta` no la tiene): el estado "sin efecto" se deriva en cada cálculo, nunca se persiste. Nota para FASE 11: la entrega debe excluir los ítems cuyo asiento esté "sin efecto".

#### Scenario: Receta entregada

- **GIVEN** una receta `ENTREGADA` cuyos ítems quedan todos sin efecto
- **WHEN** se anula el último asiento
- **THEN** la anulación del asiento sigue adelante y la receta queda `ENTREGADA`

### Requirement: D4 — Hash V3

Hash V3 (migración 0034): `asiento_recetario.version_hash` (2 = existente, 3 = nuevo) y el hash ahora SHALL incluir las líneas de `detalle_asiento` (orden, descripción, cantidad, unidad, línea de pesaje). Requiere insertar los `detalle_asiento` ANTES del `asiento_recetario` (id generado por la app) y que la FK `detalle_asiento → asiento_recetario` sea DEFERRABLE INITIALLY DEFERRED.

#### Scenario: Asiento V3

- **WHEN** se escribe un asiento con `version_hash` 3
- **THEN** su hash incluye las líneas de `detalle_asiento`, insertadas antes del asiento

### Requirement: INV-L22 — Asiento SISTEMA con detalle (nuevo)

Un asiento SISTEMA SHALL exigir al menos un detalle ya insertado.

#### Scenario: Asiento SISTEMA sin detalle

- **GIVEN** un asiento SISTEMA sin ningún `detalle_asiento` insertado
- **WHEN** se lo inserta
- **THEN** se rechaza

### Requirement: INV-L23 — Detalle congelado (nuevo)

Un detalle no SHALL poder insertarse una vez que su asiento ya existe (congela el conjunto hasheado).

#### Scenario: Detalle tardío

- **GIVEN** un asiento ya insertado
- **WHEN** se intenta insertar un detalle para él
- **THEN** se rechaza

### Requirement: D4 — verificar_cadena por versión

`fsj.verificar_cadena` SHALL recalcular cada fila con la función que corresponde a su propio `version_hash`.

#### Scenario: Cadena con versiones mezcladas

- **GIVEN** un libro con asientos de `version_hash` 2 y 3
- **WHEN** se ejecuta `fsj.verificar_cadena`
- **THEN** cada fila se recalcula con la función de su propio `version_hash`

### Requirement: D7 — Co-firma del DT sin re-auth del solicitante

Revertido para stock (decisión del usuario, 2026-09-29): el ajuste de stock ya no SHALL exigir el re-auth del solicitante; alcanza con la contraseña del DT en el mismo acto. Revertido también para el libro (decisión del usuario, 2026-10-21): ni la verificación de co-firma del libro ni `anularAsiento`/`rectificarAsiento` piden ya el re-auth del solicitante; solo la contraseña del DT. Se mantiene únicamente en `reanclarLibro` (acto exclusivo del DT).

#### Scenario: Anulación con step-up vencido

- **GIVEN** un solicitante sin re-autenticación reciente
- **WHEN** solicita `anularAsiento` con la contraseña del DT
- **THEN** no se le pide re-auth; alcanza con la contraseña del DT

### Requirement: D8 — Un asiento por receta

D8 (decisión del usuario, 2026-10-16, reemplaza a D2 para todo asiento nuevo). Un asiento por receta. Una receta no SHALL poder tener dos asientos en el libro recetario: todos sus ítems quedan en **un solo** asiento SISTEMA, con un solo número.

#### Scenario: Receta de varios ítems

- **GIVEN** una receta nueva con tres ítems
- **WHEN** se registra en el libro recetario
- **THEN** sus tres ítems quedan en un solo asiento SISTEMA, con un solo número

### Requirement: D8 — Reemplaza a los asientos consecutivos

Un asiento por receta (2026-10-16, D8; reemplaza "asientos consecutivos" del 2026-10-14). "Imprimir etiquetas" (`preparaciones.confirmarReservasReceta`, `openspec/specs/reserva-stock-preparacion/spec.md` R13) SHALL confirmar todos los ítems de la receta en una sola transacción y escribir un solo asiento con todos ellos.

#### Scenario: Imprimir etiquetas

- **WHEN** se ejecuta "Imprimir etiquetas" de una receta
- **THEN** todos sus ítems se confirman en una sola transacción y se escribe un solo asiento con todos ellos

### Requirement: D8 — Cuándo se escribe

El asiento SHALL escribirse al confirmar la receta completa: "Imprimir etiquetas" de la toma (`preparaciones.confirmarReservasReceta`, R13 de `openspec/specs/reserva-stock-preparacion/spec.md`) confirma todos sus ítems en una transacción y escribe UN asiento con todos ellos. No existe la confirmación de un ítem suelto de una receta de varios ítems.

#### Scenario: Ítem suelto

- **GIVEN** una receta de varios ítems
- **WHEN** se busca confirmar uno solo de sus ítems
- **THEN** no existe esa confirmación; se confirma la receta completa desde la toma

### Requirement: D8 — Camino heredado preparaciones.confirmar

El camino heredado `preparaciones.confirmar` (`/preparaciones/[id]`, preparación INICIADA sin reserva, de antes de R16) SHALL escribir un asiento por receta con esa sola preparación, y se rechaza si la receta tiene otro ítem vivo que no esté CONFIRMADA: "Esta receta tiene varios ítems: se registran juntos en el libro desde la toma (Imprimir etiquetas)."

#### Scenario: Camino heredado con otro ítem vivo

- **GIVEN** una preparación INICIADA sin reserva de una receta con otro ítem vivo no CONFIRMADA
- **WHEN** se ejecuta `preparaciones.confirmar`
- **THEN** se rechaza con "Esta receta tiene varios ítems: se registran juntos en el libro desde la toma (Imprimir etiquetas)."

### Requirement: D8 — Contenido del asiento

El asiento por receta SHALL llevar paciente y médico de la receta (un solo snapshot). `formula_texto`: la fórmula de cada ítem en orden de ítem (solo sus drogas, sin el rótulo "Ítem N": decisión del usuario 2026-10-17), separadas por " | ". Los asientos ya escritos con "Ítem N: " no se tocan (su texto forma parte del hash).

#### Scenario: Fórmula de dos ítems

- **GIVEN** una receta con dos ítems
- **WHEN** se escribe su asiento
- **THEN** `formula_texto` lleva la fórmula de cada ítem en orden de ítem, sin el rótulo "Ítem N", separadas por " | "

### Requirement: D8 — Detalle del asiento por receta

`detalle_asiento` SHALL llevar las líneas de todos los ítems, en orden de ítem y, dentro de cada uno, en su orden actual; `orden` es correlativo en todo el asiento.

#### Scenario: Orden del detalle

- **GIVEN** una receta con dos ítems de dos líneas cada uno
- **WHEN** se escribe su asiento
- **THEN** `detalle_asiento` tiene las cuatro líneas en orden de ítem, con `orden` correlativo en todo el asiento

### Requirement: D8 — Modelo asiento_preparacion

El modelo SHALL tener `asiento_recetario.receta_id` (nuevo, FK a `receta`) y tabla nueva `fsj.asiento_preparacion (tenant_id, asiento_recetario_id, preparacion_id, orden)`, con UNIQUE `(tenant_id, preparacion_id)` (una preparación está en a lo sumo un asiento).

#### Scenario: Preparación en dos asientos

- **GIVEN** una preparación ya vinculada a un asiento en `asiento_preparacion`
- **WHEN** se intenta vincularla a otro asiento
- **THEN** UNIQUE `(tenant_id, preparacion_id)` lo impide

### Requirement: D8 — Filas de asiento_preparacion

Las filas de `asiento_preparacion` SHALL insertarse ANTES del asiento, como los detalles (FK al asiento DEFERRABLE INITIALLY DEFERRED), son de solo inserción y no pueden insertarse una vez que su asiento existe.

#### Scenario: Fila tardía

- **GIVEN** un asiento por receta ya insertado
- **WHEN** se intenta insertar una fila de `asiento_preparacion` para él
- **THEN** se rechaza

### Requirement: D8 — Asientos SISTEMA nuevos y existentes

Un asiento SISTEMA nuevo SHALL tener `preparacion_id` NULL, `receta_id` NOT NULL y `version_hash = 4`; los asientos SISTEMA existentes (`version_hash` ≤ 3, `preparacion_id` NOT NULL, `receta_id` NULL) no se tocan.

#### Scenario: Asiento nuevo

- **WHEN** se escribe un asiento SISTEMA nuevo
- **THEN** tiene `preparacion_id` NULL, `receta_id` NOT NULL y `version_hash = 4`

### Requirement: INV-L07 — Formas de SISTEMA (revisado)

SISTEMA SHALL ser o bien heredado (`preparacion_id` NOT NULL, `receta_id` NULL, `version_hash` ≤ 3) o bien por receta (`preparacion_id` NULL, `receta_id` NOT NULL, `version_hash` = 4); RECTIFICATIVO sin cambios.

#### Scenario: Asiento SISTEMA mixto

- **GIVEN** un asiento SISTEMA con `preparacion_id` y `receta_id` informados
- **WHEN** se lo inserta
- **THEN** se rechaza, porque no es ni heredado ni por receta

### Requirement: INV-L24 — Un asiento SISTEMA por receta (nuevo)

A lo sumo SHALL existir un asiento SISTEMA por receta (`UNIQUE (tenant_id, receta_id) WHERE origen = 'SISTEMA'`).

#### Scenario: Segundo asiento por receta

- **GIVEN** una receta con un asiento SISTEMA por receta
- **WHEN** se intenta escribir otro asiento SISTEMA con el mismo `receta_id`
- **THEN** el índice único lo impide

### Requirement: INV-L25 — Preparaciones del asiento por receta (nuevo)

Un asiento SISTEMA por receta SHALL tener al menos una `asiento_preparacion`, y cada preparación vinculada está CONFIRMADA y es de un ítem de su `receta_id`.

#### Scenario: Preparación de otra receta

- **GIVEN** un asiento por receta
- **WHEN** se le vincula una preparación de un ítem de otra receta
- **THEN** se rechaza

### Requirement: INV-P04 — Preparación confirmada con asiento (revisado)

Una preparación CONFIRMADA SHALL tener su asiento SISTEMA, heredado (`asiento_recetario.preparacion_id`) o por receta (`asiento_preparacion`).

#### Scenario: Confirmar una preparación

- **WHEN** una preparación queda CONFIRMADA
- **THEN** tiene su asiento SISTEMA, heredado o por receta

### Requirement: D8 — Hash V4

El Hash V4 SHALL ser como V3, más `receta_id` y las preparaciones vinculadas en su `orden`. `fsj.verificar_cadena` sigue recalculando cada fila con la función de su propio `version_hash`.

#### Scenario: Asiento V4

- **WHEN** se escribe un asiento con `version_hash` 4
- **THEN** su hash cubre lo de V3, `receta_id` y las preparaciones vinculadas en su `orden`

### Requirement: D8 — Corrección de un asiento por receta

Anular o rectificar un asiento por receta SHALL dejar sin efecto **todos** sus ítems: la receta pasa a `ANULADA` con el mismo texto de D2 (salvo `ENTREGADA` o `ENVIADA_PEND_FIRMA`, que quedan como están: el preparado ya salió de la farmacia y la firma se puede seguir confirmando -- 2026-10-17).

#### Scenario: Anular el asiento de una receta preparada

- **GIVEN** una receta `PREPARADA` con su asiento por receta
- **WHEN** se anula el asiento
- **THEN** todos sus ítems quedan sin efecto y la receta pasa a `ANULADA` con el texto de D2

#### Scenario: Receta enviada pendiente de firma

- **GIVEN** una receta `ENVIADA_PEND_FIRMA`
- **WHEN** se anula su asiento
- **THEN** la receta queda como está

### Requirement: D8 — Receta en RETIRO_VENCIDO

Una receta en `RETIRO_VENCIDO` **sí** SHALL anularse sola, igual que una `PREPARADA` (el preparado nunca salió de la farmacia; RV8 de `openspec/specs/retiro-vencido/spec.md`, `RETIRO_VENCIDO` no está en `ESTADOS_TERMINALES_RECETA`). Un ítem está "sin efecto" cuando su asiento -- heredado o por receta -- está `ANULADO` o tiene rectificativo.

#### Scenario: Anular el asiento de una receta vencida

- **GIVEN** una receta en `RETIRO_VENCIDO`
- **WHEN** se anula su asiento por receta
- **THEN** la receta pasa a `ANULADA`

### Requirement: D8 — Transición

Una receta que al desplegar ya tenía ítems confirmados con asiento por ítem SHALL conservar esos asientos; los ítems que le falten se registran juntos en un asiento por receta. Solo esas recetas pueden mostrar más de un asiento, y solo por ese motivo; INV-L24 aplica a los asientos por receta.

#### Scenario: Receta a medio registrar al desplegar

- **GIVEN** una receta con un ítem que ya tenía asiento por ítem al desplegar D8
- **WHEN** se confirman sus ítems restantes
- **THEN** conserva su asiento por ítem y los restantes quedan juntos en un asiento por receta

### Requirement: D8 — Lectura

Todo lo que hoy va de un asiento a "su" preparación (o al revés) SHALL resolver las dos formas: listado y detalle de `/libro`, exportaciones, "Receta Nº" (por `receta_id`, o por la preparación en los heredados), entrega, etiqueta, contralor, historiales. El listado muestra una fila por asiento.

#### Scenario: Listado con asientos de ambas formas

- **GIVEN** un asiento heredado y un asiento por receta
- **WHEN** se consulta el listado de `/libro`
- **THEN** cada uno muestra su "Receta Nº", el heredado por su preparación y el otro por `receta_id`
- **AND** el listado muestra una fila por asiento

### Requirement: DP-17 — Asientos históricos eliminados

Eliminados por decisión del usuario (2026-10-16, migración 0084): el sistema ya no SHALL digitalizar asientos del libro físico. Se borraron la tabla `fsj.asiento_historico`, el permiso `libro.historico.digitalizar`, la pantalla `/libro/historico` y su código. Rollback: `docs/rollbacks/quitar-asiento-historico.md`.

#### Scenario: Digitalizar un asiento del libro físico

- **WHEN** un usuario busca digitalizar un asiento del libro físico
- **THEN** el sistema no lo ofrece: no existen la pantalla `/libro/historico` ni el permiso `libro.historico.digitalizar`

### Requirement: DP-31 — Contador transaccional

El número correlativo SHALL asignarlo la base con un **contador transaccional**: una fila por (tenant, libro) bloqueada con `FOR UPDATE` dentro de la misma transacción. No se usa `SEQUENCE`, porque una secuencia pierde números cuando una transacción se revierte y eso viola INV-L04 (sin saltos).

#### Scenario: Transacción revertida

- **GIVEN** una transacción que tomó el siguiente número de un libro
- **WHEN** la transacción se revierte
- **THEN** el número no se pierde: la próxima transacción lo toma

### Requirement: DP-31 y DP-32 — Cada libro con su secuencia y su cadena

El correlativo (DP-31) y el hash (DP-32) SHALL aplicar igual al libro recetario y a cada libro contralor, cada uno con su propia secuencia y su propia cadena.

#### Scenario: Recetario y contralor

- **WHEN** se registran asientos en el libro recetario y en un libro contralor
- **THEN** cada libro numera con su propia secuencia y encadena con su propia cadena

### Requirement: Numeración inicial — un libro por tenant

Numeración inicial (revisada, decisión del usuario 2026-10-22, migración 0097; reemplaza "arranca en 1, no continúa el libro físico"). Cada tenant SHALL tener su propio libro digital. Cada libro (el recetario y cada libro contralor, cada uno por separado) empieza en 1 **o continúa la numeración de su libro físico**.

#### Scenario: Continuar el libro físico

- **GIVEN** una farmacia con un libro físico en uso
- **WHEN** el DT configura como primer asiento del libro digital el número que continúa el físico
- **THEN** el libro digital empieza en ese número

### Requirement: Numeración inicial — configuración por el DT

El DT SHALL elegir el número de su primer asiento (`libro_rubricado.numero_inicial`, por defecto 1) en `/libro/numeracion` (`libro.numeracion.configurar`, permiso `libro.anulacion.autorizar`, re-autenticación reciente, auditado como MODIFICAR sobre `libro_rubricado` con el número anterior y el nuevo).

#### Scenario: Configurar la numeración

- **GIVEN** un usuario con el permiso `libro.anulacion.autorizar` y re-autenticación reciente
- **WHEN** cambia el número del primer asiento en `/libro/numeracion`
- **THEN** se guarda `libro_rubricado.numero_inicial`
- **AND** se audita como MODIFICAR sobre `libro_rubricado` con el número anterior y el nuevo

### Requirement: Numeración — cambio hasta el primer cierre

La numeración se puede cambiar hasta el primer cierre. Si el libro ya tiene asientos (alguien empezó a usarlo sin configurar la numeración), cambiarla SHALL renumerar todos sus asientos por la diferencia y recalcular su cadena de hash y el contador (`fsj.libro_configurar_numeracion`). Ningún asiento está firmado todavía, así que ningún `hash_lote` los cubre.

#### Scenario: Renumerar un libro en uso

- **GIVEN** un libro sin fijar con asientos del 1 al 5
- **WHEN** el DT configura el primer asiento en 101
- **THEN** los asientos pasan a 101–105 y se recalculan su cadena de hash y el contador

### Requirement: Numeración — cuándo no se puede cambiar

La numeración no SHALL cambiarse si el libro tiene un reanclaje (§ Reanclaje, guarda números) ni si su cadena no verifica (`fsj.verificar_cadena` distinto de NULL): recalcular los hashes cubriría con hashes válidos las filas alteradas y borraría el aviso de integridad.

#### Scenario: Cadena que no verifica

- **GIVEN** un libro sin fijar cuya cadena no verifica
- **WHEN** el DT intenta cambiar su numeración
- **THEN** no se puede

### Requirement: Numeración — contralor manual

Si la farmacia no activó el contralor digital (`tenant.fecha_activacion_contralor` NULL), los libros contralor SHALL llevarse en papel: `/libro/numeracion` los muestra como "Manual", sin formulario, y `libro.numeracion.configurar` los rechaza. Al activarlo pasan a ser configurables hasta su primer cierre.

#### Scenario: Contralor sin activar

- **GIVEN** una farmacia sin `fecha_activacion_contralor`
- **WHEN** se abre `/libro/numeracion`
- **THEN** los libros contralor se muestran como "Manual", sin formulario

### Requirement: Numeración — fijada con el primer cierre

La numeración SHALL quedar fija con el primer cierre que la imprime. `fsj.cierre_diario_firmar` fija (`libro_rubricado.numeracion_fijada_cierre_id`) cada libro todavía sin fijar que tenga un asiento (en cualquier estado) con fecha igual o anterior a la jornada firmada: sus números ya están en una hoja firmada.

#### Scenario: Firma de la primera jornada

- **GIVEN** un libro sin fijar con un asiento anulado del día que se firma
- **WHEN** se firma esa jornada
- **THEN** el libro queda fijado por ese cierre

### Requirement: Numeración — libros sin asientos y backfill

Un libro sin asientos (por ejemplo un contralor que todavía no se usó) SHALL seguir configurable. Los libros que ya tenían asientos firmados al aplicar la migración quedan fijados por su primer cierre (backfill).

#### Scenario: Contralor sin usar

- **GIVEN** un libro contralor sin asientos
- **WHEN** se firma una jornada
- **THEN** el libro sigue configurable

### Requirement: Numeración — confirmación al firmar

Cuando la jornada a firmar fija algún libro, el formulario de firma de `/cierres` SHALL mostrar "<Libro>: el primer asiento será el Nº N. Después de firmar no se puede cambiar. ¿No es así? Ir a Numeración del libro" y exige marcar "Confirmo la numeración".

#### Scenario: Firma que fija un libro

- **GIVEN** una jornada cuya firma fija el libro recetario
- **WHEN** el DT abre el formulario de firma
- **THEN** ve el aviso con el número del primer asiento y debe marcar "Confirmo la numeración"

### Requirement: Numeración — comparación bajo el bloqueo del cierre

Los números mostrados SHALL viajar con la firma y se vuelven a comparar bajo el mismo bloqueo del cierre (`validarConfirmacionNumeracion`, `modules/cierres/domain/numeracion.ts`): si cambiaron, la firma se rechaza.

#### Scenario: Numeración cambiada antes de firmar

- **GIVEN** un formulario de firma que mostró el Nº 1 como primer asiento
- **WHEN** la numeración cambió antes de enviar la firma
- **THEN** la firma se rechaza

### Requirement: INV-L26 — Quién cambia la numeración

`numero_inicial`, `numero_correlativo`, `hash_anterior` y `hash_integridad` SHALL cambiar solo por `fsj.libro_configurar_numeracion`, mientras el libro no esté fijado y en asientos sin cierre; `numeracion_fijada_cierre_id` se escribe una sola vez y solo desde `fsj.cierre_diario_firmar`.

#### Scenario: Libro fijado

- **GIVEN** un libro con `numeracion_fijada_cierre_id`
- **WHEN** se intenta cambiar `numero_inicial`
- **THEN** no cambia

### Requirement: INV-L26 — Tenant de la transacción

`fsj.libro_configurar_numeracion` y `fsj.cierre_diario_firmar` SHALL rechazar un `p_tenant_id` distinto del tenant de la transacción (`fsj.current_tenant_id()`; `cierre_diario_firmar` desde la migración 0101). [BD] `fsj.verificar_cadena` empieza a contar desde `numero_inicial`.

#### Scenario: Tenant ajeno

- **WHEN** se llama a `fsj.libro_configurar_numeracion` con un `p_tenant_id` distinto de `fsj.current_tenant_id()`
- **THEN** se rechaza

### Requirement: Numeración — límite conocido

Límite conocido: un texto ya guardado que cite un número de asiento antes de renumerar (el `motivoAnulacion` de una receta anulada antes del primer cierre, el registro de auditoría) SHALL conservar el número viejo. Lo mismo las etiquetas ya impresas: su "Receta N" es el número de asiento (DP-28), así que una etiqueta entregada antes de renumerar muestra el número viejo y su reimpresión el nuevo.

#### Scenario: Etiqueta impresa antes de renumerar

- **GIVEN** una etiqueta impresa con "Receta 3" antes de renumerar
- **WHEN** el libro se renumera y la etiqueta se reimprime
- **THEN** la etiqueta entregada conserva el número viejo y la reimpresión muestra el nuevo

### Requirement: Numeración — aviso del límite conocido

El formulario de `/libro/numeracion` SHALL avisar el límite conocido cuando el libro ya tiene asientos.

#### Scenario: Libro con asientos

- **GIVEN** un libro sin fijar con asientos
- **WHEN** se abre su formulario en `/libro/numeracion`
- **THEN** el formulario avisa el límite conocido

### Requirement: Numeración — número interno de receta

El número interno de receta (`receta.numero_interno`) SHALL ser otro contador: no se cambia con la numeración del libro ni coincide necesariamente con el del libro (un rectificativo consume número del libro; una receta que no se dispensa no genera asiento).

#### Scenario: Renumerar no toca el número interno

- **WHEN** se renumera un libro
- **THEN** `receta.numero_interno` no cambia

### Requirement: DP-32 — Hash calculado por la base

El `hashIntegridad` SHALL calcularlo la **base** en un trigger (`pgcrypto`, SHA-256), encadenado con el hash del asiento anterior del mismo libro. La aplicación no lo calcula ni lo envía.

#### Scenario: Insertar un asiento

- **WHEN** se inserta un asiento
- **THEN** un trigger de la base calcula su `hashIntegridad`, encadenado con el del asiento anterior del mismo libro

### Requirement: Impresión — una jornada por hoja

Impresión (2026-10-16). El libro SHALL imprimirse **una jornada por hoja**, en A4 horizontal: un día puede ocupar varias hojas, dos días nunca comparten una. Cada hoja lleva "Jornada dd/mm/aaaa — Hoja i de n", numerada dentro del día (`shared/pdf/hojas.ts`).

#### Scenario: Día largo

- **GIVEN** una jornada con asientos que no entran en una hoja
- **WHEN** se imprime
- **THEN** ocupa varias hojas, cada una con "Jornada dd/mm/aaaa — Hoja i de n", sin compartir hoja con otro día

### Requirement: Impresión — hoja del día

La hoja del día SHALL ser el PDF del cierre firmado (`/api/cierres/[id]/pdf`, `cierre-pdf.ts`), que se abre en una pestaña nueva (no se descarga; se genera en cada pedido).

#### Scenario: Abrir la hoja del día

- **WHEN** se pide la hoja del día de un cierre firmado
- **THEN** el PDF se abre en una pestaña nueva, generado en ese pedido

### Requirement: Impresión — encabezado del libro legalizado

La hoja del día SHALL seguir el formato del libro legalizado (2026-10-17): "LIBRO RECETARIO" centrado; arriba a la izquierda la farmacia (nombre de fantasía, o la razón social si no tiene), el propietario (la razón social, solo si hay nombre de fantasía), "DT: Apellido, Nombre (matrícula)" y una línea chica con CUIT y matrícula de la farmacia; a la derecha la jornada y la cantidad de asientos.

#### Scenario: Farmacia sin nombre de fantasía

- **GIVEN** una farmacia sin nombre de fantasía
- **WHEN** se imprime la hoja del día
- **THEN** arriba a la izquierda va la razón social y no se repite como propietario

### Requirement: Impresión — tabla y firma

Después del encabezado, la hoja del día SHALL llevar la tabla de asientos (Nº, paciente, médico, **fórmula de la prescripción completa** -- cada celda crece lo necesario, nunca se corta --, **Lote** y **Anulado**). La línea "Firma y aclaración del Farmacéutico", con farmacia, propietario y domicilio debajo, va centrada y **siempre en el mismo lugar: al pie de la última hoja de la jornada**.

#### Scenario: Fórmula larga

- **GIVEN** un asiento con una fórmula larga
- **WHEN** se imprime la hoja del día
- **THEN** su celda crece lo necesario y la fórmula no se corta

### Requirement: Impresión — firma en hoja nueva y lo que no lleva

Si la tabla termina demasiado abajo para dejar espacio para firmar, la firma SHALL pasar al pie de una hoja nueva. La hoja del día no lleva hash de lote, datos del mecanismo de firma, demora ni los libros contralor (toda droga, controlada o no, ya figura en la fórmula de su asiento).

#### Scenario: Tabla hasta el pie

- **GIVEN** una tabla que termina sin espacio para firmar
- **WHEN** se imprime la hoja del día
- **THEN** la línea de firma pasa al pie de una hoja nueva

### Requirement: Impresión — al firmar y exportación de /libro

Al firmar, `/cierres` SHALL mostrar "Imprimir hoja del día" (sin pasos obligatorios). La exportación PDF de `/libro` usa el mismo formato y empieza cada día en una hoja nueva (`libro-pdf.ts`).

#### Scenario: Después de firmar

- **WHEN** el DT firma una jornada en `/cierres`
- **THEN** se muestra "Imprimir hoja del día", sin pasos obligatorios

### Requirement: Anulados en la hoja

Anulados en la hoja (2026-10-17). Como en el libro legalizado (columna "NC"), la hoja SHALL listar **todos** los asientos de la fecha, también los anulados, con "SI" en la columna Anulado y al pie de cada hoja: "Aclaración: la leyenda "SI" en la columna Anulado indica que el asiento fue anulado en la misma jornada." Así el papel no salta números.

#### Scenario: Jornada con un anulado

- **GIVEN** una jornada firmada con un asiento anulado
- **WHEN** se imprime su hoja
- **THEN** el anulado figura con "SI" en la columna Anulado y la aclaración va al pie de cada hoja

### Requirement: Anulados — la firma adjunta solo los vigentes

La firma SHALL seguir adjuntando al cierre solo los VIGENTES (`cierre_diario_id`, hash del lote y `cantidad_asientos` no cambian): la hoja y `/cierres/[id]` leen los asientos por `fecha_asiento`, no por `cierre_diario_id` (`cierre-repository.ts#getCierreDetalle`). Como solo se anula antes de firmar (INV-L02), un anulado de la hoja siempre lo es de esa jornada.

#### Scenario: Firma con un anulado

- **GIVEN** una jornada con un asiento anulado
- **WHEN** se firma
- **THEN** el cierre adjunta solo los asientos VIGENTES

### Requirement: Anulados — sin efecto por rectificativo

Un asiento "sin efecto por rectificativo" no SHALL marcarse en la hoja: sigue vigente en la base y su rectificativo figura en la hoja de su propia jornada. No hay otra columna de estado.

#### Scenario: Original rectificado

- **GIVEN** un asiento de una jornada firmada que luego se rectificó
- **WHEN** se reimprime la hoja de su jornada
- **THEN** el asiento no se marca

### Requirement: Lote en la hoja

Lote en la hoja (2026-10-17). La columna Lote de la hoja del cierre SHALL mostrar, por asiento, una línea por droga usada con sus lotes: "Droga: lote, lote", por nombre de droga. Sale de asiento → sus preparaciones (`preparacion_id` legacy o `asiento_preparacion`, D8; un RECTIFICATIVO, por su asiento original) → `movimiento_stock` EGRESO_PREPARACION → `partida.lote` (`cierre-repository.ts#lotesPorAsiento`).

#### Scenario: Droga de dos partidas

- **GIVEN** un asiento cuya preparación usó una droga de dos partidas
- **WHEN** se imprime la hoja del cierre
- **THEN** la columna Lote muestra "Droga: lote, lote" para esa droga

### Requirement: Lote — solo visualización

La columna Lote SHALL ser SOLO de visualización, como "Receta Nº": no es una columna del asiento, no está en su hash y no cambia la tabla. Un asiento sin preparaciones (histórico) queda vacío. Incluye todo lo pesado, controlado o no. La exportación PDF de `/libro` todavía no la lleva, ni tampoco el encabezado y el pie del legalizado (no tiene los datos del tenant ni del DT de cada jornada).

#### Scenario: Exportación PDF de /libro

- **WHEN** se exporta `/libro` a PDF
- **THEN** la exportación no lleva la columna Lote ni el encabezado y el pie del legalizado

### Requirement: Orden de impresión

Orden de impresión (2026-10-16). Las hojas SHALL imprimirse en orden de fecha: mientras una jornada firmada no se imprimió nunca (`cierre_diario.fecha_impresion` NULL), no se puede imprimir ni reimprimir ninguna jornada posterior; esa y las anteriores, sí. Ejemplo: firmadas del 8 al 11 de octubre y el 8 sin imprimir → solo se puede imprimir el 8 (y reimprimir días anteriores).

#### Scenario: Jornada anterior sin imprimir

- **GIVEN** jornadas firmadas del 8 al 11 de octubre y el 8 sin imprimir
- **WHEN** se pide imprimir el 10
- **THEN** no se puede; solo se puede imprimir el 8 y reimprimir días anteriores

### Requirement: Orden de impresión — rechazo y botones

El servidor SHALL rechazar una impresión fuera de orden con "Primero imprimí la hoja del dd/mm/aaaa: las hojas del libro se imprimen en orden." (`cierres.imprimir.marcar`, `modules/cierres/domain/impresion.ts`); `/cierres`, `/cierres/[id]` y `/libro/dias` deshabilitan el botón y ofrecen la hoja pendiente.

#### Scenario: Impresión fuera de orden

- **GIVEN** una jornada firmada sin imprimir del 08/10
- **WHEN** se pide imprimir una jornada posterior
- **THEN** el servidor la rechaza con "Primero imprimí la hoja del dd/mm/aaaa: las hojas del libro se imprimen en orden.", con la fecha de la jornada sin imprimir

### Requirement: Orden de impresión — exportación de /libro

La exportación PDF de `/libro` SHALL ser una consulta, no la hoja oficial: no marca impresión ni sigue el orden de impresión.

#### Scenario: Exportar con una hoja pendiente

- **GIVEN** una jornada firmada sin imprimir
- **WHEN** se exporta `/libro` a PDF
- **THEN** la exportación se genera y no marca impresión

### Requirement: Fórmula de la prescripción

Fórmula de la prescripción (2026-10-16). La fórmula de cada ítem en el asiento SHALL ser la de la receta tal como vino, nunca recortada: **todos** sus componentes (drogas controladas o no y excipientes) con la cantidad prescripta, después el excipiente utilizado como "c.s.p." y al final cantidad y forma, con la fracción de dosis si la hay.

#### Scenario: Cápsulas con fracción de dosis

- **GIVEN** un ítem de Minoxidil 5 mg y Finasteride 1 mg, Ludipress como excipiente, 60 cápsulas de ½ dosis
- **WHEN** se escribe su asiento
- **THEN** la fórmula es "Minoxidil 5 mg; Finasteride 1 mg; Ludipress c.s.p. — 60 Cápsulas (1 cápsula = ½ dosis)"

### Requirement: Fórmula — ejemplos, detalle y asientos anteriores

Ejemplo: "Minoxidil 5 mg; Finasteride 1 mg; Ludipress c.s.p. — 60 Cápsulas (1 cápsula = ½ dosis)"; una forma no capsular con total: "Crema c.s.p. 100 g". Las líneas pesadas SHALL seguir en `detalle_asiento`. (`modules/preparaciones/domain/formula-prescripcion.ts`.) Los asientos anteriores conservan su fórmula (lo asentado no se modifica).

#### Scenario: Asiento anterior al cambio

- **GIVEN** un asiento escrito antes del 2026-10-16
- **WHEN** se lo consulta
- **THEN** conserva su fórmula

### Requirement: Excipiente utilizado

Excipiente utilizado (2026-10-16, migración 0083). En la toma, cuando un ítem queda con stock reservado ("Marcar como preparada"), SHALL aparecer debajo el campo opcional "Excipiente utilizado". Se guarda al salir del campo (`preparaciones.excipiente.guardar`, permiso `preparaciones.confirmar`, sin re-autenticación; en una cuenta de sector pide el operador) y no cambia el flujo.

#### Scenario: Cargar el excipiente

- **GIVEN** un ítem con stock reservado en la toma
- **WHEN** un usuario con `preparaciones.confirmar` completa "Excipiente utilizado" y sale del campo
- **THEN** el valor se guarda sin re-autenticación

### Requirement: Excipiente — queda fijo

Al imprimir las etiquetas el excipiente utilizado SHALL pasar a la fórmula del asiento, que está en el hash: queda fijo.

#### Scenario: Imprimir etiquetas

- **GIVEN** un ítem con excipiente utilizado
- **WHEN** se imprimen las etiquetas
- **THEN** el excipiente pasa a la fórmula del asiento y queda fijo

### Requirement: INV-P08 — Excipiente solo con la preparación iniciada

`preparacion.excipiente_texto` SHALL cambiar solo mientras la preparación está INICIADA.

#### Scenario: Preparación confirmada

- **GIVEN** una preparación CONFIRMADA
- **WHEN** se intenta cambiar `excipiente_texto`
- **THEN** no cambia

### Requirement: Libro por día

Libro por día (2026-10-16). `/libro/dias` SHALL listar cada día con al menos un asiento, con la cantidad y su firma: Firmada (con "Imprimir hoja"), Sin firmar (deuda, enlace a `/cierres`), En curso (la jornada actual, se firma al día siguiente) o Sin asientos vigentes. Un día sin recetas (fin de semana, feriado, sin pacientes) no figura ni cuenta como deuda. La firma se hace solo en `/cierres`.

#### Scenario: Fin de semana sin recetas

- **GIVEN** un sábado sin recetas
- **WHEN** se abre `/libro/dias`
- **THEN** el sábado no figura ni cuenta como deuda

### Requirement: Aviso de quiebre de la cadena

Aviso y reanclaje de la cadena (2026-10-18, migración 0087). Si `fsj.verificar_cadena` encuentra un quiebre en un libro abierto, la barra de avisos de la app (a quien tiene `libro.ver`) SHALL mostrar en rojo: "Se rompió la integridad de <libro> (asiento Nº N): los registros pudieron haber sido alterados o un cambio en el sistema interrumpió la cadena de control. Contactá a soporte y revisá la sección de Auditoría."

#### Scenario: Cadena rota

- **GIVEN** un libro abierto cuya cadena se rompe en el asiento Nº N
- **WHEN** un usuario con `libro.ver` navega la app
- **THEN** la barra de avisos muestra en rojo el aviso de integridad con el asiento Nº N

### Requirement: Aviso — resultado en memoria

El resultado de la verificación SHALL guardarse en memoria unos minutos (`resumen-integridad.ts`) para no recorrer la cadena en cada navegación.

#### Scenario: Navegación seguida

- **GIVEN** una verificación hecha hace un momento
- **WHEN** el usuario navega a otra página
- **THEN** el aviso sale del resultado guardado, sin recorrer la cadena

### Requirement: Reanclaje — quién y un solo hueco

Reanclar (`libro.integridad.reanclar`, permiso `libro.anulacion.autorizar` -- el DT --, re-autenticación reciente, motivo obligatorio, auditado como AUTORIZAR sobre `libro_reanclaje`) SHALL hacerse desde `/libro/integridad` y acepta **un solo hueco**: asientos que faltan en la numeración, de modo que el siguiente asiento existente apunta a un hash que ya no está.

#### Scenario: Reanclar un hueco

- **GIVEN** un libro al que le faltan asientos en la numeración
- **WHEN** el DT, con re-autenticación reciente, reancla con un motivo desde `/libro/integridad`
- **THEN** el reanclaje se audita como AUTORIZAR sobre `libro_reanclaje`

### Requirement: Reanclaje — qué guarda y cómo verifica

El reanclaje SHALL guardar en `fsj.libro_reanclaje` (solo inserción) el número faltante, el número desde el que se retoma y el `hash_anterior` de esa fila; `verificar_cadena` salta ese hueco únicamente si un reanclaje coincide exacto, y verifica con todo el rigor el resto. No renumera ni recalcula hashes (el libro impreso sigue coincidiendo).

#### Scenario: Verificar después de reanclar

- **GIVEN** un libro con un reanclaje que coincide exacto con su hueco
- **WHEN** se ejecuta `verificar_cadena`
- **THEN** salta ese hueco y verifica el resto, sin renumerar ni recalcular hashes

### Requirement: Reanclaje — cuándo no se puede

Un libro no SHALL poder reanclarse si existe una fila en el número roto (contenido o enlace alterado) ni si faltan asientos al final: eso no es una baja de asientos completos. El aviso desaparece porque la verificación vuelve a dar OK; el reanclaje queda listado para siempre en `/libro/integridad`.

#### Scenario: Fila alterada

- **GIVEN** un libro cuya cadena se rompe en una fila que existe
- **WHEN** el DT intenta reanclar
- **THEN** no se puede

### Requirement: Receta Nº en el listado

Receta Nº en el listado (2026-10-14). `/libro` y la exportación PDF SHALL mostrar el `numero_interno` de la receta de cada asiento (columna "Receta Nº"), leído por join asiento → preparación → item_receta → receta (un RECTIFICATIVO, por la preparación de su asiento original; sin preparación -- histórico -- "—").

#### Scenario: Rectificativo en el listado

- **GIVEN** un asiento RECTIFICATIVO
- **WHEN** se consulta `/libro`
- **THEN** su "Receta Nº" sale de la preparación de su asiento original

### Requirement: Receta Nº — solo visualización

La columna "Receta Nº" SHALL ser SOLO de visualización: no es una columna del asiento, no forma parte de su snapshot `*_texto` ni de su `hashIntegridad`, y no cambia la tabla (`modules/libro/infrastructure/asiento-repository.ts`, `recetaNumeroInterno`). La exportación Excel no la incluye.

#### Scenario: Exportación Excel

- **WHEN** se exporta `/libro` a Excel
- **THEN** la exportación no incluye "Receta Nº"

### Requirement: Jornada en el listado

Jornada en el listado (2026-10-16). `/libro` SHALL mostrar, por asiento, si su jornada ya está firmada ("Firmado" / "Sin firmar", columna "Jornada"; en móvil, debajo del estado). Se deriva de `cierre_diario_id` (`cierreFirmado`, la misma regla que el detalle y que `anularAsiento`). Es independiente de la columna "Estado", que muestra la vigencia del asiento. Solo visualización.

#### Scenario: Asiento de una jornada sin firmar

- **GIVEN** un asiento sin `cierre_diario_id`
- **WHEN** se consulta `/libro`
- **THEN** su columna "Jornada" dice "Sin firmar"

### Requirement: Columna Estado del listado

La columna "Estado" de `/libro` SHALL mostrar la vigencia del asiento (vigente / anulado / sin efecto por rectificativo, `estado-visual.ts`).

#### Scenario: Asiento anulado

- **GIVEN** un asiento `ANULADO`
- **WHEN** se consulta `/libro`
- **THEN** su columna "Estado" dice anulado

### Requirement: Configuración del contralor por farmacia

`Tenant.fechaActivacionContralor: DateTime | null` SHALL definir el contralor de cada farmacia. `null`: los libros de psicotrópicos y estupefacientes se llevan a mano. El sistema no genera asientos contralor. Con fecha: el sistema lleva los libros desde ese momento.

#### Scenario: Farmacia sin activación

- **GIVEN** una farmacia con `fechaActivacionContralor` null
- **WHEN** se mueve stock de una droga controlada
- **THEN** el sistema no genera asientos contralor

### Requirement: AsientoContralor — campos condicionales

En `AsientoContralor` (modelo en la sección `Modelo AsientoContralor`), `movimientoStockId` SHALL ser null solo en APERTURA, `asientoRecetarioId` va solo en EGRESO por preparación y `numeroValeAdquisicion` solo en INGRESO. `libroId` es un LibroRubricado de tipo psicotrópicos o estupefacientes, `numeroCorrelativo` es propio de cada libro y `drogaDescripcion` es texto congelado.

#### Scenario: Asiento de apertura

- **WHEN** se registra un asiento APERTURA
- **THEN** su `movimientoStockId` es null

### Requirement: AsientoContralor — movimientos y relaciones

Enum `TipoMovimientoContralor` SHALL ser: `APERTURA`, `INGRESO`, `EGRESO`, `AJUSTE`. Relaciones: `MovimientoStock 1 → 0..1 AsientoContralor`; `AsientoRecetario 1 → 0..* AsientoContralor`; `LibroRubricado 1 ◆— 0..* AsientoContralor`; `AsientoContralor 0..* → 1 Droga`. `saldoAnterior` hace que cada renglón sea verificable por sí solo.

#### Scenario: Movimiento de stock

- **GIVEN** un `MovimientoStock` de una droga controlada
- **WHEN** genera su asiento contralor
- **THEN** ese movimiento tiene a lo sumo un `AsientoContralor`

### Requirement: Contralor desactivado

Contralor desactivado: el recetario SHALL registrar todas las preparaciones, incluidas las que usan drogas controladas. El stock de controladas se descuenta normalmente. No se genera ningún `AsientoContralor`.

#### Scenario: Preparación con controlada sin contralor

- **GIVEN** una farmacia con el contralor desactivado
- **WHEN** se confirma una preparación con droga controlada
- **THEN** el recetario la registra y el stock se descuenta, sin `AsientoContralor`

### Requirement: Contralor activado

Contralor activado: el recetario SHALL registrar todas las preparaciones y el stock de controladas se descuenta normalmente (todo lo del contralor desactivado), y además cada movimiento de stock de una droga controlada genera su asiento en el libro que corresponde.

#### Scenario: Preparación con controlada con contralor

- **GIVEN** una farmacia con el contralor activado
- **WHEN** se confirma una preparación con droga controlada
- **THEN** el recetario la registra y cada movimiento de stock de la controlada genera su asiento contralor

### Requirement: Activación del contralor

La activación SHALL exigir cargar el saldo de apertura de cada droga controlada, con un asiento `APERTURA` por droga cuyo saldo es el del libro manual y debe coincidir con el stock físico. Los movimientos anteriores a la fecha de activación no generan asientos retroactivos.

#### Scenario: Activar el contralor

- **WHEN** la farmacia activa el contralor
- **THEN** debe cargar el saldo de apertura de cada droga controlada, con un asiento `APERTURA` por droga
- **AND** los movimientos anteriores a la activación no generan asientos

### Requirement: INV-L08 — Asiento contralor por movimiento (reemplaza la versión anterior)

Si el tenant tiene `fechaActivacionContralor`, todo `MovimientoStock` posterior a esa fecha sobre una droga con `esControlada = true` SHALL generar un `AsientoContralor` dentro de la misma transacción. [BD+APP]

#### Scenario: Movimiento posterior a la activación

- **GIVEN** un tenant con `fechaActivacionContralor`
- **WHEN** se registra un `MovimientoStock` posterior sobre una droga controlada
- **THEN** se genera su `AsientoContralor` en la misma transacción

### Requirement: INV-L11 — Recetario obligatorio

El registro en el libro recetario SHALL ser obligatorio con independencia de la configuración del contralor. Una preparación con droga controlada siempre genera su `AsientoRecetario`. [BD+APP]

#### Scenario: Controlada con contralor activo

- **WHEN** se confirma una preparación con droga controlada
- **THEN** genera su `AsientoRecetario`, esté o no activo el contralor

### Requirement: INV-L12 — Saldo posterior

`saldoPosterior = saldoAnterior + cantidad` SHALL cumplirse en APERTURA e INGRESO, y `saldoAnterior − cantidad` en EGRESO. En AJUSTE, según su sentido. [BD]

#### Scenario: Egreso

- **GIVEN** un saldo anterior de 10 g
- **WHEN** se registra un EGRESO de 3 g
- **THEN** el saldo posterior es 7 g

### Requirement: Conflicto INV-L12 y DP-21b — AJUSTE

(conflicto) AJUSTE "según su sentido" (INV-L12) choca con DP-21b, que dice que todo ajuste resta. Se asume que el AJUSTE contralor SHALL restar siempre.

#### Scenario: Ajuste contralor

- **GIVEN** un saldo anterior de 10 g
- **WHEN** se registra un AJUSTE de 2 g
- **THEN** el saldo posterior es 8 g

### Requirement: INV-L13 — Saldo anterior bajo bloqueo

`saldoAnterior` SHALL ser igual al `saldoPosterior` del último asiento vigente de esa droga en ese libro. Se calcula bajo bloqueo para que dos movimientos simultáneos no lean el mismo saldo. [BD]

#### Scenario: Dos movimientos simultáneos

- **WHEN** dos movimientos de la misma droga se registran a la vez en el mismo libro
- **THEN** no leen el mismo saldo: el segundo parte del `saldoPosterior` del primero

### Requirement: INV-L14 — Saldo no negativo

`saldoPosterior` nunca SHALL ser negativo. [BD]

#### Scenario: Egreso mayor al saldo

- **GIVEN** un saldo anterior de 2 g
- **WHEN** se intenta registrar un EGRESO de 3 g
- **THEN** se rechaza, porque el saldo posterior sería negativo

### Requirement: INV-L15 — Una apertura por droga y libro

SHALL existir exactamente un asiento APERTURA por droga y libro, y es el primero de su secuencia. [BD]

#### Scenario: Segunda apertura

- **GIVEN** una droga con su APERTURA en un libro
- **WHEN** se intenta registrar otra APERTURA de esa droga en ese libro
- **THEN** se rechaza

### Requirement: INV-L16 — Ingreso con vale

Un INGRESO SHALL exigir `numeroValeAdquisicion`. [BD]

#### Scenario: Ingreso sin vale

- **WHEN** se intenta registrar un INGRESO sin `numeroValeAdquisicion`
- **THEN** se rechaza

### Requirement: INV-L17 — El contralor no se desactiva

Una vez activado, el contralor no SHALL desactivarse. Si el cliente decide volver a llevarlo a mano, se registra el cierre con saldo final y fecha, y `fechaActivacionContralor` no vuelve a nulo. [BD+APP]

#### Scenario: Volver a llevarlo a mano

- **GIVEN** una farmacia con el contralor activado
- **WHEN** decide volver a llevarlo a mano
- **THEN** se registra el cierre con saldo final y fecha, y `fechaActivacionContralor` no vuelve a nulo

### Requirement: INV-L01, INV-L03 e INV-C02 en AsientoContralor

INV-L01 (inmutabilidad), INV-L03 (secuencia en base) e INV-C02 (vinculación al cierre diario) SHALL aplicar a `AsientoContralor` sin cambios.

#### Scenario: Asiento contralor del día

- **WHEN** se firma la jornada de un asiento contralor vigente
- **THEN** el asiento queda vinculado a ese cierre diario, como un asiento recetario

### Requirement: Libro según el tipo de control (deducción)

(deducción) El libro al que va cada asiento SHALL salir de `Droga.tipoControl`: PSICOTROPICO → libro de psicotrópicos; ESTUPEFACIENTE → libro de estupefacientes.

#### Scenario: Estupefaciente

- **WHEN** se registra un asiento contralor de una droga ESTUPEFACIENTE
- **THEN** va al libro de estupefacientes

### Requirement: Un asiento contralor por movimiento (deducción)

(deducción) Un EGRESO por preparación que consume dos partidas de la misma droga SHALL generar **dos** asientos contralor, uno por movimiento (relación `MovimientoStock 1 → 0..1`).

#### Scenario: Dos partidas

- **WHEN** una preparación consume dos partidas de la misma droga controlada
- **THEN** se generan dos asientos contralor, uno por movimiento

### Requirement: Vale en la carga de partida controlada (deducción)

(deducción) Como hay un INGRESO con vale, la carga de una partida de droga controlada con contralor activo SHALL exigir `numeroValeAdquisicion`.

#### Scenario: Partida sin vale

- **GIVEN** una farmacia con el contralor activo
- **WHEN** se carga una partida de droga controlada sin `numeroValeAdquisicion`
- **THEN** se rechaza

### Requirement: Anulación sin revertir el contralor (deducción)

(deducción) Anular o rectificar un asiento recetario no SHALL revertir sus asientos contralor (INV-L20): el egreso de stock se mantiene, y el libro contralor lo refleja.

#### Scenario: Anular un asiento con controlada

- **GIVEN** un asiento recetario con sus asientos contralor
- **WHEN** se anula el asiento recetario
- **THEN** sus asientos contralor no se revierten

### Requirement: Conflicto DP-38 — LibroRubricado mínimo

(conflicto) `AsientoContralor.libroId` necesita `LibroRubricado`, cuyo modelo quedó diferido a la consulta con la Asociación de Farmacias (DP-38). Se asume una entidad mínima: `LibroRubricado` SHALL tener tipo, número, fecha de rúbrica, expediente, fecha de cierre, sin folios. Los folios siguen diferidos.

#### Scenario: Libro rubricado

- **WHEN** se registra un libro rubricado
- **THEN** tiene tipo, número, fecha de rúbrica, expediente y fecha de cierre, sin folios

### Requirement: Droga controlada dada de alta después de la activación

(resuelto 2026-10-23) Una droga controlada dada de alta **después** de la activación: su alta (o la edición que la vuelve controlada) SHALL pedir el saldo de apertura del libro manual (0 si la farmacia nunca la tuvo) y genera su `APERTURA` en la misma transacción. No hay APERTURA automática con saldo 0. Ver `openspec/specs/existencia-inicial/spec.md` R12.

#### Scenario: Editar una droga para volverla controlada

- **GIVEN** una farmacia con el contralor activado
- **WHEN** se edita una droga para volverla controlada
- **THEN** se pide su saldo de apertura y se genera su `APERTURA` en la misma transacción

### Requirement: INV-C21 — Solo se firman jornadas anteriores

`fsj.cierre_diario_firmar` SHALL rechazar firmar la jornada en curso o una futura (`p_fecha >= jornada_actual` del tenant, migración 0075). Solo se firman jornadas anteriores. Una jornada futura firmada bloquearía, vía INV-C03, cualquier movimiento de stock o asiento posterior hasta que el calendario alcance esa fecha — un bloqueo irreversible, porque `cierre_diario` no admite baja ni desvinculación (INV-C04).

#### Scenario: Firmar la jornada en curso

- **WHEN** se intenta firmar la jornada en curso
- **THEN** `fsj.cierre_diario_firmar` lo rechaza

### Requirement: DP-18b — Cierre al día siguiente

DP-18b (revisada, 2026-10-13, migración 0075). El cierre diario SHALL hacerse **al día siguiente**: el Director Técnico firma la jornada anterior, nunca la jornada en curso. Reemplaza la decisión del 2026-09-21 ("puede firmar la jornada en curso").

#### Scenario: Firma del día anterior

- **GIVEN** la jornada de ayer sin firmar
- **WHEN** el Director Técnico firma hoy
- **THEN** firma la jornada de ayer

### Requirement: DP-18b — Pendientes de firma

La jornada de hoy no SHALL aparecer en "pendientes de firma" ni en la alerta del layout hasta que empieza la jornada siguiente (`listJornadasPendientes` / `getResumenPendientes` filtran `fecha < jornada_actual`). Ya no hace falta la advertencia de UI previa a firmar el día en curso (preparaciones INICIADA): firmar la jornada anterior nunca bloquea registros de hoy.

#### Scenario: Jornada de hoy

- **WHEN** se consultan los pendientes de firma
- **THEN** la jornada de hoy no aparece

### Requirement: DP-18 — Plazo de firma por tenant

DP-18 (resuelta, 2026-09-24, FASE 10 punto 10.1). "En término" ya no es un valor fijo (la misma jornada): se agrega el parámetro por tenant `plazo_firma_dias` (entero ≥ 0, default 0, editable por ADM en `/admin/configuracion/parametros`). `fsj.cierre_diario_calcular_fuera_de_termino` (migración 0038) SHALL recalcular: `fuera_de_termino = jornada_actual(tenant) > (fecha + plazo_firma_dias)`. Con el default 0 el comportamiento es idéntico al anterior.

#### Scenario: Parámetro editable

- **GIVEN** un usuario ADM
- **WHEN** cambia `plazo_firma_dias` en `/admin/configuracion/parametros`
- **THEN** el valor es un entero ≥ 0

### Requirement: DP-18 — Plazo desde el día siguiente

Migración 0075 (DP-18b revisada): el plazo SHALL contarse desde el día siguiente a la jornada: `fuera_de_termino = jornada_actual > (fecha + 1 + plazo_firma_dias)`; con el default 0, firmar al día siguiente es en término y cualquier día posterior queda fuera de término. `fsj.cierre_diario_firmar` no cambia de firma, solo delega en `fsj.cierre_diario_calcular_fuera_de_termino`.

#### Scenario: Firma dos días después

- **GIVEN** `plazo_firma_dias` en 0
- **WHEN** se firma una jornada dos días después de su fecha
- **THEN** el cierre queda fuera de término

### Requirement: DP-18c — Motivo de demora

DP-18c (resuelta, 2026-09-24, FASE 10 punto 10.1). `motivo_demora` SHALL pasar de texto libre a un enum `fsj.motivo_demora` (migración 0039): `AUSENCIA_DT`, `FALLA_SISTEMA`, `FARMACIA_CERRADA`, `OTRO`. `OTRO` exige `motivo_demora_detalle` no vacío (CHECK `cierre_diario_motivo_demora_otro_detalle_check`); las otras tres opciones no lo exigen (aunque la UI permite agregarlo siempre como detalle libre).

#### Scenario: OTRO sin detalle

- **WHEN** se firma fuera de término con motivo `OTRO` y `motivo_demora_detalle` vacío
- **THEN** el CHECK lo rechaza

### Requirement: DP-18c — Migración de datos del motivo

Migración de datos: todo valor preexistente que no coincidía exactamente con una de las 4 etiquetas SHALL pasar a `OTRO`, y si `motivo_demora_detalle` estaba vacío se completa con el texto original (para no perder información).

#### Scenario: Motivo libre preexistente

- **GIVEN** un cierre con `motivo_demora` "se cortó la luz" y detalle vacío
- **WHEN** se aplica la migración 0039
- **THEN** el motivo pasa a `OTRO` y el detalle queda "se cortó la luz"

### Requirement: DP-18c — Motivo en la firma

`fsj.cierre_diario_firmar` SHALL seguir recibiendo `p_motivo_demora` como `text` (compatibilidad de firma) y lo castea a `fsj.motivo_demora` en el INSERT; un valor inválido es rechazado por Postgres con el error estándar de enum. La app valida contra el mismo enum (zod) antes de llegar a la base.

#### Scenario: Motivo inválido

- **WHEN** se llama a `fsj.cierre_diario_firmar` con un `p_motivo_demora` que no es del enum
- **THEN** Postgres lo rechaza con el error estándar de enum

### Requirement: DP-18d — Jornada sin asientos

DP-18d (resuelta, 2026-09-24, FASE 10 punto 10.1). Una jornada sin ningún asiento (ni recetario ni contralor) no SHALL exigir firma: no aparece en el listado de "pendientes de firma" ni en la alerta del layout (FASE 10 punto 10.3) -- `modules/cierres/infrastructure/cierre-repository.ts#listJornadasPendientes` solo selecciona fechas con al menos un asiento VIGENTE sin vincular.

#### Scenario: Jornada vacía

- **GIVEN** una jornada anterior sin ningún asiento
- **WHEN** se consultan los pendientes de firma
- **THEN** la jornada no aparece

### Requirement: DP-18d — Firmarla igual

Firmar igual una jornada sin ningún asiento (con `cantidad_asientos = 0`) SHALL seguir siendo posible y válido (nada en la BD lo impide, `cierre_diario_cantidad_asientos_check` solo exige `>= 0`); simplemente nunca se fuerza.

#### Scenario: Firma de una jornada vacía

- **GIVEN** una jornada anterior sin ningún asiento
- **WHEN** el DT la firma
- **THEN** el cierre queda con `cantidad_asientos = 0`

### Requirement: DP-19 — Mecanismo de firma

DP-19 (resuelta, 2026-09-24). No SHALL implementarse firma `DIGITAL_CERTIFICADA` ni sello de tiempo de tercero (TSA, RFC 3161) en este alcance. `mecanismo_firma` sigue siendo `CREDENCIALES_DT` (contraseña completa del DT, nunca PIN) y `sello_tiempo`/`fecha_firma` son la hora del servidor (`now()`, INV-C20) -- no hay integración externa.

#### Scenario: Firmar una jornada

- **WHEN** el DT firma una jornada
- **THEN** el mecanismo es `CREDENCIALES_DT`, con su contraseña completa y nunca PIN
- **AND** `sello_tiempo` y `fecha_firma` son la hora del servidor

### Requirement: DP-21 — Comprobante de cierre

DP-21 (resuelta, 2026-09-24, FASE 10 punto 10.2). SHALL existir un comprobante de cierre en A4, generado server-side (`modules/cierres/infrastructure/cierre-pdf.ts`, pdfkit vía `shared/pdf/pdf-document.ts`), desacoplado del cálculo de folios (M13b sigue diferido a la Asociación de Farmacias, DP-38).

#### Scenario: Generar el comprobante

- **WHEN** se pide el comprobante de un cierre
- **THEN** se genera en A4 en el servidor

### Requirement: DP-21 — Contenido del comprobante

Contenido exacto del comprobante, que SHALL llevar: datos de la farmacia (razón social/nombre de fantasía, CUIT, matrícula, domicilio -- datos editables del tenant), fecha de la jornada, DT (nombre, apellido, matrícula -- snapshot `matricula_dt`), listado de asientos recetario de ese cierre ordenados por número (Nº, paciente, médico, fórmula, estado visual incluyendo anulado / sin efecto por rectificativo -- vía `modules/libro/domain/estado-visual.ts`).

#### Scenario: Datos de la farmacia

- **WHEN** se genera el comprobante
- **THEN** lleva razón social o nombre de fantasía, CUIT, matrícula y domicilio de la farmacia, la fecha de la jornada y el DT con su matrícula

### Requirement: DP-21 — Contralor, lote y firma en el comprobante

El comprobante SHALL llevar también el listado de asientos contralor de ese cierre (Nº, libro, droga, movimiento, cantidad, saldo posterior), `cantidad_asientos`, `hash_lote`, `sello_tiempo`/`fecha_firma`, fuera de término + motivo (con su detalle), y un área en blanco para "Firma y sello del Director Técnico".

#### Scenario: Cierre fuera de término

- **GIVEN** un cierre fuera de término con motivo y detalle
- **WHEN** se genera el comprobante
- **THEN** muestra que está fuera de término, con el motivo y su detalle

### Requirement: DP-21 — Ruta, permiso e impresión

Ruta `app/api/cierres/[id]/pdf`, que SHALL exigir el permiso `cierres.imprimir` (DT/FAR). La primera impresión fija `fecha_impresion`/`impreso_por_id` (columna con grant de UPDATE, solo si todavía es NULL -- el trigger INV-C04 la congela después); toda impresión (primera o reimpresión) se audita (`TipoAccion.IMPRIMIR_CIERRE`).

#### Scenario: Reimpresión

- **GIVEN** un cierre ya impreso
- **WHEN** se lo reimprime
- **THEN** `fecha_impresion` no cambia y la reimpresión se audita como `IMPRIMIR_CIERRE`

## Fuente

> Fuente: decisiones del usuario del 2026-09-21 (DP-16, DP-16c, DP-17, DP-31, DP-32, DP-33).
> Fuente de verdad para los puntos 1.11–1.13 y las fases 8–10 del plan. Donde contradice al plan original, manda este documento.
> Las notas **[DEDUCCIÓN]** derivan de combinar decisiones; las **[PENDIENTE]** requieren confirmación.

En los requirements, "(deducción)" marca las notas **[DEDUCCIÓN]**, "(conflicto)" las **[CONFLICTO]** y "(resuelto)"
las **[RESUELTO]** del original.

## Modelo AsientoContralor

| Campo | Tipo | Nota |
|---|---|---|
| id | UUID | |
| tenantId | UUID | |
| libroId | UUID | LibroRubricado de tipo psicotrópicos o estupefacientes |
| numeroCorrelativo | Long | propio de cada libro |
| fechaAsiento | Date | |
| tipoMovimiento | TipoMovimientoContralor | |
| drogaId | UUID | |
| drogaDescripcion | String | texto congelado |
| cantidad | Decimal | |
| unidadMedida | UnidadMedida | |
| saldoAnterior | Decimal | |
| saldoPosterior | Decimal | |
| movimientoStockId | UUID | null solo en APERTURA |
| asientoRecetarioId | UUID | solo en EGRESO por preparación |
| numeroValeAdquisicion | String | solo en INGRESO |
| cierreDiarioId | UUID | |
| estado | EstadoAsiento | |
| hashIntegridad | String | |
| registradoPorId | UUID | |

## Notas y puntos pendientes

- **[PENDIENTE]** "Se segrega para inspección": no está definido si el sistema lleva registro del preparado segregado (listado pendiente, fecha de inspección o destrucción) o si es solo una práctica física.
- Pendiente (no implementado): ancla externa de los hashes (PDF del cierre / mail) y alertas por otro canal; sin ellas la cadena no distingue una baja legítima de una manipulación hecha con acceso a la base.
- **[PENDIENTE]** Un sobrante de droga controlada entra como partida nueva (DP-21b), pero INV-L16 exige vale de adquisición para todo INGRESO, y un sobrante no tiene vale.
- **[PENDIENTE]** Nombres del enum `TipoLibro`: el diagrama usa `PSICOTROPICO` / `ESTUPEFACIENTE` (singular). Se mantiene el singular para no duplicar términos del glosario.

## Registro histórico

### D7, decisión original (revertida)

Revertida para stock (2026-09-29) y para el libro (2026-10-21): ver el requirement "D7 — Co-firma del DT sin re-auth
del solicitante". Texto original: "**D7.** Los comandos de verificación de co-firma del DT (`verificarCoFirmaDtLibro`, y el equivalente de stock) ahora exigen el re-auth reciente del SOLICITANTE (`requireRecentReauth`) ANTES de evaluar la contraseña del DT -- así un operador con el step-up vencido no puede gastar intentos de la contraseña del DT antes de que su propio comando final (`anularAsiento`/`rectificarAsiento`/`registrarAjusteStock`) lo rechace por falta de re-auth."

### Asientos históricos (DP-17), eliminados el 2026-10-16

Lo que sigue queda como registro de la decisión original.

Los asientos históricos son **solo para control y consulta**. No forman parte del libro recetario digital.

- Copian el formato del libro físico, incluido su propio número de asiento.
- Existen solo para el relevamiento de datos.
- **No** consumen el correlativo del libro digital, **no** entran en la cadena de hash, **no** se vinculan a cierres diarios, **no** generan movimientos de stock.

**[DEDUCCIÓN]** Van en una tabla separada (`asiento_historico`), no en `asiento_recetario` con `origen_carga = DIGITALIZACION_HISTORICA`. Mezclarlos rompería INV-L04 (correlativo sin saltos) e INV-C02 (todo asiento vigente de la fecha queda vinculado a un cierre). El valor `DIGITALIZACION_HISTORICA` del enum `OrigenAsiento` se elimina.

**D5 (decisión del usuario, 2026-09-23).** Un mismo folio físico no puede digitalizarse dos veces: `UNIQUE (tenant_id, tipo_libro, numero_asiento_fisico)` (migración 0035) -- `fsj.asiento_historico` no tiene una columna propia de "libro físico" más allá de `tipo_libro` (se asume un libro físico por tipo, igual que `fsj.libro_rubricado`). La violación se traduce a un mensaje claro en `crearAsientoHistorico`.

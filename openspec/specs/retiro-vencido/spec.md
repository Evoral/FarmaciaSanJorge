# Retiro vencido (recetas preparadas que nadie retira)

## Purpose

Una receta en estado `PREPARADA` que nadie retira pasa automáticamente a un estado nuevo, `RETIRO_VENCIDO`, después de N días (parámetro por farmacia, 30 días por defecto, editable por el administrador). La operación es reversible: si la persona concurre a retirar, se reactiva volviendo a `PREPARADA` y se entrega normalmente. Si algún preparado de la receta ya venció, reactivar exige la autorización de un Director Técnico vigente mediante co-firma. Una receta en `RETIRO_VENCIDO` puede archivarse en un lote; una vez archivada, no puede reactivarse (decisión del usuario, 2026-10-20).

## Requirements

### Requirement: Estado RETIRO_VENCIDO y contadores de recetas en curso
El tipo `fsj.estado_receta` SHALL incluir el valor `RETIRO_VENCIDO`. Este estado no es terminal, pero las recetas en `RETIRO_VENCIDO` no SHALL contar como recetas en curso, quedando excluidas de los contadores de activas del inicio y de la trayectoria del paciente, así como del listado de entregas por defecto.

#### Scenario: Exclusión de contadores de recetas en curso
- **GIVEN** una receta que pasa al estado `RETIRO_VENCIDO`
- **WHEN** se calculan los contadores de recetas en curso o activas en inicio y trayectoria
- **THEN** la receta no se contabiliza entre las recetas en curso
- **AND** no aparece en el listado por defecto de `/entregas`

#### Scenario: Inclusión tras filtrado explícito
- **GIVEN** una receta en estado `RETIRO_VENCIDO`
- **WHEN** el usuario filtra explícitamente por "Retiro vencido" en `/entregas` o `/recetas`
- **THEN** la receta se muestra en los resultados

### Requirement: Transiciones del estado RETIRO_VENCIDO
El estado `RETIRO_VENCIDO` solo SHALL admitir transiciones de entrada desde `PREPARADA` (mediante el job diario), y transiciones de salida hacia `PREPARADA` (mediante reactivación) o hacia `ANULADA` (por anulación directa o automática por el libro recetario), conforme a INV-R08.

#### Scenario: Transiciones autorizadas según lista blanca de INV-R08
- **GIVEN** una receta en estado `PREPARADA`
- **WHEN** se procesa su vencimiento por el job diario
- **THEN** la receta pasa a `RETIRO_VENCIDO`

#### Scenario: Transición no autorizada rechazada
- **GIVEN** una receta en un estado distinto de `PREPARADA`
- **WHEN** se intenta pasar su estado a `RETIRO_VENCIDO`
- **THEN** la transición es rechazada por INV-R08

### Requirement: Columna preparada_en y reinicio del reloj
La tabla `fsj.receta` SHALL registrar la columna `preparada_en` (`timestamptz NULL`), actualizada automáticamente por un trigger cada vez que la receta ingresa al estado `PREPARADA` (desde preparación, anulación de entrega o reactivación), reiniciando el conteo de días para el retiro.

#### Scenario: Actualización de preparada_en al entrar a PREPARADA
- **GIVEN** una receta que entra al estado `PREPARADA` desde `EN_PREPARACION`
- **WHEN** se confirma la preparación
- **THEN** la columna `preparada_en` se establece con la fecha y hora actual

#### Scenario: Reinicio del reloj por reactivación o anulación de entrega
- **GIVEN** una receta que regresa a `PREPARADA` tras una reactivación o la anulación de una entrega
- **WHEN** se actualiza el estado de la receta
- **THEN** el trigger actualiza `preparada_en` reiniciando el plazo de N días para el retiro

### Requirement: Parámetro días para el retiro
El sistema SHALL disponer del parámetro `dias_retiro_vencido` en `fsj.parametro` de tipo número entero entre 0 y 365, con valor por defecto de 30 días. Si el valor es 0, el vencimiento de retiro SHALL considerarse desactivado. Ante la ausencia del registro en la base de datos, el sistema SHALL utilizar el valor por defecto de 30 días.

#### Scenario: Parámetro dentro del rango permitido
- **GIVEN** un administrador en la configuración de parámetros
- **WHEN** guarda un valor entero entre 0 y 365 para `dias_retiro_vencido`
- **THEN** el valor se almacena exitosamente

#### Scenario: Desactivación con valor cero
- **GIVEN** un tenant con `dias_retiro_vencido` configurado en 0
- **WHEN** se evalúa el vencimiento de retiro
- **THEN** el vencimiento se considera desactivado

#### Scenario: Fallback por parámetro inexistente
- **GIVEN** un tenant que no posee la fila `dias_retiro_vencido` en `fsj.parametro`
- **WHEN** el sistema lee el parámetro
- **THEN** retorna el valor por defecto de 30 días

### Requirement: Fuera de alcance para envíos pendientes de firma
El vencimiento de retiro SHALL NOT aplicar a recetas en estado `ENVIADA_PEND_FIRMA`. Asimismo, el paso a `RETIRO_VENCIDO` SHALL NOT generar movimientos de stock sobre los insumos de la receta.

#### Scenario: Receta en ENVIADA_PEND_FIRMA no vence por retiro
- **GIVEN** una receta en estado `ENVIADA_PEND_FIRMA` cuyo plazo de días se cumplió
- **WHEN** corre el job diario de retiros vencidos
- **THEN** la receta permanece en `ENVIADA_PEND_FIRMA` y no pasa a `RETIRO_VENCIDO`

#### Scenario: Sin movimientos de stock al pasar a retiro vencido
- **GIVEN** una receta que pasa a `RETIRO_VENCIDO`
- **WHEN** se produce la transición de estado
- **THEN** no se genera ningún movimiento de stock ni egreso de insumos

### Requirement: RV1 — Vencimiento tras N días de jornada
Una receta en estado `PREPARADA` SHALL transicionar a `RETIRO_VENCIDO` cuando hayan transcurrido N días de jornada (según la zona horaria del tenant) desde `preparada_en`: una receta preparada en la jornada D vence en la primera corrida del job en la jornada D + N. Si el parámetro N es 0, las recetas no SHALL vencer nunca.

#### Scenario: Receta que cumple el plazo de N jornadas
- **GIVEN** una receta en `PREPARADA` con `preparada_en` en la jornada 2026-10-01 y parámetro `dias_retiro_vencido` igual a 30
- **WHEN** el job se ejecuta en la jornada 2026-10-31
- **THEN** la receta pasa al estado `RETIRO_VENCIDO`

#### Scenario: Receta que aún no cumplió el plazo
- **GIVEN** una receta en `PREPARADA` con `preparada_en` en la jornada 2026-10-01 y parámetro `dias_retiro_vencido` igual a 30
- **WHEN** el job se ejecuta en la jornada 2026-10-30
- **THEN** la receta permanece en estado `PREPARADA`

#### Scenario: Tenant con parámetro en 0 (desactivado)
- **GIVEN** un tenant con parámetro `dias_retiro_vencido` igual a 0
- **WHEN** el job diario se ejecuta
- **THEN** ninguna receta pasa a `RETIRO_VENCIDO`

### Requirement: RV2 — Ejecución periódica e idempotencia del job
El job diario de retiros vencidos SHALL ejecutarse una vez al día recorriendo todos los tenants activos, aislando los errores por tenant de manera que el fallo en uno no detenga a los demás. La ejecución del job SHALL ser idempotente, de modo que ejecuciones repetidas en la misma jornada no alteren el resultado.

#### Scenario: Ejecución idempotente en la misma jornada
- **GIVEN** una corrida del job que ya procesó las recetas vencidas de la jornada
- **WHEN** el job vuelve a ejecutarse en la misma jornada
- **THEN** ninguna receta sufre modificaciones ni se generan duplicados

#### Scenario: Aislamiento de fallos entre tenants
- **GIVEN** un error en la transacción de un tenant específico durante la corrida del job
- **WHEN** el job procesa dicho tenant
- **THEN** el error queda aislado y la corrida continúa procesando los restantes tenants activos

### Requirement: RV3 — Auditoría del pase a retiro vencido por el job
Por cada receta que pase a `RETIRO_VENCIDO`, el job diario SHALL registrar un evento de auditoría con acción `CAMBIAR_ESTADO` (de `PREPARADA` a `RETIRO_VENCIDO`) a nombre del usuario SISTEMA, indicando en el contexto el plazo aplicado (`diasRetiroVencido`) y la fecha `preparada_en`.

#### Scenario: Registro de auditoría CAMBIAR_ESTADO por el job
- **GIVEN** una receta que pasa a `RETIRO_VENCIDO` por el job diario
- **WHEN** concluye la actualización de la receta
- **THEN** se registra un evento `CAMBIAR_ESTADO` a nombre del usuario SISTEMA con `diasRetiroVencido` y `preparadaEn`

### Requirement: RV4 — Condiciones de reactivación
La acción de reactivar solo SHALL permitirse sobre recetas en estado `RETIRO_VENCIDO` que no se encuentren en un lote de archivo (`lote_archivo_id` nulo). La reactivación SHALL cambiar el estado de la receta a `PREPARADA`, reiniciar la columna `preparada_en` y registrar una auditoría `CAMBIAR_ESTADO` a nombre del operador actuante.

#### Scenario: Reactivación exitosa de receta sin archivar
- **GIVEN** una receta en estado `RETIRO_VENCIDO` no archivada
- **WHEN** un operador ejecuta la acción reactivar
- **THEN** la receta retorna al estado `PREPARADA`
- **AND** la columna `preparada_en` se reinicia
- **AND** se registra una auditoría `CAMBIAR_ESTADO` con el operador actuante

#### Scenario: Rechazo de reactivación en receta archivada
- **GIVEN** una receta en estado `RETIRO_VENCIDO` que se encuentra en un lote de archivo
- **WHEN** se intenta reactivar la receta
- **THEN** la operación es rechazada con mensaje de receta archivada

#### Scenario: Rechazo de reactivación en receta que no está en retiro vencido
- **GIVEN** una receta en un estado distinto de `RETIRO_VENCIDO`
- **WHEN** se invoca la acción reactivar
- **THEN** la acción es rechazada

### Requirement: RV5 — Co-firma del DT por preparado vencido
Si al menos un preparado de la receta tiene `fecha_vencimiento` anterior a la jornada actual del tenant, la reactivación SHALL exigir en el mismo acto la co-firma de un DT vigente, quien debe seleccionar su nombre e ingresar su contraseña para ser validada en el servidor. Sin una co-firma válida, la reactivación SHALL ser rechazada. Un preparado sin `fecha_vencimiento` no SHALL considerarse vencido.

#### Scenario: Reactivación con preparado vencido y co-firma válida
- **GIVEN** una receta en `RETIRO_VENCIDO` con un preparado vencido anterior a la jornada actual
- **WHEN** un DT vigente ingresa su contraseña correcta en el bloque de co-firma y confirma
- **THEN** la receta es reactivada pasando a `PREPARADA`

#### Scenario: Rechazo por co-firma con contraseña inválida
- **GIVEN** una receta en `RETIRO_VENCIDO` con un preparado vencido
- **WHEN** se ingresa una contraseña errónea para el DT
- **THEN** la reactivación es rechazada y la receta permanece en `RETIRO_VENCIDO`

#### Scenario: Preparado sin fecha de vencimiento no exige co-firma
- **GIVEN** una receta con preparados antiguos sin `fecha_vencimiento`
- **WHEN** se reactiva la receta
- **THEN** no se considera vencido y la reactivación no exige co-firma del DT

#### Scenario: Preparado que vence en la jornada actual no se considera vencido
- **GIVEN** una receta cuyo preparado tiene `fecha_vencimiento` igual a la jornada actual
- **WHEN** se reactiva la receta en dicha jornada
- **THEN** el preparado no se considera vencido y no se exige co-firma

### Requirement: RV6 — Auditoría de co-firma e intentos fallidos
Al reactivar con co-firma, la co-firma SHALL registrarse en la auditoría de la reactivación: DT que autorizó y las fechas de vencimiento de los preparados vencidos. Un intento fallido SHALL contar como intento fallido del DT, igual que en las otras co-firmas.

#### Scenario: Auditoría de reactivación con co-firma aprobada
- **GIVEN** una reactivación exitosa con co-firma de DT
- **WHEN** se registra el evento `CAMBIAR_ESTADO`
- **THEN** la auditoría incluye `autorizadoPorId` con el DT y los vencimientos de los preparados

#### Scenario: Registro de intento fallido del DT
- **GIVEN** un intento de reactivación con contraseña incorrecta de un DT vigente
- **WHEN** falla la verificación de co-firma
- **THEN** el intento fallido cuenta como intento fallido del DT y se registra la auditoría correspondiente

### Requirement: RV7 — Archivo de recetas en retiro vencido
Una receta en estado `RETIRO_VENCIDO` SHALL poder ser archivada en un lote de archivo en las mismas condiciones que las recetas entregadas o anuladas. Una vez archivada en un lote, la receta no SHALL poder reactivarse.

#### Scenario: Inclusión de receta en retiro vencido dentro de un lote de archivo
- **GIVEN** una receta en estado `RETIRO_VENCIDO`
- **WHEN** se conforma un lote de archivo que incluye la receta
- **THEN** la receta es asignada al lote de archivo exitosamente

#### Scenario: Bloqueo permanente de reactivación tras el archivo
- **GIVEN** una receta en `RETIRO_VENCIDO` que ya fue archivada
- **WHEN** se intenta reactivar la receta
- **THEN** la acción es rechazada

### Requirement: RV8 — Anulación automática por el libro recetario
Si se anula el asiento del libro recetario correspondiente a una receta en `RETIRO_VENCIDO`, la receta SHALL pasar automáticamente a estado `ANULADA` al igual que una receta en `PREPARADA`. El estado `RETIRO_VENCIDO` no SHALL formar parte de los estados terminales de la receta.

#### Scenario: Anulación automática al anular asiento del libro
- **GIVEN** una receta en estado `RETIRO_VENCIDO` con un asiento registrado en el libro
- **WHEN** se anula dicho asiento en el libro recetario
- **THEN** la receta pasa automáticamente al estado `ANULADA`

#### Scenario: Anulación manual directa de receta en retiro vencido
- **GIVEN** una receta en estado `RETIRO_VENCIDO`
- **WHEN** un usuario habilitado solicita su anulación directa
- **THEN** la receta es anulada respetando los bloqueos correspondientes a una receta preparada

### Requirement: RV9 — Preservación de la marca de pago
El paso a `RETIRO_VENCIDO` y la reactivación a `PREPARADA` SHALL NOT modificar la marca de pago (`pagada`) de la receta. La entrega posterior a la reactivación SHALL regirse por las reglas estándar de entrega, exigiendo que la receta esté pagada si es retiro presencial.

#### Scenario: Conservación de marca de pago tras vencer y reactivar
- **GIVEN** una receta marcada como pagada que pasa a `RETIRO_VENCIDO` y posteriormente se reactiva
- **WHEN** concluye la reactivación
- **THEN** la receta conserva su marca de pagada

#### Scenario: Exigencia de pago al entregar receta reactivada
- **GIVEN** una receta reactivada que se encuentra impaga
- **WHEN** se intenta registrar su retiro presencial
- **THEN** el sistema exige que la receta sea marcada como pagada para completar la entrega

### Requirement: RV10 — Aplicación diferida de cambios al parámetro
Cambiar el parámetro `dias_retiro_vencido` no SHALL recalcular nada en el momento: la próxima corrida del job SHALL utilizar el valor nuevo. Bajar el valor puede vencer de golpe varias recetas en esa corrida; subirlo no SHALL reactivar las recetas que ya vencieron.

#### Scenario: Reducción del parámetro evaluada en la siguiente corrida
- **GIVEN** un tenant que reduce el valor de `dias_retiro_vencido` de 30 a 15
- **WHEN** se ejecuta la siguiente corrida del job
- **THEN** las recetas que hayan alcanzado los 15 días o más de espera pueden vencer de golpe en dicha corrida

#### Scenario: Incremento del parámetro no reactiva recetas vencidas
- **GIVEN** recetas que ya se encuentran en `RETIRO_VENCIDO` y un tenant que aumenta el parámetro
- **WHEN** se ejecuta la siguiente corrida del job
- **THEN** las recetas que ya vencieron no son reactivadas

### Requirement: Permiso para editar parámetro de retiro
La modificación del parámetro `dias_retiro_vencido` SHALL requerir el permiso `config.editar` y solo SHALL ser accesible para usuarios con rol ADMINISTRADOR.

#### Scenario: Modificación del parámetro por un usuario con permiso
- **GIVEN** un usuario con rol ADMINISTRADOR y permiso `config.editar`
- **WHEN** modifica el parámetro `dias_retiro_vencido`
- **THEN** el cambio se registra exitosamente

#### Scenario: Rechazo a usuarios sin permiso config.editar
- **GIVEN** un usuario que no cuenta con el permiso `config.editar`
- **WHEN** intenta modificar el parámetro de retiro
- **THEN** la acción es rechazada por falta de autorización

### Requirement: Permiso y operador para reactivar
La acción de reactivar una receta en `RETIRO_VENCIDO` SHALL requerir el permiso `entregas.registrar`. En sesiones sobre cuentas de sector, la acción SHALL requerir la identificación del operador (`conOperador`).

#### Scenario: Reactivación por usuario con permiso entregas.registrar
- **GIVEN** un usuario con permiso `entregas.registrar` en una receta en `RETIRO_VENCIDO`
- **WHEN** ejecuta la reactivación
- **THEN** la acción se autoriza

#### Scenario: Solicitud de operador en cuenta de sector
- **GIVEN** una sesión que opera bajo una cuenta de sector
- **WHEN** se intenta reactivar la receta
- **THEN** la acción solicita la identificación del operador mediante PIN

#### Scenario: Rechazo a usuarios sin permiso entregas.registrar
- **GIVEN** un usuario sin permiso `entregas.registrar`
- **WHEN** intenta reactivar la receta
- **THEN** la acción es rechazada por falta de autorización

### Requirement: Condición de DT vigente para co-firma
La autorización de reactivación de una receta con preparados vencidos SHALL requerir la condición de Director Técnico vigente mediante co-firma con contraseña personal, no pudiendo suplirse mediante permisos del operador.

#### Scenario: Co-firma realizada por Director Técnico vigente
- **GIVEN** una receta con preparado vencido
- **WHEN** un Director Técnico vigente ingresa su contraseña en la co-firma
- **THEN** la autorización es aceptada

#### Scenario: Rechazo si el usuario seleccionado no es DT vigente
- **GIVEN** un usuario que no tiene rol de Director Técnico vigente
- **WHEN** se intenta utilizar sus credenciales para autorizar el preparado vencido
- **THEN** la co-firma es rechazada

### Requirement: Autenticación del job diario
La ejecución del job diario de retiros vencidos SHALL autenticarse mediante `CRON_SECRET` y SHALL operar actuando con la identidad del usuario SISTEMA de cada tenant.

#### Scenario: Ejecución autorizada del job con CRON_SECRET
- **GIVEN** una petición al endpoint del job que incluye la cabecera con `CRON_SECRET`
- **WHEN** se procesa la solicitud
- **THEN** el job se ejecuta con la identidad del usuario SISTEMA del tenant

#### Scenario: Rechazo de ejecución sin secreto válido
- **GIVEN** una petición sin la cabecera `CRON_SECRET` o con un secreto incorrecto
- **WHEN** se recibe la solicitud
- **THEN** la ejecución es rechazada

### Requirement: Etiqueta y tono visual del estado
En todas las pantallas de la aplicación, el estado `RETIRO_VENCIDO` SHALL presentarse con la etiqueta "Retiro vencido" y con un indicador visual (badge) en tono de advertencia (`warn`).

#### Scenario: Presentación visual del estado y badge warn
- **GIVEN** una receta en estado `RETIRO_VENCIDO`
- **WHEN** se visualiza en listados, detalle, trayectoria, reportes o exportaciones
- **THEN** se muestra la etiqueta "Retiro vencido" con badge en tono warn

### Requirement: Filtro de estado en el listado de entregas
El listado de `/entregas` SHALL mostrar por defecto recetas en estado `PREPARADA` y `ENVIADA_PEND_FIRMA`. El filtro de estado de la página SHALL incluir la opción "Retiro vencido" para permitir listar las recetas vencidas cuando el paciente se presente.

#### Scenario: Listado por defecto sin recetas con retiro vencido
- **GIVEN** el listado principal de `/entregas` sin filtros aplicados
- **WHEN** se cargan las entregas
- **THEN** solo se muestran recetas en `PREPARADA` y `ENVIADA_PEND_FIRMA`

#### Scenario: Filtrado explícito por estado Retiro vencido
- **GIVEN** el listado de `/entregas`
- **WHEN** el usuario selecciona "Retiro vencido" en el filtro de estado
- **THEN** se listan las recetas en `RETIRO_VENCIDO`

### Requirement: Modal de entrega para receta en retiro vencido
Al abrir el modal de entrega (`/entregas/[recetaId]`) de una receta en `RETIRO_VENCIDO`, el sistema SHALL mostrar la fecha en que venció el plazo y el botón "Reactivar". Si algún preparado está vencido, SHALL mostrar un aviso en rojo y el formulario de co-firma del DT obligatorio. Si la receta está archivada, SHALL mostrar el texto informativo de archivo sin botón. Tras una reactivación exitosa, el modal SHALL continuar abierto mostrando el formulario habitual de entrega.

#### Scenario: Modal de entrega con receta sin preparados vencidos
- **GIVEN** una receta en `RETIRO_VENCIDO` sin preparados vencidos
- **WHEN** se abre el modal de entrega
- **THEN** se muestra el texto del plazo vencido y el botón "Reactivar" sin requerir co-firma

#### Scenario: Modal de entrega con preparado vencido y co-firma obligatoria
- **GIVEN** una receta en `RETIRO_VENCIDO` con un preparado vencido
- **WHEN** se abre el modal de entrega
- **THEN** se muestra el aviso en rojo de preparado vencido y el bloque de co-firma del DT obligatorio

#### Scenario: Modal de entrega con receta archivada
- **GIVEN** una receta en `RETIRO_VENCIDO` archivada en un lote
- **WHEN** se abre el modal de entrega
- **THEN** se muestra el texto "Archivada en el lote …" y no se muestra el botón "Reactivar"

#### Scenario: Modal tras reactivación exitosa
- **GIVEN** un modal de entrega donde se confirma exitosamente la reactivación
- **WHEN** la revalidación actualiza la receta a `PREPARADA`
- **THEN** el modal permanece abierto mostrando el formulario habitual de entrega de una receta preparada

### Requirement: Acceso a reactivar desde el detalle de la receta
En la página de detalle `/recetas/[id]`, cuando la receta esté en `RETIRO_VENCIDO`, el sistema SHALL mostrar el panel "Retiro vencido" con acceso a reactivar (que abre el modal de entrega), siempre que el usuario cuente con permiso `entregas.registrar` y la receta no esté archivada.

#### Scenario: Panel Retiro vencido con acceso a reactivar
- **GIVEN** una receta en `RETIRO_VENCIDO` no archivada y un usuario con permiso `entregas.registrar`
- **WHEN** accede a `/recetas/[id]`
- **THEN** se muestra el panel "Retiro vencido" con el acceso "Reactivar" que abre el modal de entrega

#### Scenario: Ocultamiento de la acción cuando la receta está archivada
- **GIVEN** una receta en `RETIRO_VENCIDO` que ha sido archivada
- **WHEN** el usuario accede al detalle en `/recetas/[id]`
- **THEN** el acceso a reactivar no se ofrece

### Requirement: Múltiples preparados y vencimientos dispares
En una receta con varios ítems preparados, si al menos uno de ellos tiene `fecha_vencimiento` anterior a la jornada actual del tenant, el sistema SHALL exigir la co-firma del DT y el aviso en la interfaz SHALL listar individualmente cada preparado vencido.

#### Scenario: Receta con ítems vigentes y un ítem vencido
- **GIVEN** una receta con varios preparados donde solo uno tiene fecha anterior a la jornada actual
- **WHEN** se visualiza el formulario de reactivación
- **THEN** se exige la co-firma del DT y el aviso en rojo lista el preparado que se encuentra vencido

### Requirement: Co-firma obligatoria cuando el operador es DT vigente
Si el operador que ejecuta la reactivación es un Director Técnico vigente, el sistema SHALL requerir igualmente el ingreso de su contraseña en el bloque de co-firma para autorizar la reactivación con preparados vencidos.

#### Scenario: Operador que a la vez es Director Técnico vigente
- **GIVEN** un operador autenticado que es Director Técnico vigente
- **WHEN** reactiva una receta con preparados vencidos
- **THEN** debe ingresar su propia contraseña en el bloque de co-firma

### Requirement: Recuperación ante omisión de corrida del job
Si el job diario no se ejecuta en una jornada determinada, la siguiente corrida del job SHALL evaluar la fecha actual y procesar todas las recetas cuyo plazo de días de jornada se encuentre cumplido a esa fecha.

#### Scenario: Corrida posterior a fallo o suspensión del job
- **GIVEN** un día en que el job diario no se ejecutó
- **WHEN** se ejecuta la siguiente corrida del job
- **THEN** se identifican y vencen todas las recetas cuyo plazo se cumplió a la fecha actual

## Estado

> Estado: **implementado 2026-10-20 (migraciones 0094-0095)**; los seis cortes están hechos (ver "Código que lo implementa"). Reversión: `docs/rollbacks/retiro-vencido.md`.
> Decisiones del usuario (2026-10-20):
> - Una receta **Preparada** que nadie retira pasa sola a un estado nuevo, **`RETIRO_VENCIDO`**, después de N días.
> - N es un parámetro por farmacia: **30 días por defecto**, editable por el administrador.
> - Es **reversible**: si la persona aparece, se **reactiva** (vuelve a Preparada) y se entrega como siempre.
> - Si el preparado **ya venció** (fecha de la etiqueta), reactivar no se recomienda: exige la **autorización del DT**, que es quien puede confirmarlo.
> - Una receta en Retiro vencido **se puede archivar** en un lote (M15). Archivada, ya no se reactiva.

## Alcance

Hoy una receta Preparada que nadie viene a buscar queda Preparada para siempre: ensucia `/entregas` y los contadores de recetas en curso. Esta funcionalidad agrega:

1. Un estado nuevo `RETIRO_VENCIDO` (etiqueta "Retiro vencido").
2. El parámetro **"Días para el retiro"** (`dias_retiro_vencido`) en Administración → Configuración → Parámetros.
3. Un **job diario** que pasa a Retiro vencido las recetas Preparadas cuyo plazo se cumplió.
4. La acción **"Reactivar"**, con co-firma del DT cuando el preparado está vencido.
5. Archivo de las recetas en Retiro vencido.

**Fuera de alcance (a propósito).**
- No se mueve stock: los insumos ya egresaron al confirmar la preparación, y el preparado físico no es stock. Qué hacer con el frasco (descarte, etc.) es un procedimiento manual de la farmacia.
- No se avisa al paciente (ni mail, ni WhatsApp).
- No se toca el pago: la marca Pagada/Impaga queda como estaba y se sigue pudiendo cambiar.
- No aplica a `ENVIADA_PEND_FIRMA`: esa receta ya salió de la farmacia; lo que falta es la firma, no el retiro.
- No es la "vigencia" de la receta (un mes desde la prescripción, solo valida al crearla) ni el vencimiento del preparado o de las partidas. Son tres conceptos distintos; por eso el estado se llama Retiro vencido y no "Vencida".

## Modelo

### Estado nuevo

`fsj.estado_receta` suma el valor `RETIRO_VENCIDO`. Transiciones nuevas en la lista blanca de INV-R08 (`fsj.receta_validar_transicion_estado`, última definición en 0086):

| Desde | Hacia | Quién |
|---|---|---|
| `PREPARADA` | `RETIRO_VENCIDO` | El job diario (usuario SISTEMA). |
| `RETIRO_VENCIDO` | `PREPARADA` | "Reactivar". |
| `RETIRO_VENCIDO` | `ANULADA` | Las mismas vías que desde `PREPARADA`: la anulación directa (con sus bloqueos actuales) y la automática por el libro. |

`RETIRO_VENCIDO` **no** es un estado terminal (se puede reactivar), pero **no cuenta como receta en curso**: sale de los contadores de "activas" del inicio y de la trayectoria del paciente, y de `/entregas` salvo que se filtre por él.

### `fsj.receta.preparada_en` (columna nueva)

`timestamptz NULL`: cuándo la receta llegó a `PREPARADA` por última vez. Hoy no existe ese dato.

- Lo escribe un trigger `BEFORE UPDATE OF estado` cada vez que la receta **entra** a `PREPARADA` (desde `EN_PREPARACION`, al anular una entrega o al reactivar). Así el reloj se reinicia en cada caso, sin depender de la aplicación.
- Backfill de las recetas que hoy están en `PREPARADA`: la última `preparacion.confirmada_en` de la receta; si no hay, la fecha de la migración.

### Parámetro `dias_retiro_vencido`

En `fsj.parametro` (tipo `NUMERO`), siguiendo el patrón de `meses_vencimiento_preparado` (0068):

- Entero entre **0 y 365**. Por defecto **30**.
- **0 = desactivado**: ninguna receta pasa a Retiro vencido.
- Seed para los tenants existentes en la migración (`ON CONFLICT DO NOTHING`) y para los nuevos en `scripts/create-tenant.ts`.
- Lectura con fallback al valor por defecto si falta la fila.

## Reglas

| # | Regla | Dónde se hace cumplir |
|---|---|---|
| RV1 | Una receta pasa a `RETIRO_VENCIDO` cuando está en `PREPARADA` y pasaron **N días de jornada** (zona horaria del tenant) desde `preparada_en`: preparada el día D, vence en la primera corrida del día D + N. Con N = 0 no vence nunca. | Job `vencer-retiros` (dominio puro para el cálculo); INV-R08 permite la transición. |
| RV2 | El job corre **una vez por día**, recorre todos los tenants activos, aísla el error de cada uno y es **idempotente** (correrlo dos veces el mismo día no cambia nada). Mismo patrón que `/api/jobs/plazos-archivo`: `CRON_SECRET`, usuario SISTEMA del tenant, auditoría. | `app/api/jobs/retiros-vencidos/route.ts`, `modules/entregas/application/vencer-retiros.ts`, `vercel.json`. |
| RV3 | Cada receta vencida deja un registro `CAMBIAR_ESTADO` (PREPARADA → RETIRO_VENCIDO) a nombre del usuario SISTEMA, con el plazo aplicado (`diasRetiroVencido`) y `preparada_en`. | Job. |
| RV4 | **Reactivar** solo se puede desde `RETIRO_VENCIDO` y con la receta **sin archivar** (`lote_archivo_id` nulo). Devuelve la receta a `PREPARADA`, reinicia el reloj (`preparada_en`) y queda auditado (`CAMBIAR_ESTADO`, con el operador). | `modules/entregas/application/reactivar-receta.ts` (lock de receta como `registrarEntrega`); INV-R08; trigger de `preparada_en`. |
| RV5 | Si **algún** preparado de la receta está vencido (`preparacion.fecha_vencimiento` anterior a la jornada actual del tenant), reactivar **exige la co-firma de un DT vigente en el mismo acto**: el DT elige su nombre e ingresa su propia contraseña, que se verifica en el servidor antes de escribir. Sin co-firma válida, no se reactiva. Un preparado sin `fecha_vencimiento` (datos viejos) no se considera vencido. | `reactivar-receta.ts` + el patrón de co-firma (`shared/ui/co-firma-dt.tsx`, `verificar-co-firma-dt` como en stock y libro). |
| RV6 | La co-firma queda en la auditoría de la reactivación: DT que autorizó, y las fechas de vencimiento de los preparados vencidos. Un intento fallido cuenta como intento fallido del DT, igual que en las otras co-firmas. | `reactivar-receta.ts`. |
| RV7 | Una receta en `RETIRO_VENCIDO` se puede **archivar** en un lote, como `ENTREGADA` y `ANULADA`. Archivada, ya no se puede reactivar (RV4). | INV-ARC-006 (`fsj.receta_validar_archivo`, 0016) y las piezas de `modules/archivo` que hoy filtran `ENTREGADA`/`ANULADA`. |
| RV8 | Si se anula el asiento del libro de una receta en `RETIRO_VENCIDO`, la receta se anula sola, igual que hoy pasa con una `PREPARADA` (el preparado nunca salió de la farmacia). | `receta-coupling-repository.ts` (`RETIRO_VENCIDO` **no** entra en `ESTADOS_TERMINALES_RECETA`). |
| RV9 | El pago no cambia con el vencimiento ni con la reactivación. Entregar después de reactivar sigue las reglas de siempre (un retiro exige la receta pagada). | Sin cambios en `pago.ts` / `registrar-entrega.ts`. |
| RV10 | Cambiar el parámetro no recalcula nada en el momento: la próxima corrida del job usa el valor nuevo. Bajarlo puede vencer de golpe varias recetas en esa corrida; subirlo **no** reactiva las que ya vencieron. | Job. |

## Permisos

| Acción | Permiso |
|---|---|
| Editar "Días para el retiro" | `config.editar` (como el resto de los parámetros; solo ADMINISTRADOR). |
| Reactivar | `entregas.registrar` (es parte del flujo del mostrador). Está en `PERMISOS_CON_PIN_CONFIGURABLES`: la Server Action va en `conOperador`. |
| Autorizar un preparado vencido | Ser **DT vigente** (co-firma con su contraseña), no un permiso del operador. |
| Job diario | `CRON_SECRET`; actúa como el usuario SISTEMA de cada tenant. |

## Auditoría

| Hecho | Registro |
|---|---|
| El job vence una receta | `CAMBIAR_ESTADO` sobre la receta, usuario SISTEMA, con `diasRetiroVencido` y `preparadaEn`. |
| Reactivar | `CAMBIAR_ESTADO` sobre la receta (RETIRO_VENCIDO → PREPARADA), con el operador y, si hubo, el DT de la co-firma y los vencimientos de los preparados. |
| Co-firma fallida | Lo mismo que hoy registran las co-firmas fallidas de stock y libro. |
| Cambio del parámetro | El `MODIFICAR` que ya escribe `editarParametro`. |

## Pantallas

- **Estado en toda la app:** etiqueta "Retiro vencido" y badge en tono de advertencia (`warn`) en `StatusBadge`, listados, detalle de receta, trayectoria del paciente, reportes y exportaciones.
- **`/recetas`:** el filtro y el resumen por estado incluyen "Retiro vencido" (salen de `ESTADOS_RECETA`).
- **`/entregas`:** el listado por defecto sigue mostrando Preparada y Pendiente de firma. El filtro de estado suma **"Retiro vencido"**, para que el mostrador encuentre la receta cuando la persona aparece.
- **Modal de entrega** (`/entregas/[recetaId]`) en `RETIRO_VENCIDO`:
  - Texto: "El plazo de retiro venció el dd/mm/aaaa (N días desde que quedó preparada)".
  - Botón **"Reactivar"**. Si algún preparado está vencido, un aviso en rojo ("El preparado venció el dd/mm/aaaa: no se recomienda entregarlo") y el bloque de **co-firma del DT** obligatorio en el mismo formulario.
  - Con la receta archivada: sin botón, con el texto "Archivada en el lote …".
  - Después de reactivar, el modal muestra la entrega normal de una Preparada.
- **Detalle de receta** (`/recetas/[id]`): en `RETIRO_VENCIDO`, un acceso "Reactivar" que abre el mismo modal de entrega (si tiene `entregas.registrar`).
- **Parámetros** (`/admin/configuracion/parametros`): la clave nueva aparece sola. Ajustar el texto introductorio de la página, que hoy habla solo de pesaje.

## Casos borde

- **Primera corrida después del deploy:** las recetas que hoy llevan más de N días en Preparada (según el backfill de `preparada_en`) vencen todas juntas en esa corrida. Es el comportamiento buscado; conviene avisarle a la farmacia.
- **Anular una entrega** devuelve la receta a Preparada y **reinicia** el reloj (el trigger de `preparada_en`): la persona tiene otros N días.
- **Reactivar** también reinicia el reloj: si tampoco viene esta vez, vuelve a vencer N días después.
- **Receta con varios ítems y vencimientos distintos:** alcanza con que uno esté vencido para exigir la co-firma (RV5); el aviso lista cada preparado vencido.
- **El operador es DT vigente:** igual ingresa su propia contraseña en la co-firma (mismo criterio que stock y libro).
- **El job falla un día:** la corrida siguiente vence lo pendiente (la regla mira la fecha, no "ayer"). No se pierde nada.
- **Anular una receta en Retiro vencido:** mismas reglas y bloqueos que una Preparada (hoy se bloquea si tiene un asiento en efecto; la salida es anular el asiento).

## Plan de implementación (cortes)

Cada corte es un commit revisable. Las migraciones se aplican antes de desplegar el código que las usa.

1. **Migraciones.** Dos, porque un valor de enum nuevo no se puede usar en la misma transacción que lo crea:
   - **0094 `estado_retiro_vencido`:** `ALTER TYPE fsj.estado_receta ADD VALUE IF NOT EXISTS 'RETIRO_VENCIDO'`.
   - **0095 `retiro_vencido`:** columna `receta.preparada_en` + backfill + trigger; INV-R08 redefinida con las transiciones nuevas; INV-ARC-006 acepta `RETIRO_VENCIDO`; seed del parámetro `dias_retiro_vencido` = 30.
   - Rollbacks: quitar un valor de un enum exige recrear el tipo (como 0061). El `.down.sql` se niega a correr si hay recetas en `RETIRO_VENCIDO`; la reversión pasa primero esas recetas a `PREPARADA` (paso documentado en `docs/rollbacks/retiro-vencido.md`). Modelo Prisma y `npm run db:generate`.
2. **Estado en el dominio y la UI:** `ESTADOS_RECETA`, etiqueta (`shared/labels/enum-labels.ts`), tono del badge, "en curso" (inicio, trayectoria, recurrentes), filtro de `/entregas`, reportes. Tests de paridad del enum.
3. **Parámetro:** `PARAMETROS_REGISTRY` (`dias_retiro_vencido`, 0..365, default 30), lectura con fallback, `scripts/create-tenant.ts`, texto de la página de parámetros. Tests de validación.
4. **Job diario:** dominio puro del vencimiento (RV1, con tests de bordes de jornada y zona horaria), caso de uso multi-tenant (RV2, RV3), route `app/api/jobs/retiros-vencidos`, entrada en `vercel.json`, `docs/deploy.md`. Verificar el límite de crons del plan de Vercel; si no admite otro, se encadena desde la ruta del job existente.
5. **Reactivar:** comando con lock, RV4–RV6, co-firma del DT reutilizando el patrón de stock y libro (en el diseño, evaluar mover la verificación a un lugar compartido en vez de una tercera copia), Server Action con `conOperador`, UI en el modal de entrega y acceso desde el detalle de receta.
6. **Archivo y libro:** `modules/archivo` acepta `RETIRO_VENCIDO` (RV7); confirmar RV8 en el acoplamiento del libro; actualizar `openspec/specs/libro-recetario-y-contralor/spec.md` y la doc de archivo con una línea.

## Código que lo implementa

Los seis cortes están implementados (migraciones **sin aplicar**: 0094 y 0095 se aplican antes de desplegar este código).

**Corte 1 — migraciones.**
- `prisma/migrations/20261020130000_0094_estado_retiro_vencido/migration.sql` (solo el valor del enum) y `prisma/migrations/20261020130100_0095_retiro_vencido/migration.sql` (`receta.preparada_en` + backfill + trigger `trg_receta_preparada_en`, INV-R08 e INV-ARC-006 redefinidas, seed del parámetro).
- Rollbacks: `prisma/rollbacks/0095_retiro_vencido.down.sql`, `prisma/rollbacks/0094_estado_retiro_vencido.down.sql` (recrea el tipo como 0061, incluido el trigger INV-R14 de 0076; se niega si hay recetas en `RETIRO_VENCIDO`), `docs/rollbacks/retiro-vencido.md`.
- `prisma/schema.prisma`: valor `RETIRO_VENCIDO` y `Receta.preparadaEn`.
- `preparada_en` no tiene permiso de UPDATE para `fsj_app`: solo lo escribe el trigger (un trigger `BEFORE` que asigna a `NEW` no pasa por los permisos de columna). El trigger cubre `UPDATE OF estado`; ninguna ruta inserta una receta directamente en `PREPARADA`.

**Corte 2 — estado en dominio y UI.**
- `modules/recetas/domain/receta.ts`: `RETIRO_VENCIDO` en `EstadoReceta` / `ESTADOS_RECETA`; nuevo `esRecetaEnCurso` (no `ENTREGADA`, `ANULADA` ni `RETIRO_VENCIDO`). `esEstadoTerminal` y `puedeAnular` no cambian: `RETIRO_VENCIDO` no es terminal y se puede anular.
- "En curso" / "activas" usan `esRecetaEnCurso`: inicio (`app/(app)/page.tsx`, contador `activas` y orden secundario de las pestañas), `/recetas` (`app/(app)/recetas/page.tsx`), `/reportes/recetas`, `calcularResumen` de la trayectoria (`modules/pacientes/domain/trayectoria.ts`). Siguen con `esEstadoTerminal` (a propósito): `modules/recetas/domain/anulacion.ts` (la anulación sigue permitida), el aviso "no admite más cambios" del detalle de receta.
- Trayectoria: el paso Entrega de una receta en `RETIRO_VENCIDO` queda `PENDIENTE` (puede reactivarse y entregarse; no `NO_APLICA` ni `SIN_EFECTO`).
- Recurrentes (`modules/pacientes/domain/recurrentes.ts`): `RETIRO_VENCIDO` **sigue contando**, igual que `PREPARADA` (solo `ANULADA` se omite).
- Etiqueta y tono: `shared/labels/enum-labels.ts` ("Retiro vencido"), `shared/ui/status-badge.tsx` (`warn`).
- `/entregas`: `modules/entregas/domain/entrega.ts` (`ESTADOS_FILTRO_ENTREGAS`, `estadoFiltroEntregas`) alimenta el zod de `list-entregas-pendientes.ts`, `buscar-entregas-action.ts` y `app/(app)/entregas/page.tsx`. El listado por defecto sigue siendo `PREPARADA` + `ENVIADA_PEND_FIRMA` (`ESTADOS_LISTADO_ENTREGAS` del repositorio no cambia). `entregas-buscador.tsx`: botón "Ver" y contador "con retiro vencido" para ese estado. `entrega-acciones.tsx`: en `RETIRO_VENCIDO` muestra "El plazo de retiro venció." sin acciones (el corte 5 agrega "Reactivar" en esa misma rama).
- El acoplamiento del libro (`ESTADOS_TERMINALES_RECETA` en `receta-coupling-repository.ts`) **no** incluye `RETIRO_VENCIDO` (RV8). `modules/archivo` queda para el corte 6.

**Corte 3 — parámetro.**
- `modules/parametros/domain/parametros-registry.ts`: `dias_retiro_vencido` ("Días para el retiro", entero 0..365, por defecto 30, 0 desactiva).
- `modules/entregas/domain/retiro-vencido.ts` (`DIAS_RETIRO_VENCIDO_DEFAULT/MAX`, `parseDiasRetiroVencido`, `retiroVencidoDesactivado`) y `getDiasRetiroVencido` en `modules/entregas/infrastructure/entrega-repository.ts` (copia propia, como `getMesesVencimientoPreparado`).
- `scripts/create-tenant.ts` (seed) y texto de `app/(app)/admin/configuracion/parametros/page.tsx`.

**Corte 4 — job diario.**
- `modules/entregas/domain/retiro-vencido.ts`: `sumarDiasAJornada`, `instanteCorteRetiroVencido(jornadaActual, dias, zona)` (el corte que usa el job: `preparada_en < inicio de la jornada J - N + 1`, `null` con N = 0) y `esRetiroVencido` (la misma regla por receta, definida sobre jornadas; los tests comprueban que ambas coinciden en cada borde).
- `modules/entregas/infrastructure/retiro-vencido-repository.ts`: `lockRecetasPreparadasVencidas` (`FOR UPDATE SKIP LOCKED`, `ORDER BY id`), `marcarRetiroVencido` (UPDATE guardado por `estado = 'PREPARADA'` + un `CAMBIAR_ESTADO` por receta, a nombre de SISTEMA, con `diasRetiroVencido` y `preparadaEn` en el contexto), y copias propias de `listActiveTenantIds` / `getSistemaUsuarioId`.
- `modules/entregas/application/vencer-retiros.ts` (`runVencerRetirosJob`, una transacción por tenant, error aislado por tenant, tenant con N = 0 salteado sin tocar nada; excepción en `eslint.config.mjs` como la del job de plazos), `app/api/jobs/retiros-vencidos/route.ts` (misma autenticación que `plazos-archivo`), `vercel.json` (`10 6 * * *`) y `docs/deploy.md` (sección del job; límite de crons: 100 por proyecto en todos los planes).
- "Hoy" es la jornada del tenant según la base (`fsj.jornada_actual`), convertida a instante de corte en TypeScript con `inicioDeJornada` (zona del tenant). Una receta que alguien está operando (lock tomado) se saltea y vence en la corrida siguiente.

**Corte 5 — reactivar.**
- Dominio (`modules/entregas/domain/retiro-vencido.ts`): `puedeReactivar` / `validarReactivar` (RV4, con los mensajes "La receta no está en retiro vencido." y "La receta ya está archivada: no se puede reactivar."), `preparadosVencidos` (RV5: `fecha_vencimiento` anterior a la jornada actual; sin fecha = no vencido), `jornadaVencimientoRetiro` (`jornada(preparada_en) + N`, lo que el modal muestra como "venció el …") y `camposFaltantesCoFirma`.
- Comando `modules/entregas/application/reactivar-receta.ts` (`entregas.reactivar`, permiso `entregas.registrar`): toma el lock de la receta con `lockRecetaParaAccion`, el mismo de `registrarEntrega`, antes de leer; exige RETIRO_VENCIDO y sin archivar; lee los preparados CONFIRMADA (`getPreparadosConVencimiento`) y la jornada actual del tenant; con algún vencido exige `dtUsuarioId` + `dtPassword` (error en esos campos si faltan) y verifica la co-firma; pasa la receta a PREPARADA (el trigger de 0095 reinicia `preparada_en`) y audita `CAMBIAR_ESTADO` a nombre del operador, con `autorizadoPorId` = el DT y `valorNuevo.preparadosVencidos` (RV6). INV-R08 se traduce al mensaje de archivada. Una co-firma que sobra (sin preparados vencidos) no se verifica ni se registra.
- Co-firma: **no hay tercera copia**. El comando corre `verificarCoFirmaDtEnTx` de `modules/stock/application/verificar-co-firma-dt.ts` (exportada para este fin, como ya hace `modules/preparaciones`) dentro de su misma transacción. Un rechazo se devuelve como resultado normal (`ok: false`, mensaje genérico) y la transacción **confirma**, así el intento fallido del DT y su auditoría persisten y nada más se escribió; `reactivarReceta` lo convierte en un `DomainError` con ese mensaje sobre el campo `dtPassword`. Por eso el comando declara `audit: { skip: true }` y escribe él mismo el `CAMBIAR_ESTADO`, solo si tuvo éxito.
- Consulta `getEntregaEstado` (`entregas.estado.ver`): suma `retiroVencido` (solo en RETIRO_VENCIDO): `vencioEl`, `diasRetiroVencido`, `archivada` + `loteNumero`, `preparadosVencidos`, los DT vigentes (`listDtParaCoFirmaEnTx` de stock) y `operadorEsDt`. Lecturas nuevas en `entrega-repository.ts`: `getRetiroVencidoDeReceta`, `getPreparadosConVencimiento`.
- Server Action `reactivarRecetaAction` (`modules/entregas/ui/actions.ts`, dentro de `conOperador`; revalida `/entregas`, `/entregas/{id}` y `/recetas/{id}`).
- UI: `modules/entregas/ui/reactivar-form.tsx` (texto del plazo, aviso en rojo por preparado vencido, `CoFirmaDt` obligatorio) y la rama RETIRO_VENCIDO de `entrega-acciones.tsx` (archivada: "Archivada en el lote Nro X: no se puede reactivar.", sin botón; sin `entregas.registrar`: solo el texto). Tras reactivar, la revalidación cambia el estado de la receta y el modal **sigue abierto** mostrando el formulario normal de una Preparada (no se cierra, a diferencia de las otras acciones de entrega). Las páginas `app/(app)/entregas/[recetaId]/page.tsx` y `app/(app)/@modal/(.)entregas/[recetaId]/page.tsx` pasan `retiroVencido`.
- Detalle de receta (`app/(app)/recetas/[id]/page.tsx`): panel "Retiro vencido" con el acceso "Reactivar" a `/entregas/{id}` (navegación suave: abre el modal), con `entregas.registrar` y la receta sin archivar.
- `shared/labels/field-labels.ts`: `dtPassword`, `preparadosVencidos`.

**Corte 6 — archivo y libro.**
- `modules/archivo`: `RETIRO_VENCIDO` entra en `EstadoRecetaArchivable` y `esRecetaElegibleParaArchivo` (`domain/lote-archivo.ts`), en el tipo de `conformar-lote.ts`, en los tres filtros SQL de `archivo-repository.ts` (conteo y listado de elegibles, `recheckRecetasElegibles`), en el mensaje de INV-ARC-006 (`domain/mensajes-invariantes.ts`) y en el texto de `/archivo` y `/archivo/nuevo`. No existe un spec propio de archivo: la regla de elegibilidad vive en esos comentarios y en la nota de 2026-10-01 del plan.
- Libro (RV8) confirmado sin cambios de código: `ESTADOS_TERMINALES_RECETA` no incluye `RETIRO_VENCIDO`. Test en `tests/unit/libro-receta-coupling.test.ts` y línea en `openspec/specs/libro-recetario-y-contralor/spec.md`.

**Tests.** `tests/unit/retiro-vencido.test.ts` (incluye las reglas de reactivar), `tests/unit/entregas-reactivar.test.ts` (comando: no RETIRO_VENCIDO, archivada, sin vencidos, vencido sin co-firma / con contraseña mala / con DT válido, auditoría; y `getEntregaEstado`), la entrada `entregas.reactivar` en `tests/unit/entregas-authorization-matrix.test.ts`, `tests/unit/retiros-vencidos-job.test.ts` (caso de uso, repositorio, ruta), `archivo-lote.test.ts`, `libro-receta-coupling.test.ts` y casos nuevos en `parametros-validacion.test.ts`, `recetas-validacion.test.ts` y `pacientes-trayectoria.test.ts`; la paridad del enum la cubre `enum-labels.test.ts`.

**Desvíos respecto del texto de arriba.**
- INV-R08 (0095) agrega a `RETIRO_VENCIDO → PREPARADA` una guarda en la base: se rechaza si la receta ya está en un lote de archivo (defensa en profundidad de RV4/RV7, igual que 0086 para la anulación de entrega). `RETIRO_VENCIDO → ANULADA` queda cubierta por la regla general de anulación.
- El rollback de 0095 también se niega si hay recetas en `RETIRO_VENCIDO`, no solo el de 0094.
- En `/entregas` el valor vacío del filtro de estado se llama "Pendientes" (antes "Todos"), porque ya no incluye todos los estados que el filtro puede elegir.
- "Venció el dd/mm/aaaa (N días …)" usa el `dias_retiro_vencido` **vigente hoy** (RV10: el parámetro no se recalcula hacia atrás); con el parámetro en 0 el modal dice solo "El plazo de retiro venció.".
- El acceso "Reactivar" del detalle de receta no se muestra si la receta está archivada (el modal solo diría que no se puede).
- La co-firma se verifica dentro de la transacción del comando en vez de en una transacción previa como la del ajuste de stock: si hace falta o no depende de los preparados leídos con la receta bloqueada.

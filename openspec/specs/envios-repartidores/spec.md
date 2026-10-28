# Envíos con repartidor y hoja de envíos del repartidor (PDF)

## Purpose

Los repartidores constituyen un catálogo propio de la farmacia para asignar a cada envío un repartidor responsable y emitir una hoja de ruta en PDF con los envíos pendientes del repartidor, indicando domicilio, paciente y estado del pago. Si una receta a enviar no tiene domicilio, quien registra la entrega lo ingresa en el modal y se guarda en la receta. Asimismo, el repartidor de un envío pendiente de firma puede cambiarse cuando sea necesario (decisión del usuario, 2026-10-20, actualizada 2026-10-23).

## Requirements

### Requirement: E1 — Asignación obligatoria de un repartidor en envíos
El registro de una entrega bajo la modalidad envío (`ENVIO`) SHALL requerir la asignación de un único repartidor. El sistema SHALL impedir la confirmación del envío si no se ha seleccionado un repartidor.

#### Scenario: Registro exitoso de envío con repartidor
- **GIVEN** una receta en estado `PREPARADA` con domicilio disponible
- **WHEN** el usuario selecciona modalidad envío y elige un repartidor activo
- **THEN** la entrega se registra exitosamente asignando dicho repartidor

#### Scenario: Rechazo de envío sin repartidor
- **GIVEN** una receta en estado `PREPARADA`
- **WHEN** se intenta registrar una entrega bajo modalidad envío sin especificar un repartidor
- **THEN** el sistema rechaza la operación exigiendo la selección de un repartidor

### Requirement: E2 — Prohibición de repartidor en retiros presenciales
Una entrega bajo modalidad de retiro presencial no SHALL registrar un repartidor. Si la solicitud de registro de retiro presencial incluye un identificador de repartidor, el sistema SHALL rechazar la operación.

#### Scenario: Registro de retiro presencial sin repartidor
- **GIVEN** una receta en estado `PREPARADA` pagada
- **WHEN** se registra la entrega bajo modalidad retiro presencial sin repartidor
- **THEN** la entrega se registra exitosamente

#### Scenario: Rechazo de retiro presencial que envía repartidor
- **GIVEN** una receta en estado `PREPARADA`
- **WHEN** se intenta registrar un retiro presencial adjuntando un identificador de repartidor
- **THEN** el sistema rechaza la solicitud por incompatibilidad con la modalidad

### Requirement: E3 — Requisito de repartidor activo del mismo tenant
Al registrar un envío o cambiar de repartidor, el repartidor asignado SHALL ser un repartidor activo perteneciente al mismo tenant. La desactivación posterior de un repartidor en el catálogo no SHALL removerlo de los envíos que ya tenga previamente asignados.

#### Scenario: Asignación de repartidor activo del tenant
- **GIVEN** un repartidor activo perteneciente al tenant de la sesión
- **WHEN** se lo asigna a un nuevo envío
- **THEN** la asignación es aceptada

#### Scenario: Rechazo de repartidor inactivo para nueva asignación
- **GIVEN** un repartidor que se encuentra en estado inactivo
- **WHEN** se intenta asignarlo al registrar un envío
- **THEN** el sistema rechaza la asignación

#### Scenario: Rechazo de repartidor de otro tenant
- **GIVEN** un repartidor existente en otro tenant
- **WHEN** se intenta utilizar su identificador en el tenant actual
- **THEN** la operación es rechazada por no encontrarse en el tenant

### Requirement: E4 — Exigencia de domicilio al registrar envío
Un envío SHALL exigir que la receta cuente con `domicilio_paciente` no vacío al momento de registrarlo. Como una receta solo es editable en `PENDIENTE_PREPARACION` y el envío se registra desde `PREPARADA`, la opción "Envío" en el modal de entrega no SHALL deshabilitarse por falta de domicilio.

#### Scenario: Modal de entrega permite elegir Envío sin domicilio previo
- **GIVEN** una receta en estado `PREPARADA` que carece de domicilio
- **WHEN** el usuario abre el modal de entrega
- **THEN** la opción de modalidad "Envío" permanece habilitada para su selección

#### Scenario: Envío confirmado con domicilio presente
- **GIVEN** una receta en `PREPARADA` que cuenta con domicilio
- **WHEN** se registra el envío con un repartidor asignado
- **THEN** la entrega se completa exitosamente

### Requirement: E4 — Carga de domicilio en receta sin domicilio previo
Si la receta no tiene domicilio, la sección Envío del modal SHALL mostrar el campo obligatorio "Domicilio de entrega" y `registrarEntrega` SHALL guardarlo en `receta.domicilio_paciente` (solo esa columna) dentro de la misma transacción antes de insertar la entrega, con la normalización de la receta (trim, máx. 300, vacío = no cargado). Sin domicilio en la receta y sin domicilio escrito, la acción SHALL rechazarse con error sobre el campo `domicilio` ("Ingrese el domicilio de entrega.").

#### Scenario: Carga exitosa de domicilio al confirmar envío
- **GIVEN** una receta en `PREPARADA` sin domicilio registrado
- **WHEN** se registra el envío ingresando un domicilio válido en el campo correspondiente
- **THEN** el domicilio se guarda en `receta.domicilio_paciente` (solo esa columna) dentro de la misma transacción

#### Scenario: Rechazo por omisión de domicilio en receta sin domicilio
- **GIVEN** una receta en `PREPARADA` sin domicilio previo
- **WHEN** se intenta confirmar el envío dejando vacío el campo "Domicilio de entrega"
- **THEN** la operación se rechaza con el mensaje "Ingrese el domicilio de entrega." sobre el campo `domicilio`

### Requirement: E4 — Protección de domicilio existente y rechazo en retiro presencial
Si la receta ya tiene domicilio, el modal SHALL mostrarlo de solo lectura y no enviar el campo; si se recibe un `domicilio` recibido para una receta que ya lo poseía, la solicitud igual SHALL ser rechazada con `ValidationError` sobre `domicilio`. Asimismo, un retiro presencial con `domicilio` recibido SHALL ser rechazado.

#### Scenario: Domicilio existente mostrado como solo lectura
- **GIVEN** una receta que ya posee domicilio registrado
- **WHEN** se visualiza la sección de envío en el modal de entrega
- **THEN** el domicilio se exhibe de solo lectura y no se envía en el formulario

#### Scenario: Rechazo si se envía domicilio para receta que ya lo posee
- **GIVEN** una receta con domicilio previamente registrado
- **WHEN** se envía una petición de entrega incluyendo un valor para el campo domicilio
- **THEN** la solicitud es rechazada con `ValidationError` sobre el campo `domicilio`

#### Scenario: Rechazo si se envía domicilio en retiro presencial
- **GIVEN** una solicitud de entrega bajo modalidad retiro presencial
- **WHEN** la petición incluye un valor en el campo domicilio
- **THEN** la operación es rechazada

### Requirement: E5 — Cambio de repartidor en envío pendiente de firma
El repartidor de un envío solo SHALL poder cambiarse mientras la receta se encuentre en estado `ENVIADA_PEND_FIRMA`. El nuevo repartidor SHALL ser un repartidor activo del mismo tenant (cumpliendo la regla E3). La acción no SHALL permitir quitar el repartidor dejando el envío sin asignación.

#### Scenario: Cambio exitoso de repartidor en envío pendiente de firma
- **GIVEN** una receta en estado `ENVIADA_PEND_FIRMA` con un repartidor asignado
- **WHEN** el usuario ejecuta el cambio seleccionando otro repartidor activo del tenant
- **THEN** el nuevo repartidor queda registrado en la entrega

#### Scenario: Rechazo de cambio de repartidor en receta en otro estado
- **GIVEN** una receta en un estado distinto de `ENVIADA_PEND_FIRMA`
- **WHEN** se intenta cambiar el repartidor de la entrega
- **THEN** la acción es rechazada

#### Scenario: Rechazo de selección del mismo repartidor actual
- **GIVEN** un envío con un repartidor asignado
- **WHEN** se intenta cambiar seleccionando exactamente al mismo repartidor
- **THEN** la operación es rechazada evitando registrar un cambio redundante

### Requirement: E6 — Repartidor en anulación de entrega
Al anular una entrega bajo modalidad envío, el identificador del repartidor asignado SHALL preservarse en la columna `repartidor_id` de `fsj.entrega_anulada`. Si la receta vuelve a entregarse posteriormente, el repartidor SHALL seleccionarse nuevamente.

#### Scenario: Preservación de repartidor al anular entrega
- **GIVEN** una entrega bajo modalidad envío con repartidor asignado
- **WHEN** la entrega es anulada
- **THEN** la fila insertada en `fsj.entrega_anulada` conserva el identificador del repartidor

#### Scenario: Nueva selección de repartidor tras anulación
- **GIVEN** una receta devuelta a `PREPARADA` por anulación de su envío previo
- **WHEN** se procede a registrar un nuevo envío
- **THEN** el sistema exige seleccionar el repartidor nuevamente

### Requirement: E7 — Envíos históricos sin repartidor
Los envíos registrados con anterioridad a la incorporación de repartidores (con `repartidor_id` nulo) SHALL permanecer válidos, permitiendo asignarles un repartidor mediante la regla E5. Mientras no posean repartidor asignado, dichos envíos no SHALL incluirse en la hoja de envíos PDF y el modal de entrega SHALL indicar "Sin repartidor asignado".

#### Scenario: Visualización y asignación en envío histórico
- **GIVEN** un envío histórico pendiente de firma sin `repartidor_id`
- **WHEN** se abre el modal de entrega
- **THEN** se muestra el texto "Sin repartidor asignado" con el botón "Asignar repartidor"
- **AND** dicho envío no se incluye en la hoja de envíos PDF

### Requirement: E8 — Envíos incluidos en la hoja PDF
La hoja de envíos en PDF solo SHALL incluir las entregas correspondientes al repartidor seleccionado cuyas recetas se encuentren en estado `ENVIADA_PEND_FIRMA` (habiendo salido de la farmacia y con firma pendiente de recepción).

#### Scenario: Inclusión exclusiva de recetas enviadas pendientes de firma
- **GIVEN** entregas asignadas a un repartidor en diversos estados
- **WHEN** se genera la hoja de envíos PDF para dicho repartidor
- **THEN** solo se listan aquellas recetas en estado `ENVIADA_PEND_FIRMA`

#### Scenario: Exclusión de recetas con firma ya confirmada
- **GIVEN** un envío cuyo retorno de firma ya fue confirmado
- **WHEN** se emite la hoja de envíos del repartidor
- **THEN** el envío completado no aparece en el documento

### Requirement: E9 — Filtro de fecha de envío en la hoja PDF
La exportación de la hoja de envíos SHALL filtrar por la fecha de envío (`entrega.entregada_en`), convirtiendo el valor a día calendario según la zona horaria del tenant. El filtro de fecha SHALL precargarse por defecto con la jornada actual ("hoy"). Si el campo de fecha se deja vacío, la hoja SHALL incluir todos los envíos pendientes de firma del repartidor independientemente de su fecha.

#### Scenario: Filtro por defecto en la jornada actual
- **GIVEN** el diálogo de exportación de hoja de envíos
- **WHEN** se abre el diálogo
- **THEN** el campo de fecha de envío aparece precargado con la jornada actual

#### Scenario: Exportación con filtro de fecha vacío
- **GIVEN** un repartidor con envíos de distintas fechas pendientes de firma
- **WHEN** se exporta la hoja limpiando el campo de fecha
- **THEN** la hoja incluye todos los envíos pendientes del repartidor

### Requirement: E10 — Visualización del importe condicionado al permiso
La columna de importe en la hoja de envíos PDF (calculada como la suma de `precio_final` de la última cotización de cada ítem) solo SHALL incluirse si el usuario que genera la exportación cuenta con el permiso `cotizaciones.ver`. Si el usuario carece de dicho permiso, la columna no SHALL figurar en el documento.

#### Scenario: Emisión de PDF por usuario con permiso cotizaciones.ver
- **GIVEN** un usuario que posee el permiso `cotizaciones.ver`
- **WHEN** genera la hoja de envíos PDF
- **THEN** el documento incluye la columna Importe con el precio correspondiente

#### Scenario: Emisión de PDF por usuario sin permiso cotizaciones.ver
- **GIVEN** un usuario sin el permiso `cotizaciones.ver`
- **WHEN** genera la hoja de envíos PDF
- **THEN** el documento no contiene la columna de importe

### Requirement: E11 — Parámetros en la URL del PDF
La solicitud HTTP de generación del PDF a través de su URL solo SHALL recibir los parámetros `repartidorId` y `fecha`. Ningún dato identificatorio o personal del paciente SHALL transmitirse a través de los parámetros de la URL (DP-24).

#### Scenario: Parámetros autorizados en la URL de descarga
- **GIVEN** la acción de descarga o visualización del PDF de envíos
- **WHEN** el cliente realiza la petición GET al endpoint `/api/entregas/envios/pdf`
- **THEN** la URL solo contiene los query parameters `repartidorId` y `fecha`
- **AND** no incluye ningún dato del paciente

### Requirement: Catálogo y atributos de repartidores
El sistema SHALL gestionar un catálogo de repartidores por tenant en `fsj.repartidor`, con campos obligatorios `nombre` y `apellido` (texto no vacío de hasta 100 caracteres), `telefono` (texto no vacío de hasta 30 caracteres) y estado `activo` (booleano, por defecto verdadero). Los repartidores no SHALL eliminarse físicamente de la base de datos, gestionándose únicamente su activación o desactivación.

#### Scenario: Alta de repartidor con datos válidos
- **GIVEN** los datos de nombre, apellido y teléfono dentro de los límites requeridos
- **WHEN** se crea un nuevo repartidor
- **THEN** el repartidor se registra en `fsj.repartidor` con `activo` en verdadero

#### Scenario: Desactivación de repartidor sin borrado físico
- **GIVEN** un repartidor existente en el catálogo
- **WHEN** se desactiva el repartidor
- **THEN** su campo `activo` pasa a falso y la fila permanece en la base de datos

### Requirement: Restricciones de base de datos para repartidor en entregas
La tabla `fsj.entrega` SHALL exigir que un retiro presencial no tenga repartidor (`repartidor_id IS NULL`). Para toda nueva entrega de modalidad `ENVIO` o actualización de su repartidor, el sistema SHALL exigir mediante el trigger INV-ENT-005 que `repartidor_id` sea no nulo.

#### Scenario: Cumplimiento de CHECK en retiro presencial
- **GIVEN** una inserción de entrega con modalidad `RETIRO_PRESENCIAL`
- **WHEN** se persiste en `fsj.entrega`
- **THEN** la base de datos valida que `repartidor_id` sea `NULL`

#### Scenario: Cumplimiento de INV-ENT-005 en envío nuevo
- **GIVEN** una nueva entrega con modalidad `ENVIO`
- **WHEN** se intenta insertar sin `repartidor_id`
- **THEN** el trigger INV-ENT-005 rechaza la operación

### Requirement: Permiso para gestionar repartidores
Las operaciones de alta, edición, activación y desactivación de repartidores en el catálogo SHALL requerir el permiso `repartidores.gestionar`.

#### Scenario: Gestión autorizada de repartidores
- **GIVEN** un usuario con el permiso `repartidores.gestionar`
- **WHEN** accede a crear o editar un repartidor en `/catalogos/repartidores`
- **THEN** la acción es autorizada

#### Scenario: Rechazo por carecer de repartidores.gestionar
- **GIVEN** un usuario sin el permiso `repartidores.gestionar`
- **WHEN** intenta modificar o crear un repartidor
- **THEN** el sistema deniega el acceso

### Requirement: Permiso y operador para registrar o cambiar repartidor
La selección de un repartidor al registrar un envío o su posterior modificación SHALL requerir el permiso `entregas.registrar`. En una cuenta de sector con PIN configurado, la acción de cambiar repartidor SHALL requerir la identificación del operador (`conOperador`).

#### Scenario: Cambio de repartidor con permiso entregas.registrar
- **GIVEN** un usuario con permiso `entregas.registrar`
- **WHEN** cambia el repartidor de un envío pendiente
- **THEN** la operación se autoriza

#### Scenario: Identificación de operador en cuenta de sector
- **GIVEN** una sesión en cuenta de sector con PIN
- **WHEN** se ejecuta el cambio de repartidor
- **THEN** la acción requiere la validación del PIN del operador

### Requirement: Permiso para exportar hoja de envíos
La exportación de la hoja de envíos en PDF SHALL requerir el permiso `entregas.registrar`. La inclusión de los importes en dicha hoja SHALL requerir adicionalmente el permiso `cotizaciones.ver`.

#### Scenario: Exportación por usuario autorizado en entregas
- **GIVEN** un usuario con el permiso `entregas.registrar`
- **WHEN** solicita la exportación de la hoja de envíos
- **THEN** la generación del PDF es autorizada

#### Scenario: Rechazo de exportación sin permiso entregas.registrar
- **GIVEN** un usuario sin el permiso `entregas.registrar`
- **WHEN** intenta solicitar la generación del PDF
- **THEN** la petición es rechazada

### Requirement: Permisos para búsqueda de repartidores
La consulta y búsqueda de repartidores en componentes autocomplete SHALL estar autorizada para usuarios que cuenten con el permiso `entregas.registrar` o con el permiso `repartidores.gestionar`.

#### Scenario: Búsqueda autorizada para entregas
- **GIVEN** un usuario con permiso `entregas.registrar` pero sin `repartidores.gestionar`
- **WHEN** busca repartidores en el selector del modal de entrega
- **THEN** la consulta devuelve la lista de repartidores coincidentes

#### Scenario: Búsqueda autorizada para administración
- **GIVEN** un usuario con permiso `repartidores.gestionar`
- **WHEN** realiza una búsqueda de repartidores
- **THEN** la consulta devuelve los resultados correspondientes

### Requirement: Auditoría en el catálogo de repartidores
Toda operación de alta, modificación, activación o desactivación de un repartidor en el catálogo SHALL registrar un evento de auditoría con acción `CREAR` o `MODIFICAR` sobre la entidad `repartidor`, consignando los valores anteriores y nuevos.

#### Scenario: Registro de auditoría al crear repartidor
- **GIVEN** la creación exitosa de un repartidor
- **WHEN** se completa la operación
- **THEN** se registra una auditoría `CREAR` sobre la entidad `repartidor` con sus datos iniciales

#### Scenario: Registro de auditoría al cambiar estado activo
- **GIVEN** la activación o desactivación de un repartidor
- **WHEN** se ejecuta el cambio
- **THEN** se registra una auditoría `MODIFICAR` sobre `repartidor` con el valor de `activo` anterior y nuevo

### Requirement: Auditoría al registrar envío
Al registrar un envío, el evento de auditoría `CAMBIAR_ESTADO` de la entrega SHALL incluir `repartidorId` en el nuevo valor. Si se ingresó un nuevo domicilio para la receta, el sistema SHALL registrar previamente una auditoría `MODIFICAR` sobre la entidad `receta` con origen `entrega` registrando el domicilio anterior y el nuevo.

#### Scenario: Auditoría de entrega con repartidor
- **GIVEN** el registro de un envío con repartidor asignado
- **WHEN** se registra la entrega
- **THEN** el evento `CAMBIAR_ESTADO` incluye `repartidorId` en el valor nuevo

#### Scenario: Auditoría de nuevo domicilio en receta al enviar
- **GIVEN** una receta sin domicilio cuyo domicilio se ingresa al registrar el envío
- **WHEN** se confirma la entrega
- **THEN** se registra una auditoría `MODIFICAR` sobre `receta` con origen `entrega` antes del cambio de estado

### Requirement: Auditoría al cambiar repartidor
La modificación del repartidor asignado a un envío pendiente de firma SHALL registrar un evento de auditoría con acción `MODIFICAR` sobre la entidad `entrega`, consignando los identificadores de repartidor anterior y nuevo.

#### Scenario: Registro de auditoría por cambio de repartidor
- **GIVEN** un envío pendiente donde se sustituye el repartidor asignado
- **WHEN** se confirma el cambio
- **THEN** se registra una auditoría `MODIFICAR` sobre `entrega` con `repartidorId` anterior y nuevo

### Requirement: Pantalla del catálogo de repartidores
La interfaz en `/catalogos/repartidores` SHALL proveer un listado con nombre, apellido, teléfono y estado activo/inactivo, con búsqueda por texto y filtro por estado. El alta y la edición de repartidores SHALL utilizar un mismo formulario compartido, permitiendo además activar o desactivar cada repartidor.

#### Scenario: Visualización del listado y formulario compartido
- **GIVEN** un usuario en `/catalogos/repartidores`
- **WHEN** visualiza la página o abre el alta y edición
- **THEN** se presentan el listado con filtros y el formulario unificado de alta y edición

### Requirement: Selección de repartidor en el modal de entrega
Al elegir modalidad "Envío" en el modal de entrega (`/entregas/[recetaId]`), el sistema SHALL mostrar un autocomplete (`Combobox`) con repartidores activos ("Apellido, Nombre · teléfono"). Sin activos, SHALL mostrar el aviso "No hay repartidores cargados" (con enlace al catálogo con `repartidores.gestionar`). "Registrar" SHALL quedar deshabilitado mientras no tenga repartidor o (receta sin domicilio) el campo de domicilio esté vacío. Ante un error, texto y selección SHALL conservarse.

#### Scenario: Selector de repartidores activos disponible
- **GIVEN** un modal de entrega con modalidad "Envío" seleccionada
- **WHEN** el usuario interactúa con el campo Repartidor
- **THEN** el autocomplete muestra los repartidores activos con apellido, nombre y teléfono

#### Scenario: Aviso ante ausencia de repartidores activos
- **GIVEN** un tenant sin ningún repartidor activo registrado
- **WHEN** se selecciona la modalidad Envío
- **THEN** se muestra el aviso "No hay repartidores cargados" y el registro queda inhabilitado

#### Scenario: Botón registrar deshabilitado sin domicilio
- **GIVEN** una receta sin domicilio en el modal de entrega con repartidor seleccionado
- **WHEN** el campo "Domicilio de entrega" está vacío
- **THEN** el botón "Registrar" permanece deshabilitado

#### Scenario: Conservación de datos ante error de formulario
- **GIVEN** un formulario de entrega con repartidor seleccionado y domicilio ingresado
- **WHEN** ocurre un error al enviar el formulario
- **THEN** se conserva el texto ingresado y la selección del repartidor

### Requirement: Visualización y cambio de repartidor en envíos pendientes
Para una receta en estado `ENVIADA_PEND_FIRMA`, el modal de entrega SHALL mostrar el domicilio de entrega y el repartidor asignado con su teléfono, junto con la acción "Cambiar repartidor". Si se trata de un envío histórico sin repartidor asignado, el modal SHALL indicar "Sin repartidor asignado" y ofrecer la acción "Asignar repartidor".

#### Scenario: Detalle de envío pendiente con repartidor
- **GIVEN** una receta en `ENVIADA_PEND_FIRMA` con repartidor asignado
- **WHEN** se abre el modal de entrega
- **THEN** se muestran domicilio, nombre y teléfono del repartidor y el botón "Cambiar repartidor"

#### Scenario: Detalle de envío pendiente histórico
- **GIVEN** una receta en `ENVIADA_PEND_FIRMA` de un envío histórico sin repartidor
- **WHEN** se abre el modal de entrega
- **THEN** se muestra el texto "Sin repartidor asignado" y el botón "Asignar repartidor"

### Requirement: Diálogo de exportación de envíos en entregas
En la página `/entregas`, el sistema SHALL proveer la acción "Exportar envíos" que abre un diálogo para seleccionar obligatoriamente un repartidor (listando activos e inactivos, indicando "(inactivo)" en estos últimos) y una fecha de envío opcional precargada con la jornada actual ("hoy").

#### Scenario: Diálogo de exportación con repartidores y fecha
- **GIVEN** la página `/entregas`
- **WHEN** el usuario pulsa en "Exportar envíos"
- **THEN** se despliega el diálogo solicitando el repartidor y mostrando la fecha de hoy precargada

### Requirement: Formato y encabezado de la hoja de envíos en PDF
La hoja de envíos generada en PDF SHALL formatearse en orientación A4 apaisada. El encabezado del documento SHALL incluir el nombre y teléfonos de la farmacia, el título "Hoja de envíos", el apellido, nombre y teléfono del repartidor seleccionado, el filtro de fecha aplicado (o la indicación "Todos los pendientes"), la fecha y hora de generación y el usuario emisor.

#### Scenario: Generación del encabezado en PDF
- **GIVEN** la exportación de envíos de un repartidor
- **WHEN** se genera el documento PDF
- **THEN** se imprime en A4 apaisado con el encabezado completo de farmacia, repartidor, filtros y fecha de emisión

### Requirement: Filas y columnas de la hoja de envíos en PDF
La tabla de la hoja de envíos SHALL ordenar las filas por fecha de entrega y número de receta. Cada fila SHALL incluir: número de receta, fecha y hora enviada, paciente y DNI, teléfono, domicilio, cantidad de preparados entregables, estado de pago ("Pagada" o destacando "IMPAGA — cobrar"), importe (con `cotizaciones.ver`) y celda en blanco para firma de recepción. El pie de página SHALL indicar número de hoja, total de envíos y cantidad de envíos impagos.

#### Scenario: Formato de filas con receta impaga destacada
- **GIVEN** un envío impago en la hoja del repartidor
- **WHEN** se dibuja la fila correspondiente en la tabla
- **THEN** la columna de pago muestra "IMPAGA — cobrar" destacado y se provee celda en blanco para la firma

#### Scenario: Orden de los envíos en la tabla
- **GIVEN** múltiples envíos pendientes para el repartidor
- **WHEN** se genera la tabla del PDF
- **THEN** los envíos aparecen ordenados por fecha y hora de entrega (`entregada_en`) y por número interno de receta

### Requirement: Hoja de envíos sin resultados y nombre de archivo
Si el repartidor no registra envíos pendientes para el filtro seleccionado, el PDF SHALL generarse con su encabezado y la leyenda "Este repartidor no tiene envíos pendientes para este filtro". El nombre del archivo descargado SHALL seguir el formato `envios-<apellido>-<fecha|pendientes>.pdf` sin incorporar datos del paciente.

#### Scenario: Repartidor sin envíos para la fecha
- **GIVEN** un repartidor seleccionado que no posee envíos pendientes en la fecha elegida
- **WHEN** se genera el PDF
- **THEN** se muestra el mensaje informativo de sin envíos pendientes manteniendo el encabezado

#### Scenario: Nombre del archivo descargado
- **GIVEN** la exportación de envíos para un repartidor de apellido Gómez y fecha 2026-10-20
- **WHEN** se descarga el documento
- **THEN** el archivo se nombra `envios-gomez-2026-10-20.pdf`

### Requirement: Repartidor desactivado con envíos pendientes
Un repartidor que sea desactivado en el catálogo no SHALL aparecer disponible para nuevas asignaciones, pero SHALL continuar asignado a los envíos pendientes que ya poseía y su hoja de envíos SHALL poder ser exportada normalmente.

#### Scenario: Exportación de hoja de repartidor desactivado
- **GIVEN** un repartidor inactivo que conserva envíos pendientes asignados
- **WHEN** se genera su hoja de envíos desde el diálogo
- **THEN** el PDF se emite correctamente listando sus envíos pendientes

### Requirement: Concurrencia en registro y cambio de repartidor
Las operaciones de registro de envío y de cambio de repartidor SHALL serializarse mediante el bloqueo exclusivo (lock) de la receta dentro de su transacción, impidiendo modificaciones simultáneas incompatibles sobre la asignación del repartidor.

#### Scenario: Intentos concurrentes de modificación de entrega
- **GIVEN** dos solicitudes simultáneas de asignación o cambio de repartidor sobre la misma receta
- **WHEN** ambas intentan procesarse concurrentemente
- **THEN** el lock a nivel de transacción serializa las operaciones garantizando consistencia

### Requirement: Datos vigentes en la generación del PDF
La generación de la hoja de envíos en PDF SHALL utilizar los datos vigentes del repartidor (como el teléfono) y el domicilio vigente de la receta al momento de la emisión, sin requerir congelamiento histórico de dichos valores.

#### Scenario: Emisión tras actualización de teléfono de repartidor
- **GIVEN** un repartidor cuyo teléfono fue modificado tras registrarse los envíos
- **WHEN** se genera la hoja de envíos en PDF
- **THEN** el encabezado del documento refleja el número de teléfono vigente del repartidor

## Estado

> Estado: **implementado 2026-10-20 (migración 0093)**. Reversión: `docs/rollbacks/envios-repartidores.md`.
> Decisiones del usuario (2026-10-20, revisadas el mismo día):
> - Los repartidores son un **catálogo propio** (no son usuarios del sistema, no se loguean).
> - Un envío lleva **un solo** repartidor, elegido con un autocomplete que muestra nombre, apellido y teléfono.
> - El domicilio de entrega es **el de la receta** (`receta.domicilio_paciente`). Si la receta no lo tiene, quien registra el envío lo escribe en el modal y se guarda en la receta (decisión del 2026-10-20, ver E4).
> - **Actualizado (2026-10-23, migración 0099, `openspec/specs/domicilios/spec.md`):** el envío va a `receta.domicilio_entrega` o, si está vacío, a `receta.domicilio_paciente` (`domicilioDeEnvio`). Lo que se escribe en el modal se guarda en `receta.domicilio_entrega`; `domicilio_paciente` ya no se toca desde una entrega. Donde abajo dice `domicilio_paciente` como destino del envío, léase ese domicilio efectivo.
> - El repartidor de un envío pendiente de firma **se puede cambiar**.
> - "Exportar envíos" genera el PDF **de un repartidor**: los envíos pendientes que tiene asignados, para dárselo y que sepa a dónde ir. Filtros: repartidor (obligatorio) y fecha de envío (por defecto hoy; vacía = todos sus pendientes).

## Alcance

Hoy "Envío" (`ModalidadEntrega.ENVIO`) solo mueve la receta a `ENVIADA_PEND_FIRMA`: no registra quién lleva el preparado ni a dónde. Esta funcionalidad agrega:

1. **Catálogo de repartidores** (alta, edición, activar/desactivar) en Catálogos → Repartidores.
2. **Asignación del repartidor** al registrar un envío, desde el modal de `/entregas/[recetaId]`.
3. **Cambio de repartidor** de un envío ya registrado mientras espera la firma.
4. **Exportar envíos**: PDF imprimible con los envíos de un repartidor, con domicilio, paciente y estado del pago.

**Fuera de alcance (a propósito).** Varios repartidores por envío, un PDF con todos los repartidores juntos, orden de visita o zonas, costo del envío, liquidación a repartidores, seguimiento en tiempo real, firma digital del receptor. Un "Retiro presencial" no lleva repartidor. No se cambia la máquina de estados ni DP-34.

## Modelo

### `fsj.repartidor` (nueva, tabla de tenant vía `fsj.setup_tenant_table`, como `etiqueta_tamano` en 0066)

| Columna | Significado |
|---|---|
| `id` | `uuid` PK. `UNIQUE (tenant_id, id)` para las FK compuestas. |
| `tenant_id` | Tenant (RLS + `forbid_tenant_id_change`). |
| `nombre`, `apellido` | `text NOT NULL`, no vacíos (check `btrim(...) <> ''`), máx. 100. |
| `telefono` | `text NOT NULL`, no vacío, máx. 30, texto libre (sin formato forzado). |
| `activo` | `boolean NOT NULL DEFAULT true`. Desactivar ≠ borrar: no hay DELETE. |
| `creado_en`, `creado_por_id` | Alta (FK compuesta a `usuario`). |

Grants a `fsj_app`: `SELECT, INSERT`, y `UPDATE (nombre, apellido, telefono, activo)`.

### `fsj.entrega.repartidor_id` (columna nueva)

`uuid NULL`, FK compuesta `(tenant_id, repartidor_id)` → `repartidor`. Índice `(tenant_id, repartidor_id)` para el PDF.

- `CHECK (modalidad = 'ENVIO' OR repartidor_id IS NULL)`: un retiro nunca tiene repartidor. Vale para todas las filas existentes, así que se agrega validado.
- **INV-ENT-005** (trigger `BEFORE INSERT OR UPDATE OF repartidor_id`): un `ENVIO` exige `repartidor_id` no nulo. Va como trigger y no como CHECK a propósito: los envíos anteriores a esta funcionalidad tienen `NULL`, y un CHECK fallaría en cualquier UPDATE de esas filas (por ejemplo, al confirmar la firma). El trigger solo mira inserts nuevos y cambios de repartidor.
- Grant: se suma `repartidor_id` al `UPDATE` por columnas de `fsj_app` (hoy solo `firma_recibida`, `firma_recibida_en`).

### `fsj.entrega_anulada.repartidor_id` (columna nueva)

`uuid NULL`, sin FK (es historial, como las demás columnas de la tabla). `moverEntregaAAnuladas` la copia junto con las demás.

### Domicilio

No hay columna nueva. El domicilio del envío es `receta.domicilio_paciente` en el momento de imprimir.

## Reglas

| # | Regla | Dónde se hace cumplir |
|---|---|---|
| E1 | Un envío (`ENVIO`) se registra con **un** repartidor; sin repartidor no se puede confirmar. | `registrarEntregaInput` (zod `superRefine`), `domain/entrega.ts`; DB: INV-ENT-005. |
| E2 | Un retiro presencial **no** lleva repartidor; si llega uno, se rechaza. | zod; DB: CHECK de `entrega`. |
| E3 | Solo se puede **asignar** un repartidor **activo** del mismo tenant. Desactivarlo no lo saca de los envíos que ya tiene. | `registrar-entrega.ts` / `cambiar-repartidor.ts` (lectura en la misma tx); tenant por FK compuesta + RLS. |
| E4 | Un envío exige que la receta tenga `domicilio_paciente` no vacío **al momento de registrarlo**. Una receta solo es editable en `PENDIENTE_PREPARACION` (`esEstadoEditable`) y el envío se registra desde `PREPARADA`, así que no se puede mandar a la receta a editar. **Decisión del usuario (2026-10-20):** si la receta **no** tiene domicilio, la sección Envío del modal muestra el campo obligatorio "Domicilio de entrega" y `registrarEntrega` lo guarda en `receta.domicilio_paciente` (solo esa columna), dentro de la misma transacción y **antes** de insertar la entrega, con la misma normalización que el formulario de la receta (trim, máx. 300, vacío = no cargado). Sin domicilio en la receta y sin domicilio escrito: error sobre el campo `domicilio` ("Ingrese el domicilio de entrega."). Si la receta **ya** tiene domicilio, el modal lo muestra de solo lectura, no envía el campo, y un `domicilio` recibido igual se **rechaza** con `ValidationError` sobre `domicilio` (decisión de seguridad: el valor de la receta nunca se pisa desde acá; para corregirlo hay que anular la entrega o editar la receta donde sea editable). Un retiro presencial con `domicilio` también se rechaza (zod). La opción "Envío" ya no se deshabilita por falta de domicilio. | `registrar-entrega.ts` (zod `domicilio`, `resolverDomicilioParaEnvio` en `domain/entrega.ts`, `actualizarDomicilioReceta` en el repo); `registrar-entrega-form.tsx`. DB: sin cambios (ver abajo). |
| E5 | El repartidor se puede **cambiar** solo mientras la receta está en `ENVIADA_PEND_FIRMA`, y el nuevo cumple E3. No se puede quitar (dejar el envío sin repartidor). | `cambiar-repartidor.ts` (mismo lock de receta que `registrarEntrega`); DB: INV-ENT-005. |
| E6 | Al anular una entrega, su repartidor queda en `entrega_anulada.repartidor_id`. Si la receta se vuelve a entregar, se elige de nuevo. | `entrega-repository.ts:moverEntregaAAnuladas`; actualizar `openspec/specs/anular-entrega/spec.md`. |
| E7 | Los envíos registrados **antes** de esta funcionalidad no tienen repartidor: siguen válidos y se les puede asignar uno con E5. Mientras no lo tengan, no salen en ningún PDF; el modal muestra "Sin repartidor asignado". | Migración (sin backfill); E8. |
| E8 | El PDF incluye solo envíos del repartidor elegido y con la receta en `ENVIADA_PEND_FIRMA` (salió y no volvió la firma). | `list-envios-de-repartidor` (repo nuevo). |
| E9 | Filtro **fecha de envío** (`entrega.entregada_en`, pasada a día con la misma regla que los filtros de fecha existentes): por defecto **hoy**; vacía = todos sus pendientes. Por defecto hoy porque un envío de días anteriores casi seguro ya se entregó y solo falta confirmar la firma: no tiene que volver a la hoja del repartidor. | Diálogo + query. |
| E10 | El importe (suma de `precio_final` de la última cotización de cada ítem, como en el listado) aparece en el PDF **solo** si quien exporta tiene `cotizaciones.ver`; si no, la columna no existe. | `imprimir-envios-pdf.ts`. |
| E11 | Ningún dato del paciente viaja en la URL del PDF: solo `repartidorId` y `fecha` (DP-24). | `app/api/entregas/envios/pdf/route.ts`. |

## Permisos

| Acción | Permiso |
|---|---|
| ABM de repartidores | **`repartidores.gestionar`** (nuevo, categoría `gestion`: llega solo a ADMINISTRADOR; a los demás roles se lo da el editor de roles). |
| Elegir repartidor al registrar un envío | `entregas.registrar` (ya existente; la acción ya corre en `conOperador`). |
| Cambiar el repartidor de un envío | `entregas.registrar`. Ese permiso está en `PERMISOS_CON_PIN_CONFIGURABLES`, así que la Server Action nueva va envuelta en `conOperador`. |
| Exportar envíos (PDF) | `entregas.registrar` (es quien ve `/entregas`). Columna de importe: además `cotizaciones.ver` (E10). |
| Buscar repartidores en los autocompletes | `entregas.registrar` o `repartidores.gestionar`. |

Alta del permiso según `openspec/specs/roles-personalizables/spec.md` (catálogo `PERMISO_CATALOGO` + insert en `fsj.permiso` en la migración).

## Auditoría

| Hecho | Registro |
|---|---|
| Alta / edición / activar / desactivar repartidor | `CREAR` / `MODIFICAR` sobre `repartidor`, con valor anterior y nuevo. |
| Registrar envío | El `CAMBIAR_ESTADO` actual de la entrega suma `repartidorId` al valor nuevo. |
| Registrar envío de una receta sin domicilio (E4) | Un `MODIFICAR` sobre la **receta** (`contexto.origen = "entrega"`) con `domicilioPaciente` anterior y nuevo, como el `MODIFICAR` de "Pagada" que ya escribe `registrarEntrega`. Solo cuando se escribió un domicilio. |
| Cambiar repartidor | `MODIFICAR` sobre la entrega, con `repartidorId` anterior y nuevo. |
| Exportar envíos | **No se audita** (decisión del corte 6). Las impresiones existentes no son uniformes: `etiquetas.imprimir` (PDF con datos de pacientes tras un route handler) no deja registro, y `cierres.imprimir` audita porque además escribe la marca "impreso". Auditar esta exportación exigiría un `defineCommand` bajo `entregas.registrar`, que está en `PERMISOS_CON_PIN_CONFIGURABLES`: en una cuenta de sector con el PIN activo, `resolverActor` pediría un operador que un `GET` nunca trae y el PDF dejaría de salir. El listado `/entregas` ya muestra los mismos datos sin auditoría. Si se quisiera auditar, haría falta un permiso propio fuera de la lista de PIN. |

## Pantallas

### Catálogos → Repartidores (`/catalogos/repartidores`)

- Listado (nombre, apellido, teléfono, activo) con búsqueda por texto y filtro activo/inactivo.
- Alta y edición con un **mismo** formulario (convención "Edit offers what the alta offers").
- Botón activar/desactivar.
- Entrada nueva en `catalogosSections` (`app/(app)/nav-sections.ts`).
- Plantilla: `modules/medicos`, simplificada con `activo` como `etiqueta-tamanos`.

### Modal de entrega (`/entregas/[recetaId]` y su pop-up)

- **Registrar** (receta `PREPARADA`): al elegir "Envío" aparecen:
  - El domicilio de la receta (solo lectura), para que quien registra lo confirme de un vistazo. **Si la receta no tiene domicilio**, en su lugar un campo de texto obligatorio "Domicilio de entrega" (`name="domicilio"`); se guarda en la receta al registrar (E4). Se conserva el texto ante un error.
  - **Repartidor**: `Combobox` (`shared/ui/combobox.tsx`) sobre una Server Action de búsqueda de repartidores **activos**. Cada opción muestra "Apellido, Nombre · teléfono". Obligatorio para habilitar "Registrar".
  - Si no hay repartidores activos: aviso "No hay repartidores cargados", con link a Catálogos → Repartidores si tiene `repartidores.gestionar`.
  - "Registrar" queda deshabilitado mientras el envío no tenga repartidor o (receta sin domicilio) el campo de domicilio esté vacío.
  - Ante un error, la selección se conserva (`useFormSubmit`).
- **Pendiente de firma** (`ENVIADA_PEND_FIRMA`): muestra el domicilio y el repartidor asignado (nombre, apellido, teléfono), y un botón **"Cambiar repartidor"** que abre el mismo autocomplete. Si es un envío viejo sin repartidor, dice "Sin repartidor asignado" y el botón es "Asignar repartidor".

### Listado de entregas (`/entregas`)

Botón **"Exportar envíos"** en las acciones del `PageHeader`. Abre un diálogo con:

- **Repartidor** (obligatorio): el mismo `Combobox`. Lista activos e inactivos (un inactivo puede tener envíos pendientes); los inactivos se marcan "(inactivo)".
- **Fecha de envío**: precargada con hoy; se puede limpiar para traer todos sus pendientes.
- **Exportar**: abre `GET /api/entregas/envios/pdf?repartidorId=<uuid>&fecha=AAAA-MM-DD` en una pestaña nueva (`inline`), lista para imprimir o guardar.

## PDF "Hoja de envíos"

A4 apaisado (`OPCIONES_HOJA_LIBRO`), tabla con `dibujarTabla` y `numerarHojas` (`shared/pdf/hojas.ts`).

**Encabezado.**
- Nombre y teléfono de la farmacia (para que el repartidor tenga a quién llamar).
- Título "Hoja de envíos".
- **Repartidor**: apellido, nombre y teléfono.
- Filtro: "Fecha de envío: 20/10/2026" o "Todos los pendientes".
- Fecha y hora de generación, y quién la generó.

**Una fila por envío**, ordenadas por fecha de envío y luego por Nº de receta:

| Columna | Contenido |
|---|---|
| Nº receta | `numeroInterno`. |
| Enviada | Fecha y hora de `entregada_en`. |
| Paciente | Apellido, Nombre y DNI (si tiene). |
| Teléfono | Teléfono del paciente (o "—"). |
| Domicilio | `receta.domicilio_paciente`. |
| Preparados | Cantidad de ítems entregables (excluye los `itemsExcluidos`). |
| Pago | "Pagada" o **"IMPAGA — cobrar"**, destacado: el repartidor tiene que saber que cobra. |
| Importe | Solo con `cotizaciones.ver` (E10); "incompleto" si falta cotizar algún ítem. |
| Recibió | Celda en blanco para la firma y aclaración de quien recibe. |

**Pie.** "Hoja i de n", total de envíos y cuántos están impagos.

**Sin resultados.** El PDF se genera igual, con el encabezado y el texto "Este repartidor no tiene envíos pendientes para este filtro".

**Nombre del archivo.** `envios-<apellido>-<fecha|pendientes>.pdf` (sin datos de pacientes).

## Casos borde

- **Repartidor desactivado con envíos pendientes**: sigue en esos envíos y se puede exportar su hoja. No aparece para asignaciones nuevas.
- **Repartidor editado** (cambia el teléfono): el PDF muestra los datos actuales; no hay snapshot.
- **Dos personas registran o cambian el repartidor a la vez**: el lock de receta de `registrarEntrega` ya serializa, y `cambiarRepartidor` toma el mismo.
- **Anular un envío y volver a registrarlo como retiro**: válido. El repartidor anterior queda solo en `entrega_anulada.repartidor_id`.
- **Domicilio editado después del envío**: el PDF usa el valor vigente de la receta (no se congela).

## Plan de implementación (cortes)

Cada corte es un commit revisable. La migración se aplica antes de desplegar el código que la usa.

1. **Migración 0093 `repartidores_envio`** + `prisma/rollbacks/0093_repartidores_envio.down.sql` + `docs/rollbacks/envios-repartidores.md`: tabla `repartidor`, `entrega.repartidor_id` (CHECK + INV-ENT-005 + grant), `entrega_anulada.repartidor_id`, permiso `repartidores.gestionar`. Modelos Prisma. Test DB de las invariantes.
2. **Módulo `repartidores`** (domain/application/infrastructure/ui) + rutas `/catalogos/repartidores` + navegación + Server Action de búsqueda para el autocomplete. Tests unitarios de validación.
3. **Registrar envío con repartidor**: `registrarEntregaInput` (`repartidorId`), reglas E1–E4, columna en el insert, auditoría, `Combobox` y domicilio en `registrar-entrega-form.tsx`.
4. **Cambiar repartidor**: comando `cambiarRepartidor`, Server Action con `conOperador`, vista del envío pendiente en `entrega-acciones.tsx`.
5. **Anular**: `moverEntregaAAnuladas` copia `repartidor_id`; actualizar `openspec/specs/anular-entrega/spec.md`.
6. **Exportar envíos**: query `listEnviosDeRepartidor`, `infrastructure/envios-pdf.ts`, `application/imprimir-envios-pdf.ts`, route `app/api/entregas/envios/pdf/route.ts`, diálogo en `/entregas`.

## Código que lo implementa

Implementados (cortes 1 y 2):

- **Migración 0093** (`prisma/migrations/20261020120000_0093_repartidores_envio/`, rollback `prisma/rollbacks/0093_repartidores_envio.down.sql`): INV-ENT-005 es el trigger `trg_entrega_validar_repartidor`. **Ventana de aplicación:** como el trigger exige repartidor en todo `ENVIO` nuevo y el código anterior al corte 3 no lo manda, registrar un envío falla entre aplicar 0093 y desplegar el corte 3 (retiro presencial, confirmar firma y anular no se ven afectados). Aplicar 0093 junto con el despliegue del corte 3.
- **Módulo** `modules/repartidores/` (`domain/repartidor.ts`, `application/{crear,editar,cambiar-estado,get,list,buscar}-repartidor(es).ts`, `infrastructure/repartidor-repository.ts`, `ui/`). Activar/desactivar es un solo comando (`repartidores.cambiarEstado`, auditado como `MODIFICAR` con `activo` anterior y nuevo, sin motivo).
- **Búsqueda para autocompletes:** `defineQuery` acepta un solo permiso, así que "`entregas.registrar` o `repartidores.gestionar`" son dos queries registradas con el mismo handler (`repartidores.buscar` y `repartidores.buscarGestion`); `buscarRepartidores()` elige la que la sesión puede correr. `modules/repartidores/ui/buscar-repartidores-action.ts` (Server Action, `texto` + `soloActivos`) y `ui/repartidor-search.ts` (`buscarRepartidoresParaCombobox(soloActivos)`: adaptador para el prop `search` de `Combobox`, opción "Apellido, Nombre · teléfono", " (inactivo)" si corresponde).
- **Rutas** `app/(app)/catalogos/repartidores/{layout,page,[id]/page}.tsx` y entrada en `catalogosSections`.
- **Transversal:** `PERMISO_CATALOGO` (`repartidores.gestionar`), etiqueta de grupo en `modules/usuarios/domain/roles.ts`, entidad `repartidor` en `modules/auditoria/domain/presentacion.ts`, mensaje de INV-ENT-005 en `shared/errors/mensajes-invariantes.ts`, etiqueta `soloActivos` en `shared/labels/field-labels.ts`.
- **Tests:** `tests/unit/repartidores-validacion.test.ts`, `tests/unit/repartidores-authorization-matrix.test.ts`. El test DB de las invariantes (corte 1 del plan) queda pendiente: no se pudo correr contra la base compartida.

Implementados (cortes 3, 4 y 5):

- **Corte 3, registrar envío.** `modules/entregas/domain/entrega.ts` (reglas puras E1-E5: `mensajeRepartidorSegunModalidad`, `validarDomicilioParaEnvio`, `validarRepartidorAsignable`, `puedeCambiarRepartidor`); `application/registrar-entrega.ts` (`repartidorId` opcional en el input con `superRefine` que marca el campo `repartidorId`; dentro de la tx, tras el lock de la receta, E4 y E3; el `CAMBIAR_ESTADO` suma `repartidorId` al valor nuevo cuando es un envío; INV-ENT-005 se mapea con el `mapDbError` existente); `infrastructure/entrega-repository.ts` (`insertEntrega` escribe `repartidor_id`; copias propias `getRepartidorParaAsignar`, `hayRepartidoresActivos`, `getRepartidorDeEntrega`, porque `modules/entregas` no puede importar la infraestructura de `repartidores`); `application/get-entrega-estado.ts` (suma `domicilioPaciente`, `repartidor` y `hayRepartidoresActivos`); `ui/actions.ts` (lee `repartidorId`, vacío = ausente); `ui/registrar-entrega-form.tsx` (domicilio de solo lectura, `Combobox` "Repartidor" sobre `buscarRepartidoresParaCombobox(true)`, "Envío" deshabilitado sin domicilio, aviso "No hay repartidores cargados" con link a `/catalogos/repartidores` solo con `repartidores.gestionar`, submit deshabilitado sin repartidor); ambas páginas de `/entregas/[recetaId]` pasan los datos. `shared/ui/combobox.tsx` ahora atiende `FIELD_ERROR_EVENT` para que un error del servidor sobre `repartidorId` marque y enfoque el campo.
- **Corte 4, cambiar repartidor.** `application/cambiar-repartidor.ts` (`entregas.repartidor.cambiar`, permiso `entregas.registrar`, mismo lock de receta, solo `ENVIADA_PEND_FIRMA` y entrega `ENVIO`, repartidor activo del tenant; elegir el mismo repartidor que ya tiene se rechaza, así no se audita un cambio idéntico; `MODIFICAR` sobre la entrega con `repartidorId` anterior y nuevo); `cambiarRepartidorAction` (envuelta en `conOperador`); `ui/envio-pendiente.tsx` (domicilio, repartidor con teléfono o "Sin repartidor asignado", botón "Cambiar repartidor" / "Asignar repartidor") y `ui/cambiar-repartidor-form.tsx`; `ui/entrega-acciones.tsx` los muestra encima de "Confirmar retorno", que queda intacto.
- **Corte 5, anular.** `moverEntregaAAnuladas` copia `repartidor_id` (regla A10 de `openspec/specs/anular-entrega/spec.md`).
- **Tests:** `tests/unit/entregas-validacion.test.ts` (reglas puras), `tests/unit/entregas-command-flows.test.ts` (ENVIO sin repartidor, RETIRO con repartidor, ENVIO sin domicilio, repartidor inactivo o inexistente, auditoría, `cambiarRepartidor` solo en `ENVIADA_PEND_FIRMA`), `tests/unit/entregas-authorization-matrix.test.ts` (`entregas.repartidor.cambiar`). Sin test DB: no se pudo correr contra la base compartida.

Implementado después del corte 6 (E4, domicilio escrito al registrar el envío, 2026-10-20):

- `modules/entregas/application/registrar-entrega.ts` (input `domicilio`: `domicilioPacienteOpcional` de `modules/recetas/domain/receta.ts`, rechazado en un retiro presencial; dentro de la tx, tras E3, `resolverDomicilioParaEnvio` y, si hay algo que guardar, `actualizarDomicilioReceta` + `MODIFICAR` de la receta antes de `insertEntrega`); `modules/entregas/domain/entrega.ts` (`resolverDomicilioParaEnvio`, `MENSAJE_ENVIO_SIN_DOMICILIO`, `MENSAJE_DOMICILIO_YA_CARGADO`, `MENSAJE_RETIRO_CON_DOMICILIO`; reemplaza a `validarDomicilioParaEnvio`); `modules/entregas/infrastructure/entrega-repository.ts` (`actualizarDomicilioReceta`, copia propia y angosta); `modules/entregas/ui/{actions.ts,registrar-entrega-form.tsx}`.
- **Base de datos: sin migración.** `fsj_app` ya tiene `UPDATE (domicilio_paciente)` sobre `fsj.receta` (migración 0070) y ningún trigger de `fsj.receta` restringe esa columna por estado: los de estado (`BEFORE UPDATE OF estado`), `trg_receta_validar_archivo` (`OF lote_archivo_id`), `trg_receta_validar_pago_no_anulada` (`OF pagada...`), `trg_receta_validar_entregada_pagada` (`OF estado, pagada`) no se disparan, y el `INV-U07` de `BEFORE UPDATE` solo valida actores (`tomada_por_id`, `pagada_por_id`) en su transición NULL → valor. La edición de la receta (`esEstadoEditable`) es una regla de aplicación, no de base. La receta ya archivada tampoco bloquea: el domicilio no entra en el asiento del libro ni en su hash.
- **Tests:** `tests/unit/entregas-validacion.test.ts` (`resolverDomicilioParaEnvio`), `tests/unit/entregas-command-flows.test.ts` (domicilio escrito: guardado y auditado antes de la entrega; ausente: error sobre `domicilio`; receta que ya tiene domicilio: no se escribe nada y un `domicilio` recibido se rechaza; retiro con `domicilio`; largo máximo). Sin test DB.

Implementado (corte 6, exportar envíos):

- **Consulta** `listEnviosDeRepartidor` en `modules/entregas/infrastructure/entrega-repository.ts`: recetas `ENVIADA_PEND_FIRMA` con `entrega.repartidor_id` = el elegido, ordenadas por `entregada_en` y Nº de receta. **Día:** la fecha de envío es un día calendario de la farmacia (`tenant.zona_horaria`) y se convierte al rango `[inicio del día, inicio del día siguiente)` con `rangoDeJornadas` (`shared/time/jornada.ts`), igual que el filtro de ingreso de `/entregas`; nunca medianoche UTC. "Preparados" cuenta los ítems entregables con `calcularItemsEntregables` (asiento VIGENTE) sobre `getItemsParaEntregaDeRecetas` (la consulta de `getItemsParaEntrega`, ahora en lote); el importe reutiliza `preciosDeRecetas` y solo se lee con `cotizaciones.ver`. También: `getFarmaciaParaHoja` (nombre de fantasía o razón social, teléfono fijo y celular) y `zonaHorariaTenant`.
- **Reglas puras** `modules/entregas/domain/hoja-envios.ts` (línea de filtro, texto de Pago, aviso de hoja vacía, nombre de archivo); **PDF** `modules/entregas/infrastructure/envios-pdf.ts` (`buildEnviosPdf`, `columnasHojaEnvios`, `filasHojaEnvios`). `shared/pdf/hojas.ts` suma `negrita` a las celdas (Pago impago destacado) y `altoMinimoFila` a `dibujarTabla` (espacio para firmar en "Recibió"). El PDF imprime ambos teléfonos de la farmacia si están cargados.
- **Casos de uso** `modules/entregas/application/imprimir-envios-pdf.ts`: `entregas.envios.hoja` (`defineQuery`, `entregas.registrar`; el repartidor puede estar inactivo, uno inexistente es `NOT_FOUND`; la columna de importe depende de `can(session, "cotizaciones.ver")`) y `entregas.envios.fechaHoy` (hoy en la zona horaria de la farmacia, para precargar el diálogo). Sin auditoría: ver la tabla de Auditoría.
- **Ruta** `app/api/entregas/envios/pdf/route.ts` (`GET`, solo `repartidorId` y `fecha`), **UI** `modules/entregas/ui/exportar-envios-dialog.tsx` en las acciones del `PageHeader` de `app/(app)/entregas/page.tsx`.
- **Tests:** `tests/unit/entregas-envios-pdf.test.ts`, `tests/unit/entregas-authorization-matrix.test.ts`; `tests/db/entrega-repartidor.test.ts` (INV-ENT-005, CHECK y FK) y fixtures de repartidor en `tests/db/{entrega-archivo,entrega-regularizacion}.test.ts` (`insertRepartidor` en `tests/db/fixtures.ts`). Los tests DB no se corrieron contra la base compartida.

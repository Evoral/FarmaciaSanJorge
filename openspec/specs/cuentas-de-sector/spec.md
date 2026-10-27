# Cuentas de sector e identificación del empleado por PIN

## Purpose

En el mostrador y en el laboratorio varios empleados usan la misma computadora. Para no iniciar y cerrar sesión todo el tiempo, cada puesto tiene una cuenta de sector con sesión compartida, requiriendo identificación por PIN del empleado en acciones sensibles (decisiones del usuario del 2026-10-13, 2026-10-21 y 2026-10-26).

## Requirements

### Requirement: S1 — Rechazo de acción con PIN sin empleado identificado

Una acción con PIN en una cuenta de sector SHALL NOT ejecutarse sin un empleado identificado en esa misma solicitud. La solicitud MUST ser rechazada antes de abrir ninguna transacción de base de datos, rigiendo para todo comando, presente o futuro.

#### Scenario: Solicitud a acción con PIN sin empleado identificado en cuenta de sector
- **GIVEN** una sesión activa correspondiente a una cuenta de sector
- **AND** una acción configurada para requerir identificación por PIN
- **WHEN** se envía una solicitud para ejecutar dicha acción sin los datos del empleado y su PIN
- **THEN** el sistema rechaza la solicitud antes de abrir ninguna transacción

### Requirement: S2 — Verificación de PIN en cada acción

El PIN del empleado MUST verificarse en cada acción individual sin mantener un estado de operador activo persistente en el tiempo. Una acción compuesta que encadene varios comandos en la misma solicitud MUST verificar el PIN una sola vez.

#### Scenario: Dos acciones consecutivas en la misma cuenta de sector
- **GIVEN** una cuenta de sector donde un empleado se identificó con su PIN para una acción previa
- **WHEN** se solicita una nueva acción posterior que requiere PIN
- **THEN** el sistema exige nuevamente la selección de empleado y el ingreso del PIN

#### Scenario: Acción que encadena múltiples comandos en una única solicitud
- **GIVEN** una cuenta de sector y una solicitud que involucra la ejecución de varios comandos encadenados con PIN
- **WHEN** se procesa la solicitud
- **THEN** el sistema verifica el PIN una sola vez para toda la secuencia de comandos

### Requirement: S3 — Intersección de permisos entre sector y empleado

Una acción en cuenta de sector con PIN SHALL permitirse únicamente si el permiso correspondiente está concedido tanto a la cuenta de sector como al empleado en sus propios roles. Los permisos efectivos MUST ser la intersección de ambos, y un rechazo MUST auditarse como ACCESO_DENEGADO a nombre del empleado.

#### Scenario: Empleado y sector con permisos habilitados
- **GIVEN** una cuenta de sector que posee el permiso requerido
- **AND** un empleado identificado por PIN que también posee dicho permiso en sus roles personales
- **WHEN** el empleado ejecuta la acción
- **THEN** el sistema autoriza la operación

#### Scenario: Empleado sin permiso para la acción aunque el sector lo tenga
- **GIVEN** una cuenta de sector con permisos que el empleado no tiene en sus propios roles
- **WHEN** el empleado intenta realizar dicha acción
- **THEN** el sistema deniega el acceso y registra un evento de auditoría con tipo ACCESO_DENEGADO a nombre del empleado

### Requirement: S4 — Atribución de la acción al empleado

Cuando una acción con PIN se ejecuta en una cuenta de sector, el comando MUST recibir al empleado como session.usuario, de modo que los identificadores de atribución del negocio y de auditoría queden asignados a su identificador de usuario.

#### Scenario: Atribución de preparación o entrega a nombre del empleado
- **GIVEN** una acción con PIN ejecutada desde una cuenta de sector por un empleado válido
- **WHEN** el comando persiste los cambios
- **THEN** los campos de atribución (`registrada_por_id`, `preparada_por_id`, `entregada_por_id`, `registrado_por_id`) y `registro_auditoria.usuario_id` corresponden al identificador del empleado

### Requirement: S5 — Auditoría con contexto de terminal de sector y método PIN

Toda fila de auditoría generada a nombre de un empleado desde una cuenta de sector MUST registrar en su campo contexto la terminal de origen con usuarioId, usuario y sesionId de la cuenta de sector, junto con el método de verificación en valor PIN.

#### Scenario: Registro de auditoría de acción ejecutada en cuenta de sector
- **GIVEN** una acción con PIN confirmada por un empleado desde una cuenta de sector
- **WHEN** se escribe el registro de auditoría
- **THEN** el registro contiene `contexto.terminal` con los datos de la cuenta de sector y `contexto.verificacion` con el valor `"PIN"`

### Requirement: S6 — Atribución de acciones sin PIN a la cuenta de sector

Una acción ejecutada en una cuenta de sector que no requiera PIN SHALL quedar registrada y atribuida directamente a nombre del usuario de la cuenta del sector.

#### Scenario: Ejecución de acción de mostrador sin PIN
- **GIVEN** una acción configurada sin requerimiento de PIN
- **WHEN** un usuario ejecuta dicha acción en una cuenta de sector
- **THEN** la operación se ejecuta sin solicitar PIN y los registros quedan a nombre de la cuenta de sector

### Requirement: S7 — Condiciones para calificar como operador

Solo un usuario de la farmacia en estado ACTIVO que no sea cuenta de sector ni usuario técnico, que posea PIN configurado y que no tenga cambio de contraseña temporal pendiente (debeCambiarPassword; no cuenta como intento fallido de PIN) SHALL ser admitido como operador para identificación con PIN.

#### Scenario: Empleado activo con PIN y sin cambio de contraseña pendiente
- **GIVEN** un usuario en estado ACTIVO, con PIN establecido, sin ser cuenta de sector ni usuario técnico, y con debeCambiarPassword en falso
- **WHEN** se consulta el listado de operadores disponibles o se valida su identidad
- **THEN** el sistema lo admite como operador válido

#### Scenario: Usuario con cambio de contraseña temporal pendiente
- **GIVEN** un usuario que tiene debeCambiarPassword en verdadero
- **WHEN** se intenta seleccionar o validar como operador en una cuenta de sector
- **THEN** el sistema no lo admite como operador y la condición no computa como intento fallido de PIN

### Requirement: S8 — Límite de intentos fallidos y bloqueo de PIN

Cada verificación de PIN rechazada MUST incrementar el contador de intentos fallidos del empleado en su propia transacción. Al alcanzar AUTH_POLICY.maxFailedPinAttempts, el PIN MUST quedar bloqueado sin bloquear la cuenta de usuario, requiriendo reautenticación con contraseña o nuevo PIN para su desbloqueo.

#### Scenario: Quinto intento consecutivo de PIN incorrecto
- **GIVEN** un empleado con 4 intentos fallidos previos acumulados en su PIN
- **WHEN** ingresa un PIN erróneo en su quinto intento
- **THEN** el contador se incrementa a 5 y el PIN queda bloqueado para operar

#### Scenario: Desbloqueo de PIN por el titular
- **GIVEN** un empleado con su PIN bloqueado
- **WHEN** el titular se reautentica exitosamente con su contraseña o configura un nuevo PIN
- **THEN** el PIN queda desbloqueado y su contador de intentos se reinicia

### Requirement: S9 — Auditoría de intentos de identificación rechazados

Cada intento de identificación de operador rechazado MUST auditarse a nombre de la cuenta de sector con entidad operador y acción AUTORIZAR, registrando como destino al usuario seleccionado y sin almacenar jamás el PIN ingresado.

#### Scenario: Registro de auditoría ante PIN incorrecto
- **GIVEN** un intento de identificación en cuenta de sector con PIN inválido
- **WHEN** el sistema rechaza la autenticación
- **THEN** se emite un registro de auditoría a nombre de la cuenta de sector, indicando el usuario seleccionado y sin incluir el PIN

### Requirement: S10 — Exclusión de roles y permisos vedados en cuentas de sector

Una cuenta de sector SHALL NOT poseer los roles ADMINISTRADOR ni DIRECTOR_TECNICO (y por eso nunca puede ser designada DT), y nunca conservará los permisos de PERMISOS_VEDADOS_A_SECTOR, diga lo que diga su rol.

#### Scenario: Asignación de rol o permisos vedados a cuenta de sector
- **GIVEN** un intento de crear o editar una cuenta de sector
- **WHEN** se intenta asignar el rol ADMINISTRADOR o DIRECTOR_TECNICO
- **THEN** el sistema deniega la asignación

#### Scenario: Permisos vedados sustraídos de los permisos efectivos de cuenta de sector
- **GIVEN** una cuenta de sector asignada a un rol que contiene permisos incluidos en PERMISOS_VEDADOS_A_SECTOR
- **WHEN** se calculan sus permisos efectivos
- **THEN** los permisos de PERMISOS_VEDADOS_A_SECTOR son sustraídos y no forman parte de los permisos efectivos de la sesión

### Requirement: S11 — Exclusión de reautenticación por contraseña en cuentas de sector

Ningún acto SHALL exigir reautenticación con contraseña (decisión 2026-10-21), salvo `reanclarLibro`, que solo hace el DT; en una cuenta de sector el PIN del empleado identifica al que actúa y no se pide además la contraseña de la cuenta.

#### Scenario: Ejecución de comando en cuenta de sector sin reautenticación por contraseña
- **GIVEN** una cuenta de sector donde un empleado ingresó su PIN válido
- **WHEN** se procesa el comando solicitado
- **THEN** el sistema no solicita la contraseña de la cuenta de sector

### Requirement: S12 — Ausencia de PIN en consultas y en sesiones individuales

Las consultas (queries) SHALL NOT solicitar PIN. Las sesiones de usuarios individuales SHALL NOT solicitar PIN de empleado ni reautenticación periódica con contraseña para actos operativos propios, requiriéndose únicamente la contraseña del Director Técnico en actos donde este deba autorizar.

#### Scenario: Consulta ejecutada en cuenta de sector
- **GIVEN** una sesión activa en cuenta de sector
- **WHEN** se ejecuta una consulta de lectura
- **THEN** la consulta se resuelve sin solicitar PIN

#### Scenario: Sesión individual realizando acción sensible
- **GIVEN** un usuario individual autenticado en su propia sesión
- **WHEN** realiza una acción del sistema
- **THEN** la acción se ejecuta sin solicitar PIN de empleado

#### Scenario: Acción que requiere autorización del Director Técnico
- **GIVEN** un acto que requiere co-firma o autorización expresa del Director Técnico
- **WHEN** se envía la solicitud
- **THEN** el sistema solicita la contraseña del Director Técnico independientemente del perfil del operador

### Requirement: S13 — Vencimiento por inactividad en cuentas de sector

La sesión de una cuenta de sector MUST vencer tras 4 h sin uso (`AUTH_POLICY.sessionIdleMinutesSector`; decisión del usuario 2026-10-26), mientras que una sesión individual vence a los 30 min (`AUTH_POLICY.sessionIdleMinutes`), manteniendo para todas el mismo vencimiento absoluto de 12 h desde el login.

#### Scenario: Sesión de cuenta de sector tras 30 minutos sin uso pero menos de 4 horas
- **GIVEN** una sesión activa correspondiente a una cuenta de sector
- **WHEN** transcurren más de 30 minutos pero menos de 4 horas desde el último uso y sin haber alcanzado las 12 horas desde el login
- **THEN** la sesión permanece vigente

### Requirement: S13 — Redirección a /login al vencer la sesión

Al vencer la sesión, el navegador SHALL redirigir directamente a `/login`: mientras haya actividad (teclas, clics, scroll) el cliente MUST mantener viva la sesión y, ante inactividad, cerrarla antes que el servidor.

#### Scenario: Sesión de cuenta de sector tras 4 horas de inactividad
- **GIVEN** una sesión activa correspondiente a una cuenta de sector
- **WHEN** transcurren 4 horas sin actividad
- **THEN** la sesión vence por inactividad y el navegador cierra la sesión y redirige a `/login`

### Requirement: INV-SEC-001 — Prohibición de roles administrativos y de DT en cuentas de sector

Una cuenta de sector MUST NOT tener asignado el rol ADMINISTRADOR ni el rol DIRECTOR_TECNICO.

#### Scenario: Validación de invariante INV-SEC-001
- **GIVEN** una cuenta marcada como cuenta de sector
- **WHEN** se evalúa la asignación de roles
- **THEN** el sistema garantiza que ni ADMINISTRADOR ni DIRECTOR_TECNICO estén presentes

### Requirement: INV-SEC-002 — Inmutabilidad del atributo es_sector

El valor del campo usuario.es_sector MUST definirse durante la creación del usuario y MUST NOT modificarse en ninguna operación posterior de edición.

#### Scenario: Intento de cambiar la condición de cuenta de sector
- **GIVEN** un usuario creado con es_sector en verdadero
- **WHEN** se envía una solicitud de edición de sus datos de usuario
- **THEN** el valor de es_sector permanece inalterado

### Requirement: Unicidad de PIN por farmacia

Dos usuarios de la misma farmacia SHALL NOT compartir el mismo PIN. Al elegirlo en Mi cuenta o en el paso obligatorio, el sistema MUST verificar contra el hash de cada otro usuario de la farmacia bajo lock consultivo, rechazando coincidencias con el mensaje «Ese PIN no se puede usar. Elegí otro.».

#### Scenario: Empleado elige PIN ya en uso por otro empleado de la misma farmacia
- **GIVEN** un empleado de la farmacia que ya tiene configurado un PIN determinado
- **WHEN** otro empleado de la misma farmacia intenta configurar el mismo PIN
- **THEN** el sistema rechaza el PIN bajo lock consultivo con el mensaje «Ese PIN no se puede usar. Elegí otro.»

#### Scenario: Empleados de farmacias distintas configuran el mismo PIN
- **GIVEN** un empleado en una farmacia con un PIN determinado
- **WHEN** un empleado de otra farmacia distinta configura ese mismo PIN
- **THEN** el sistema acepta la configuración exitosamente

### Requirement: Longitud y hashing de PIN

El PIN de cada empleado MUST constar exactamente de 4 dígitos numéricos (AUTH_POLICY.pinLength), MUST almacenarse con hash argon2 con sal, y MUST ser configurable únicamente por el propio empleado desde su sesión individual.

#### Scenario: Configuración de PIN de 4 dígitos
- **GIVEN** un empleado autenticado en su sesión individual en «Mi cuenta»
- **WHEN** ingresa un PIN numérico de 4 dígitos
- **THEN** el sistema genera su hash argon2 y lo almacena

#### Scenario: Intento de configurar PIN con longitud fuera del rango permitido
- **GIVEN** un empleado que intenta configurar un PIN fuera de la longitud permitida
- **WHEN** envía el formulario
- **THEN** el sistema rechaza la solicitud por validación de longitud

### Requirement: Configuración de acciones con PIN y reglas no configurables

Las acciones de PERMISOS_CON_PIN_CONFIGURABLES MUST poder configurarse individualmente por farmacia para exigir o no PIN en cuentas de sector. La acción recetas.anular MUST pertenecer a PERMISOS_CON_PIN_SIEMPRE porque anular una receta no se deshace (decisión del usuario 2026-10-17), y cotizaciones.calcular SHALL NOT ser configurable porque el presupuesto se recalcula solo mientras se carga la receta.

#### Scenario: Modificación de acción configurable
- **GIVEN** la pantalla de configuración de PIN por acción
- **WHEN** un usuario con config.editar modifica el interruptor de una acción configurable
- **THEN** la nueva regla entra en vigencia a partir de la próxima acción de cada cuenta de sector

#### Scenario: Anulación de receta en cuenta de sector
- **GIVEN** una cuenta de sector
- **WHEN** se intenta anular una receta
- **THEN** el sistema exige obligatoriamente la identificación del empleado por PIN por ser una acción no configurable

### Requirement: Valores por defecto de acciones con PIN

En una farmacia nueva, las acciones de drogas (`drogas.crear`, `drogas.editar`, `drogas.baja`, `drogas.reactivar`), stock (`stock.partida.ingresar`, `stock.ajuste.registrar`), fichas y etiquetas (`fichas.generar`, `etiquetas.generar`) y preparaciones (`preparaciones.iniciar`, `preparaciones.descartar`, `preparaciones.confirmar`) MUST requerir PIN por defecto, mientras que recetas (`recetas.crear`, `recetas.editar`) y entregas (`entregas.registrar`) SHALL NOT requerir PIN por defecto.

#### Scenario: Sembrado inicial de acciones con PIN por defecto
- **WHEN** se inicializa una nueva farmacia mediante `fsj.seed_acciones_con_pin(tenant)`
- **THEN** se configuran con PIN las acciones de drogas, stock, fichas, etiquetas y preparaciones, y sin PIN las de recetas y entregas

### Requirement: Auditoría y aplicación de cambios en PIN por acción

El cambio de configuración de PIN por acción MUST requerir el permiso `config.editar`, MUST auditarse registrando el conjunto de acciones con PIN antes y después, y MUST regir desde la próxima acción de cada cuenta de sector.

#### Scenario: Modificación de configuración de PIN por acción
- **GIVEN** un usuario con permiso `config.editar`
- **WHEN** modifica la configuración de acciones con PIN
- **THEN** la operación se registra en auditoría con el conjunto antes y después, y rige inmediatamente en la siguiente acción de cada cuenta de sector

### Requirement: Incompatibilidad de actos propios del Director Técnico en cuentas de sector

Los actos propios del Director Técnico (firmar el cierre, co-firmas, libros rubricados) SHALL NOT estar disponibles en una cuenta de sector.

#### Scenario: Intento de realizar acto propio del Director Técnico desde cuenta de sector
- **GIVEN** una sesión activa en una cuenta de sector
- **WHEN** se intenta acceder o ejecutar un acto exclusivo del Director Técnico
- **THEN** el sistema no ofrece la acción o rechaza su ejecución

### Requirement: Identificación del Director Técnico con PIN en actos no exclusivos

Un Director Técnico SHALL poder identificarse con su PIN como operador en una cuenta de sector para aquellos actos que no sean exclusivos del Director Técnico.

#### Scenario: Director Técnico se identifica con PIN para acto operativo no exclusivo
- **GIVEN** una cuenta de sector ejecutando una acción que requiere PIN no exclusiva del DT
- **WHEN** el Director Técnico ingresa su PIN de operador
- **THEN** el sistema lo identifica válidamente como operador de la acción

### Requirement: Permisos de recetas en el rol LABORATORIO

El rol predefinido `LABORATORIO` MUST incluir los permisos `recetas.crear` y `recetas.editar` para autorizar las lecturas y ediciones de recetas en la mesa de trabajo de preparaciones.

#### Scenario: Operador con rol LABORATORIO en mesa de trabajo
- **GIVEN** un usuario asignado al rol `LABORATORIO`
- **WHEN** accede a la mesa de trabajo para preparar y editar una receta
- **THEN** el sistema autoriza las operaciones mediante los permisos `recetas.crear` y `recetas.editar`

### Requirement: Alta de cuenta de sector con credencial definitiva

El formulario de alta de nuevo usuario con interruptor de cuenta de sector activo MUST requerir únicamente el nombre del sector, el email y una contraseña definitiva sujeta a la política completa, naciendo en estado ACTIVO sin pasos obligatorios pendientes y con apellido y DNI derivados del nombre (SECTOR-<NOMBRE>).

#### Scenario: Creación exitosa de cuenta de sector
- **GIVEN** el formulario de nuevo usuario con interruptor Cuenta de sector activo
- **WHEN** se ingresa el nombre de sector "Laboratorio", un email y la contraseña definitiva
- **THEN** el usuario nace en estado ACTIVO con apellido "Laboratorio", DNI derivado "SECTOR-LABORATORIO" y sin pasos pendientes de contraseña ni PIN

#### Scenario: Conflicto por nombre duplicado de sector en la misma farmacia
- **GIVEN** una farmacia donde ya existe la cuenta de sector "Laboratorio"
- **WHEN** se intenta crear otra cuenta de sector con el nombre "Laboratorio"
- **THEN** el sistema rechaza la creación por colisión en el DNI derivado

### Requirement: Edición y restablecimiento de credenciales en cuentas de sector

En la pantalla de detalle de usuario, una cuenta de sector MUST editarse requiriendo únicamente nombre del sector y email re-derivando apellido y DNI. El restablecimiento de credenciales por un Administrador MUST asignar una contraseña definitiva sin marcar cambio obligatorio ni solicitar PIN.

#### Scenario: Edición de datos de cuenta de sector
- **GIVEN** una cuenta de sector existente
- **WHEN** se modifica su nombre de sector
- **THEN** el sistema actualiza el nombre y re-deriva el apellido y DNI sin solicitar datos de persona física

#### Scenario: Restablecimiento de credencial de cuenta de sector
- **GIVEN** una cuenta de sector
- **WHEN** un Administrador ejecuta la acción de restablecer credencial
- **THEN** la nueva contraseña queda establecida como definitiva sin pasos obligatorios posteriores

### Requirement: Restricción de autoservicio en Mi cuenta para cuentas de sector

En la pantalla /cuenta, una cuenta de sector SHALL NOT visualizar paneles de cambio de contraseña ni de PIN, mostrando en su lugar una nota informativa, y el servidor MUST rechazar cualquier invocación a cambiarPassword proveniente de una cuenta de sector. Ningún usuario SHALL disponer de opción para eliminar su PIN.

#### Scenario: Acceso a /cuenta desde cuenta de sector
- **GIVEN** una sesión activa correspondiente a una cuenta de sector
- **WHEN** se accede a la ruta /cuenta
- **THEN** no se muestran los paneles de cambio de credenciales y se visualiza la nota informativa

#### Scenario: Invocación de cambiarPassword para cuenta de sector
- **GIVEN** una cuenta de sector
- **WHEN** se envía una solicitud al comando cambiarPassword
- **THEN** el servidor rechaza la operación

### Requirement: Manejo de operador en Server Actions mediante conOperador

Toda Server Action que ejecute un caso de uso con acción configurable MUST envolver su ejecución en la utilidad conOperador para capturar operadorId y operadorPin. Si una acción con PIN no es envuelta por conOperador, el comando MUST rechazarse en cuenta de sector con un mensaje explícito.

#### Scenario: Ejecución de Server Action con conOperador
- **GIVEN** una Server Action que invoca un caso de uso con PIN envuelta en conOperador
- **WHEN** se reciben los datos del formulario con el empleado y PIN
- **THEN** el caso de uso procesa la credencial correctamente

#### Scenario: Server Action sin conOperador ejecutada desde cuenta de sector
- **GIVEN** una Server Action no envuelta en conOperador para una acción con PIN
- **WHEN** se invoca desde una cuenta de sector
- **THEN** el comando rechaza la ejecución con un mensaje claro sin atribuir en silencio

### Requirement: Co-firma de DT y generación de fichas técnicas en cuenta de sector

El ajuste de stock en cuenta de sector MUST exigir tanto el PIN del empleado que registra como la co-firma con contraseña del Director Técnico que autoriza. Al guardar una receta, si fichas.generar exige PIN y la cuenta posee el permiso, MUST solicitarse PIN para las fichas quedando estas a nombre del empleado.

#### Scenario: Ajuste de stock en cuenta de sector
- **GIVEN** una cuenta de sector ejecutando un ajuste de stock
- **WHEN** se envía la operación
- **THEN** el sistema exige la identificación por PIN del operador y la contraseña del Director Técnico

#### Scenario: Guardado de receta con generación de fichas técnicas
- **GIVEN** una cuenta con permiso fichas.generar configurado con PIN
- **WHEN** se guarda una receta desde dicha cuenta
- **THEN** el formulario solicita PIN para las fichas y registra las fichas a nombre del empleado

### Requirement: Bloqueo de creación directa de droga en importación de facturas

Cuando drogas.crear esté configurado para requerir PIN, la acción de creación directa de producto dentro de la importación de facturas MUST rechazarse desde una cuenta de sector con un mensaje claro, requiriendo realizar el alta por Catálogos › Drogas.

#### Scenario: Creación directa de droga en importación de facturas desde cuenta de sector
- **GIVEN** una cuenta de sector y el permiso drogas.crear configurado con PIN
- **WHEN** se intenta crear un producto directamente dentro del flujo de importación de factura
- **THEN** el sistema rechaza la operación informando que el alta debe realizarse desde Catálogos › Drogas

## Estado

> Estado: implementado 2026-10-13 (migración 0077). Reversión: `docs/rollbacks/cuentas-de-sector.md`.
> Decisiones del usuario (2026-10-13): una cuenta por sector; PIN en cada acción, pero solo en las acciones
> configuradas; el mostrador sin PIN; el empleado necesita el permiso en sus propios roles; PIN de 4 dígitos (decidido primero en 6 y cambiado el mismo día, migración 0078);
> cada empleado configura su propio PIN. Decisión del usuario (2026-10-21): se elimina la reautenticación periódica con contraseña en todos los
> actos (la sesión individual ya identifica a quien actúa y, en una cuenta de sector, lo hace el PIN); queda solo la contraseña del DT donde el DT autoriza.

## Alcance

En el mostrador y en el laboratorio varios empleados usan **la misma computadora**. Para no iniciar y cerrar
sesión todo el tiempo, cada puesto tiene una **cuenta de sector**: un usuario cuya sesión se comparte.

En esa sesión compartida, las acciones sensibles (con cuánto se hizo una preparación, qué partida se usó, un
ajuste de stock, el alta de una droga) tienen que decir **quién las hizo**. Para esas acciones el empleado elige
su nombre e ingresa **su PIN**, y la acción queda registrada a su nombre. El resto (lo del mostrador) no pide
nada, para que sea ágil, y queda a nombre de la cuenta del sector.

El **Director Técnico** y cualquier empleado conservan su usuario y su sesión individual, sin cambios. Los actos
propios del DT (firmar el cierre, co-firmas, libros rubricados) **nunca** están disponibles en una cuenta de sector.

**Fuera de alcance.** Biometría (huella, Face ID, WebAuthn): la verificación quedó desacoplada para sumarla
después (ver "Verificación"), pero hoy el único método es el PIN.

## Modelo

| Elemento | Qué es |
|---|---|
| `fsj.usuario.es_sector` | Marca la cuenta de sector. Se define al crear el usuario y no cambia (INV-SEC-002). Nunca junto con `es_tecnico`. |
| `fsj.accion_con_pin (tenant_id, permiso_id)` | Una fila = en una cuenta de sector, esa acción pide el PIN del empleado. Por farmacia. RLS forzada. |
| `fsj.seed_acciones_con_pin(tenant)` | El conjunto por defecto de una farmacia nueva (y el backfill de las existentes). |
| Rol `LABORATORIO` | Rol predefinido nuevo, editable y eliminable como `FARMACEUTICO`. Para el mostrador se usa `ATENCION_PUBLICO`. Desde la migración 0106 ninguno de los dos se siembra en una farmacia nueva: se crean a pedido (`openspec/specs/roles-personalizables/spec.md`). |

No hay permisos nuevos ni valores nuevos de `tipo_accion`. `registro_auditoria` no cambia de forma: la terminal de
origen va en su `contexto` (JSON).

El PIN es el de siempre (migración 0037), ahora de **4 dígitos** (`AUTH_POLICY.pinLength`; la migración 0078 borró los
PIN de 6 dígitos que existían): hash argon2, contador y bloqueo propios. Cada empleado lo
configura desde «Mi cuenta» con su propio usuario; nadie más lo conoce.

**Dos usuarios de la misma farmacia nunca comparten PIN** (decisión del usuario 2026-10-26). Como el PIN se guarda
con hash argon2 (con sal), no hay índice único: al elegirlo se verifica contra el hash de cada otro usuario de la
farmacia (`modules/auth/application/pin-disponible.ts`, en «Mi cuenta» y en el paso obligatorio), bajo un lock
consultivo por farmacia para que dos altas simultáneas no elijan el mismo. El error no dice que el PIN es de otro:
«Ese PIN no se puede usar. Elegí otro.». Riesgo aceptado: el rechazo revela que ese PIN está en uso, así que probando
PINs en «Mi cuenta» se puede armar la lista de los ocupados (el intento contra un compañero sigue limitado por S8 y
queda auditado por S9).

## Reglas

| # | Regla | Dónde se hace cumplir |
|---|---|---|
| S1 | Una acción **con PIN** en una cuenta de sector no corre sin un empleado identificado en esa misma solicitud: se rechaza antes de abrir ninguna transacción. Vale para **todo** comando, presente o futuro. | `resolverActor` (`shared/usecase.ts`); `tests/unit/usecase-registry-all-modules.test.ts`. |
| S2 | El PIN se verifica **en cada acción** (no hay "operador activo" por un rato). Una acción que encadena varios comandos lo verifica una sola vez. | `resolverActor`; `shared/auth/operador-context.ts`. |
| S3 | La acción solo se permite si la tiene **la cuenta del sector Y el empleado** en sus propios roles. El de laboratorio no puede firmar nada del mostrador y viceversa. Los permisos del acto son la intersección. | `authorizeAuditado` sobre ambos; un rechazo queda auditado (`ACCESO_DENEGADO`) a nombre del empleado. |
| S4 | Atribución: el handler recibe al empleado como `session.usuario`, así que `registrada_por_id`, `preparada_por_id`, `entregada_por_id`, `registrado_por_id`, etc. y `registro_auditoria.usuario_id` son suyos. | `resolverActor`. Ningún handler cambió. |
| S5 | Toda fila de auditoría a nombre del empleado lleva `contexto.terminal = { usuarioId, usuario, sesionId }` (la cuenta de sector) y `contexto.verificacion` (`"PIN"`). | `shared/audit/index.ts`; visible en `/auditoria`. |
| S6 | Una acción **sin PIN** en una cuenta de sector queda a nombre de la cuenta del sector (decisión explícita para el mostrador). | `resolverActor`. |
| S7 | Puede ser empleado ("operador") un usuario `ACTIVO` de la farmacia que no sea cuenta de sector ni el usuario técnico, y que tenga PIN y no tenga un cambio de contraseña temporal pendiente (`debeCambiarPassword`; no cuenta como intento fallido de PIN, ver `openspec/specs/contrasena-temporal/spec.md`). | `decideCandidatoOperador` (`modules/auth/domain/operador-policy.ts`, decisión `DEBE_CAMBIAR_PASSWORD`), `operadores-repository.ts` (el selector solo lista empleados sin cambio pendiente), `verificador-pin.ts`. |
| S8 | Un PIN rechazado suma al contador del empleado; al quinto se bloquea (`AUTH_POLICY.maxFailedPinAttempts`). Lo desbloquea su titular reautenticándose con contraseña o configurando un PIN nuevo. Nunca bloquea la cuenta en sí. | `verificador-pin.ts`; el contador se confirma aunque el acto falle (transacción propia). |
| S9 | Cada identificación rechazada se audita (`entidad = operador`, acción `AUTORIZAR`) a nombre de la cuenta de sector, apuntando al usuario elegido. El PIN nunca se registra. | `verificar-operador.ts`. |
| S10 | Una cuenta de sector nunca tiene `ADMINISTRADOR` ni `DIRECTOR_TECNICO` (y por eso nunca puede ser designada DT), y nunca conserva los permisos de `PERMISOS_VEDADOS_A_SECTOR`, diga lo que diga su rol. | `crearUsuario`; INV-SEC-001; `permisosEfectivos` (`modules/auth/domain/permisos.ts`). |
| S11 | Ningún acto pide reautenticación con contraseña (decisión 2026-10-21; la excepción es `reanclarLibro`, que solo hace el DT): en una cuenta de sector el PIN del empleado identifica al que actúa, y no se le pide además la contraseña de la cuenta. | `defineCommand`. |
| S12 | Las consultas nunca piden PIN. Una sesión individual nunca pide PIN de empleado ni reautenticación con contraseña: la propia sesión identifica a quien actúa. Solo se pide la contraseña **del DT** donde el DT autoriza (co-firma de ajustes y anulaciones, firma de cierre, destrucción de archivo), sea cual sea el perfil de quien opera. | `defineQuery`; `resolverActor`. |
| S13 | La sesión de una cuenta de sector vence tras **4 h sin uso** (decisión del usuario 2026-10-26; una sesión individual, 30 min): el PIN ya protege las acciones con PIN. Las consultas no piden PIN, así que en ese lapso el puesto deja ver datos sin identificarse. El vencimiento absoluto (12 h desde el login) es el mismo para todas. Al vencer, el navegador va directo a `/login`: mientras hay actividad (teclas, clics, scroll) mantiene viva la sesión y, sin actividad, la cierra un poco antes que el servidor. | `AUTH_POLICY.sessionIdleMinutesSector`, `checkSessionLifecycle`; `app/(app)/vigilante-inactividad.tsx`. |

## Acciones configurables

`PERMISOS_CON_PIN_CONFIGURABLES` (`modules/auth/domain/permisos.ts`). Se configuran por permiso, igual que en el
editor de roles: "Confirmar preparaciones" cubre reservar, modificar la reserva, confirmar y registrar una pérdida.

| Acción | Por defecto |
|---|---|
| `drogas.crear`, `drogas.editar`, `drogas.baja`, `drogas.reactivar` | Con PIN |
| `stock.partida.ingresar`, `stock.ajuste.registrar` | Con PIN |
| `fichas.generar`, `etiquetas.generar` | Con PIN |
| `preparaciones.iniciar`, `preparaciones.descartar`, `preparaciones.confirmar` | Con PIN |
| `recetas.crear`, `recetas.editar` | Sin PIN |
| `entregas.registrar` (única de entregas desde 0085: registrar, confirmar firma) | Sin PIN |

**Siempre con PIN** (`PERMISOS_CON_PIN_SIEMPRE`, no configurable; decisión del usuario 2026-10-17): `recetas.anular`. Anular una receta no se deshace, así que en una cuenta de sector siempre queda a nombre del empleado que la anuló. Se suma al conjunto de `fsj.accion_con_pin` al cargar la sesión (`loadPermisosConPin`) y no aparece en «PIN por acción».

`cotizaciones.calcular` no es configurable: el presupuesto se recalcula solo mientras se carga la receta.

La configuración se cambia en **Configuración › PIN por acción** (`config.editar`, auditado con
el conjunto antes y después) y rige desde la próxima acción de cada cuenta de sector.

## Casos a tener presentes

- **El ajuste de stock sigue pidiendo la co-firma del DT** (contraseña del DT en el mismo acto). El PIN dice quién
  registra; la contraseña del DT, quién autoriza. Son dos cosas distintas y las dos quedan.
- **Guardar una receta también genera sus fichas técnicas.** Si la cuenta tiene `fichas.generar` y esa acción pide
  PIN, el formulario de receta lo pide; la receta queda a nombre de la cuenta (si `recetas.*` no pide PIN) y las
  fichas, a nombre del empleado. Una cuenta de mostrador (sin `fichas.generar`) no ve ningún PIN.
- **El rol `LABORATORIO` incluye `recetas.crear` y `recetas.editar`**: la mesa de trabajo de la toma lee y edita la
  receta que está preparando, y sus consultas se autorizan con `recetas.crear`.
- **Un DT puede identificarse con su PIN** en una cuenta de sector para actos que no son exclusivos del DT.
- **"Crear producto" dentro de la importación de factura** no pasa por un formulario: si `drogas.crear` pide PIN,
  desde una cuenta de sector se rechaza con un mensaje claro; el alta se hace desde Catálogos › Drogas.
- Cualquiera en la terminal puede agotar los intentos del PIN de un compañero y bloqueárselo. Queda auditado
  (S9). Es el mismo compromiso ya aceptado para la co-firma del DT.

## Verificación (preparada para biometría)

`modules/auth/domain/verificacion-identidad.ts` define el contrato: `MetodoVerificacion`, la unión discriminada
`PruebaDeIdentidad` y la interfaz `VerificadorDeIdentidad`. Hoy hay una implementación, `verificador-pin.ts`.

Agregar un método (WebAuthn, huella): una variante más de `PruebaDeIdentidad`, un verificador más en `VERIFICADORES`
(`modules/auth/application/verificar-operador.ts`) y su entrada en el diálogo. El pipeline, la auditoría
(`contexto.verificacion` registra el método) y los comandos no cambian.

## Cómo viaja la credencial

1. El formulario envía; si la acción pide PIN se abre el diálogo «¿Quién realiza esta acción?»
   (`modules/operadores/ui/operador-provider.tsx`), que agrega `operadorId` + `operadorPin` al mismo `FormData`
   (`shared/ui/use-form-submit.ts`). Lo que el usuario cargó no se pierde. El formulario que declara su `accion`
   lo abre antes del primer envío; el que no, lo abre cuando el servidor responde `operador-required`.
2. La Server Action envuelve su cuerpo en `conOperador(formData, …)` (`shared/auth/operador-context.ts`), que deja
   la credencial disponible para esa solicitud. Ningún esquema zod ni firma de caso de uso la transporta.
3. `defineCommand` la verifica y decide a nombre de quién corre el comando.

Una Server Action nueva que ejecute una acción configurable **debe** envolverse con `conOperador`. Si no lo hace,
en una cuenta de sector el comando se rechaza con un mensaje claro: nunca se atribuye en silencio.

## Pantallas

- **Usuarios › Nuevo usuario**: interruptor "Cuenta de sector" (apagado = cuenta personal). Al tildarla el formulario pide solo el **nombre del
  sector** y el **email**; apellido, DNI y matrícula no aplican a un sector. El email sí hace falta: es el usuario
  con el que la cuenta inicia sesión (no tiene que ser una casilla real, el sistema no le envía correos). Como
  `fsj.usuario` exige apellido y DNI, se derivan del nombre (`modules/usuarios/domain/cuenta-de-sector.ts`):
  "Laboratorio" queda como nombre "Sector", apellido "Laboratorio" y DNI `SECTOR-LABORATORIO`, que además impide
  dos cuentas de sector con el mismo nombre. El formulario pide una **contraseña** (y su repetición) que es la
  **definitiva**, con la política completa: una cuenta de sector no tiene PIN ni cambia su contraseña, así que nace
  `ACTIVO` sin pasos pendientes (decisión del usuario 2026-10-26; `openspec/specs/contrasena-temporal/spec.md`). La
  cambia solo un Administrador, con «Restablecer credencial» en el detalle del usuario (también definitiva).
- **Usuarios › detalle › Datos**: una cuenta de sector se edita como se crea, con solo el **nombre del sector** y el
  **email**; `editarUsuario` vuelve a derivar apellido y DNI del nombre (sin matrícula), sin pedir DNI.
- **Mi cuenta** (`/cuenta`): una cuenta de sector no ve ni el panel de PIN ni el de contraseña, solo una nota
  (`cambiarPassword` también la rechaza en el servidor). Una cuenta personal cambia su contraseña (con la actual) y su
  PIN. Para nadie existe «Eliminar PIN» (el PIN es obligatorio para quien no es cuenta de sector).
- **Configuración › PIN por acción** (`/admin/configuracion/pin`): un interruptor por acción.
- Diálogo de empleado + PIN en los formularios de laboratorio, stock, drogas, recetas y entregas.
- **Auditoría**: "Realizado desde la cuenta de sector X · identificado con PIN".

## Invariantes nuevas

| Código | Regla |
|---|---|
| INV-SEC-001 | Una cuenta de sector no tiene el rol `ADMINISTRADOR` ni `DIRECTOR_TECNICO`. |
| INV-SEC-002 | `usuario.es_sector` no cambia después del alta. |

## Código

- Dominio y verificación: `modules/auth/domain/{permisos,session,verificacion-identidad,operador-policy}.ts`,
  `modules/auth/application/{verificar-operador,verificador-pin,validate-session}.ts`.
- Pipeline: `shared/usecase.ts` (`resolverActor`), `shared/auth/{operador,operador-context,operador-campos}.ts`,
  `shared/audit/index.ts`.
- Configuración y selector: `modules/operadores/`.
- Tests: `tests/unit/cuentas-de-sector-*.test.ts`, `tests/unit/contrasena-temporal-operadores.test.ts`,
  `tests/unit/usecase-registry-all-modules.test.ts`,
  `tests/db/auth-permisos.test.ts` (plantilla de roles).

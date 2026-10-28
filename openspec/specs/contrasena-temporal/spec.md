# Contraseña temporal, cambio obligatorio y PIN obligatorio

## Purpose

El Administrador, al dar de alta un usuario, le asigna una contraseña temporal elegida manualmente en reemplazo del código de activación, exigiendo el cambio de contraseña y la configuración de PIN tras el primer inicio de sesión (decisiones del usuario del 2026-10-22, 2026-10-23 y 2026-10-26).

## Requirements

### Requirement: CT1 — Almacenamiento y auditoría segura de contraseña temporal

La contraseña temporal MUST NOT ser guardada ni auditada en texto claro en ninguna capa del sistema (base de datos, auditoría, logs o respuestas al cliente); solo su hash argon2id MUST ser persistido.

#### Scenario: Creación o restablecimiento de usuario con contraseña temporal
- **GIVEN** un formulario de alta de usuario o restablecimiento de credenciales con una contraseña temporal ingresada
- **WHEN** el comando procesa y persiste la operación
- **THEN** en la base de datos y en los registros de auditoría se almacena únicamente el hash argon2id sin rastro del texto en claro

### Requirement: CT2 — Bloqueo general por cambio de contraseña pendiente

Cuando un usuario tiene debe_cambiar_password en true, ningún caso de uso de negocio del sistema SHALL ejecutarse, con la única excepción de los casos de uso propios del flujo obligatorio de cambio de credenciales y cierre de sesión.

#### Scenario: Usuario con cambio de contraseña pendiente intenta ejecutar caso de uso
- **GIVEN** una sesión activa de un usuario con debe_cambiar_password en verdadero
- **WHEN** intenta invocar un comando o consulta del sistema fuera del flujo de cambio de credenciales
- **THEN** el sistema rechaza la ejecución lanzando un error tipado de pasos pendientes

### Requirement: CT3 — Bloqueo general por PIN pendiente

Un usuario que no sea cuenta de sector ni usuario exceptuado y no tenga PIN configurado (pin_hash nulo) SHALL NOT ejecutar ningún caso de uso del sistema, salvo los casos de uso autorizados del flujo obligatorio y cierre de sesión.

#### Scenario: Usuario sin PIN intenta ejecutar caso de uso ordinario
- **GIVEN** un usuario activo sin cuenta de sector que tiene pin_hash nulo
- **WHEN** intenta invocar una acción ordinaria del sistema
- **THEN** el sistema bloquea la acción exigiendo la configuración obligatoria del PIN

### Requirement: CT4 — Desactivación de debe_cambiar_password únicamente por el titular

El indicador debe_cambiar_password MUST volver al valor false únicamente como resultado del cambio exitoso de contraseña realizado por el propio usuario titular.

#### Scenario: Titular completa cambio de contraseña
- **GIVEN** un usuario con debe_cambiar_password en verdadero autenticado en su sesión
- **WHEN** ingresa su nueva contraseña cumpliendo la política completa
- **THEN** el sistema actualiza el hash de contraseña y establece debe_cambiar_password en falso

### Requirement: CT5 — Preservación de PIN en restablecimiento de credenciales

La ejecución del caso de uso restablecerCredencial por parte de un Administrador MUST NOT modificar ni eliminar el valor de pin_hash del usuario.

#### Scenario: Restablecimiento de credencial a usuario con PIN
- **GIVEN** un usuario activo que posee un PIN configurado
- **WHEN** un Administrador le asigna una nueva contraseña temporal mediante restablecerCredencial
- **THEN** el usuario recibe la nueva contraseña temporal con debe_cambiar_password en verdadero conservando su pin_hash intacto

### Requirement: CT6 — Exención de pasos pendientes y prohibición de cambio de clave en cuentas de sector

Las cuentas de sector SHALL NOT recibir pasos pendientes («Configurar PIN» ni «Cambiar contraseña»), aunque una fila anterior conserve `debe_cambiar_password = true`, y SHALL NOT cambiar su propia contraseña; el comando cambiarPassword MUST rechazarlas y «Mi cuenta» SHALL NOT mostrar el formulario.

#### Scenario: Inicio de sesión de cuenta de sector
- **GIVEN** una sesión activa de cuenta de sector
- **WHEN** se evalúan los pasos obligatorios posteriores al login
- **THEN** no se genera ningún paso pendiente permitiendo el acceso directo a sus funciones autorizadas

#### Scenario: Intento de cambiar contraseña desde cuenta de sector
- **GIVEN** una sesión de cuenta de sector
- **WHEN** se intenta invocar el comando cambiarPassword
- **THEN** el servidor rechaza la solicitud

### Requirement: CT7 — Inhabilitación de operador con cambio de contraseña pendiente

Un empleado con debe_cambiar_password en true SHALL NOT poder identificarse como operador en una cuenta de sector aunque ingrese su PIN correcto, y dicho rechazo SHALL NOT computar como intento fallido de PIN.

#### Scenario: Exclusión del listado de operadores
- **GIVEN** un empleado con debe_cambiar_password en verdadero
- **WHEN** se consulta el listado de operadores disponibles en una cuenta de sector
- **THEN** el selector de operadores excluye al usuario

#### Scenario: Rechazo de PIN de operador con cambio pendiente
- **GIVEN** un empleado con debe_cambiar_password en verdadero que intenta identificarse con PIN
- **WHEN** se valida la credencial de operador
- **THEN** el sistema rechaza la identificación sin computar intentos fallidos de PIN

### Requirement: CT8 — Inhabilitación de co-firma de Director Técnico con cambio pendiente

Un Director Técnico con debe_cambiar_password en true SHALL NOT poder co-firmar en stock, libro o pesada real aunque ingrese su contraseña correcta; dicho rechazo SHALL NOT computar intentos fallidos ni bloquear al usuario.

#### Scenario: Intento de co-firma por DT con contraseña temporal
- **GIVEN** un Director Técnico con debe_cambiar_password en verdadero
- **WHEN** intenta autorizar una co-firma ingresando su contraseña vigente
- **THEN** el sistema rechaza la co-firma mostrando al operador el mensaje genérico habitual, registrando el motivo interno en la auditoría sin sumar intentos fallidos ni bloquear al DT

### Requirement: CT9 — Exención de PIN para usuarios exclusivamente Administradores

Un usuario cuyo único rol asignado sea Administrador SHALL NOT recibir el paso «Configurar PIN»; cuando posea el rol de Administrador combinado con otro rol operativo, dicho paso MUST ser exigido si carece de PIN.

#### Scenario: Administrador sin otros roles
- **GIVEN** un usuario cuyo único rol es Administrador y carece de PIN
- **WHEN** inicia sesión
- **THEN** el sistema no le exige el paso Configurar PIN y configurarPinObligatorio rechaza cualquier intento con el mensaje «El Administrador no usa PIN.»

#### Scenario: Administrador con rol operativo adicional
- **GIVEN** un usuario con rol Administrador y además otro rol operativo sin PIN configurado
- **WHEN** inicia sesión y cambia su contraseña temporal
- **THEN** el sistema exige el paso obligatorio Configurar PIN

### Requirement: Política de longitud y complejidad de contraseñas

La contraseña temporal asignada por el Administrador MUST tener al menos 6 caracteres sin exigir mayúsculas. La contraseña definitiva elegida por el usuario o asignada a una cuenta de sector MUST cumplir la política completa de al menos 8 caracteres y una mayúscula.

#### Scenario: Asignación de contraseña temporal válida
- **GIVEN** un Administrador completando el formulario de alta o restablecimiento
- **WHEN** ingresa una contraseña de 6 caracteres sin mayúsculas
- **THEN** la validación de contraseña temporal la acepta exitosamente

#### Scenario: Elección de contraseña definitiva por el usuario
- **GIVEN** un usuario en el paso obligatorio de cambio de contraseña
- **WHEN** ingresa una contraseña que no cumple con al menos 8 caracteres o carece de mayúscula
- **THEN** el sistema rechaza el cambio exigiendo el cumplimiento de la política completa

### Requirement: Alta de usuario con contraseña temporal

En el alta de usuarios individuales, el formulario MUST solicitar contraseña temporal y su repetición validando que coincidan. El usuario MUST crearse en estado ACTIVO con debe_cambiar_password en true, sin generar códigos de activación ni credenciales con vencimiento.

#### Scenario: Alta exitosa de usuario individual
- **GIVEN** el formulario de nuevo usuario individual
- **WHEN** se ingresan datos válidos junto con la contraseña temporal y su repetición coincidente
- **THEN** el usuario se crea en estado ACTIVO con debe_cambiar_password en verdadero sin emitir código de activación

#### Scenario: Contraseñas no coincidentes en el alta
- **GIVEN** el formulario de nuevo usuario
- **WHEN** el valor de contraseña temporal y su repetición difieren
- **THEN** el formulario rechaza el envío con un error de campo

### Requirement: Restablecimiento de credenciales por Administrador

El comando restablecerCredencial MUST recibir una nueva contraseña temporal y su confirmación, revocar todas las sesiones del usuario, resetear intentos_fallidos y bloqueado_hasta, y marcar debe_cambiar_password en true, manteniendo suspendidos a los usuarios en dicho estado y rechazando la operación si el usuario está en BAJA.

#### Scenario: Restablecimiento a usuario activo o pendiente de activación
- **GIVEN** un usuario en estado ACTIVO o PENDIENTE_ACTIVACION
- **WHEN** un Administrador ejecuta restablecerCredencial
- **THEN** el usuario queda en estado ACTIVO con debe_cambiar_password en verdadero, sesiones revocadas e intentos fallidos en cero

#### Scenario: Restablecimiento a usuario suspendido
- **GIVEN** un usuario en estado SUSPENDIDO
- **WHEN** se ejecuta restablecerCredencial
- **THEN** el usuario conserva el estado SUSPENDIDO con su nueva contraseña asignada

#### Scenario: Restablecimiento de credencial a usuario en estado BAJA
- **GIVEN** un usuario en estado BAJA
- **WHEN** un Administrador intenta ejecutar restablecerCredencial
- **THEN** la operación es rechazada impidiendo restablecer credenciales a usuarios dados de baja

### Requirement: RP1 — Restablecimiento de PIN por el Administrador

El comando restablecerPin SHALL requerir el permiso usuarios.credencial.restablecer, el mismo de restablecerCredencial, y MUST rechazarse cuando el usuario destino es quien lo ejecuta (RP2): el titular cambia su propio PIN desde «Mi cuenta» con su contraseña actual. Una cuenta de sector nunca lo ejecuta, porque ese permiso está en PERMISOS_VEDADOS_A_SECTOR (decisión del usuario 2026-10-28).

#### Scenario: Administrador restablece el PIN de otro usuario
- **GIVEN** un Administrador con usuarios.credencial.restablecer y un usuario activo con PIN
- **WHEN** el Administrador ejecuta «Restablecer PIN» sobre ese usuario
- **THEN** el PIN del usuario queda borrado

#### Scenario: Administrador intenta restablecer su propio PIN
- **GIVEN** un Administrador con un rol operativo adicional y PIN propio
- **WHEN** ejecuta restablecerPin sobre sí mismo
- **THEN** la operación es rechazada y se le indica cambiarlo desde «Mi cuenta»

### Requirement: RP3 — Usuarios a los que no se restablece el PIN

El comando restablecerPin MUST rechazarse, sin escribir ni auditar el cambio, cuando el usuario destino está en BAJA, es una cuenta de sector, tiene como único rol Administrador o no tiene un PIN configurado.

#### Scenario: Usuario sin PIN configurado
- **GIVEN** un usuario suspendido, pendiente de activación o que todavía no configuró su PIN
- **WHEN** un Administrador ejecuta restablecerPin sobre él
- **THEN** la operación es rechazada con «El usuario no tiene un PIN configurado.»

#### Scenario: Cuenta de sector o Administrador exclusivo
- **GIVEN** una cuenta de sector o un usuario cuyo único rol es Administrador
- **WHEN** un Administrador ejecuta restablecerPin sobre él
- **THEN** la operación es rechazada porque ese usuario no usa PIN

### Requirement: RP4 — Efecto del restablecimiento de PIN

restablecerPin MUST dejar pin_hash en NULL, pin_intentos_fallidos en 0, pin_bloqueado en false y actualizar pin_actualizado_en, en una sola transacción, y SHALL NOT modificar la contraseña, debe_cambiar_password, el estado, los roles ni las sesiones del usuario (RP5). El paso «Configurar PIN» MUST surgir por derivación (CT3) en la siguiente solicitud del usuario, sin columna nueva.

#### Scenario: Usuario con sesión abierta tras el restablecimiento
- **GIVEN** un usuario con sesión abierta al que un Administrador le restableció el PIN
- **WHEN** el usuario navega o envía un formulario
- **THEN** es llevado al paso «Configurar PIN», conserva lo cargado en el formulario y sigue entrando con su contraseña de siempre

#### Scenario: Usuario con el PIN bloqueado
- **GIVEN** un usuario cuyo PIN quedó bloqueado por intentos fallidos de reautenticación
- **WHEN** un Administrador le restablece el PIN
- **THEN** el bloqueo y el contador quedan en cero y el usuario configura un PIN nuevo

### Requirement: RP6 — Concurrencia del restablecimiento de PIN

restablecerPin MUST bloquear la fila del usuario destino antes de leerla, en el mismo orden que el resto de los comandos de usuarios, de modo que dos restablecimientos simultáneos produzcan un único éxito y un único registro de auditoría.

#### Scenario: Doble envío del restablecimiento
- **GIVEN** un usuario con PIN
- **WHEN** dos Administradores, o un doble clic, envían restablecerPin a la vez
- **THEN** uno tiene éxito y el otro es rechazado con «El usuario no tiene un PIN configurado.»

### Requirement: RP7 — Auditoría del restablecimiento de PIN

restablecerPin SHALL auditarse como RESTABLECER_CREDENCIAL sobre la entidad usuario, con el motivo «Restablecimiento de PIN por el Administrador.», valorAnterior { pinBloqueado } y valorNuevo { pin: "restablecido", pinBloqueado: false }, y MUST NOT registrar el PIN ni su hash.

#### Scenario: Registro de auditoría del restablecimiento
- **GIVEN** un restablecimiento de PIN exitoso
- **WHEN** se consulta /auditoria
- **THEN** figura un restablecimiento de credencial con el motivo de PIN y sin el valor del PIN

### Requirement: RP8 — Identificación en cuenta de sector tras el restablecimiento

Mientras no configure un PIN nuevo, el usuario MUST NOT poder identificarse como operador en una cuenta de sector (S7, S8): ningún PIN lo identifica.

#### Scenario: Empleado identificándose con el PIN borrado
- **GIVEN** un empleado al que se le restableció el PIN
- **WHEN** ingresa su PIN anterior en una cuenta de sector
- **THEN** la acción es rechazada sin atribuirse a nadie y el formulario conserva lo cargado

### Requirement: Secuencia de pasos obligatorios tras inicio de sesión

Tras el inicio de sesión, el usuario MUST completar los pasos obligatorios en orden estricto: primero «Cambiar contraseña» si debe_cambiar_password es true, donde la nueva contraseña no MUST ser igual a la temporal, y posteriormente «Configurar PIN» si pin_hash es nulo en usuarios no exceptuados.

#### Scenario: Secuencia completa de pasos obligatorios
- **GIVEN** un usuario nuevo con contraseña temporal que requiere PIN
- **WHEN** inicia sesión por primera vez
- **THEN** el sistema lo dirige al paso 1 de cambio de contraseña, y una vez completado, lo dirige al paso 2 de configuración de PIN

#### Scenario: Revocación de otras sesiones al cambiar contraseña temporal
- **GIVEN** un usuario completando el paso 1 que posee otras sesiones abiertas
- **WHEN** completa el cambio de contraseña exitosamente
- **THEN** el sistema persiste la nueva contraseña, revoca las otras sesiones activas manteniendo la actual, y audita MODIFICAR

#### Scenario: Rechazo de contraseña nueva idéntica a la temporal
- **GIVEN** un usuario en el paso 1 de cambio de contraseña
- **WHEN** ingresa una nueva contraseña idéntica a la contraseña temporal
- **THEN** el sistema rechaza la nueva contraseña impidiendo su reutilización

### Requirement: Bloqueo estricto de navegación y casos de uso por pasos pendientes

El layout de navegación MUST redirigir al grupo de rutas fuera de app/(app) correspondiente al paso pendiente. La función requireSession MUST lanzar un error tipado ante cualquier invocación con pasos pendientes, salvo en las rutas autorizadas del flujo y cierre de sesión. Si el bloqueo salta en una Server Action con un formulario abierto, el error MUST retornar como error de formulario con enlace al paso pendiente preservando lo escrito.

#### Scenario: Redirección de pantalla por paso pendiente
- **GIVEN** un usuario con pasos pendientes navegando por el sistema
- **WHEN** intenta acceder a cualquier página dentro de app/(app)
- **THEN** el layout lo redirige inmediatamente a la pantalla del paso pendiente correspondiente

#### Scenario: Invocación de Server Action con formulario abierto
- **GIVEN** un usuario con formulario abierto cuya sesión requiere configurar PIN
- **WHEN** envía la Server Action
- **THEN** el sistema responde con error de formulario preservando los datos ingresados y proveyendo un enlace al paso pendiente

### Requirement: Eliminación de la opción de eliminar PIN

La opción de eliminar PIN SHALL NOT estar disponible en la pantalla /cuenta ni en el backend para ningún usuario; las cuentas de sector y los usuarios con rol exclusivo de Administrador SHALL NOT visualizar panel de PIN en /cuenta. El servidor MUST rechazar cualquier invocación a configurarPin para cuentas de sector y usuarios cuyo único rol es Administrador.

#### Scenario: Consulta de opciones en /cuenta
- **GIVEN** un usuario autenticado accediendo a /cuenta
- **WHEN** visualiza las opciones disponibles
- **THEN** no existe opción para eliminar el PIN

#### Scenario: Panel de PIN ausente para Administrador exclusivo
- **GIVEN** un usuario cuyo único rol es Administrador
- **WHEN** accede a /cuenta
- **THEN** el panel de configuración de PIN se encuentra oculto y el servidor rechaza cualquier llamada a configurarPin

### Requirement: Bootstrap del Administrador inicial de tenant

El script create-tenant MUST recibir la contraseña temporal por argumento o consola e insertar al Administrador inicial en estado ACTIVO con debe_cambiar_password en true sin generar códigos de activación.

#### Scenario: Ejecución de create-tenant
- **GIVEN** la ejecución del script create-tenant para inicializar una farmacia
- **WHEN** se provee la contraseña temporal inicial
- **THEN** el Administrador nace en estado ACTIVO con debe_cambiar_password en verdadero y accede al flujo obligatorio en su primer inicio de sesión

### Requirement: Migración y tratamiento de usuarios pendientes de activación

Los usuarios en estado PENDIENTE_ACTIVACION previos a la migración 0097 SHALL NOT poder iniciar sesión y sus códigos quedan revocados; su única salida es la asignación de una contraseña temporal mediante restablecerCredencial (pasando a ACTIVO) o la baja.

#### Scenario: Intento de uso de código de activación revocado
- **GIVEN** un usuario que se encontraba PENDIENTE_ACTIVACION antes de la migración 0097
- **WHEN** intenta utilizar su código previo en el sistema
- **THEN** el código resulta inoperativo y el acceso permanece bloqueado hasta que el Administrador restablezca su credencial

### Requirement: Vigencia indefinida de la contraseña temporal

La contraseña temporal asignada por el Administrador SHALL NOT tener plazo de vencimiento, permaneciendo válida indefinidamente hasta que el usuario titular la cambie.

#### Scenario: Inicio de sesión con contraseña temporal sin vencimiento
- **GIVEN** un usuario con contraseña temporal asignada
- **WHEN** inicia sesión transcurrido cualquier lapso de tiempo sin haberla cambiado previamente
- **THEN** el sistema valida la credencial y exige los pasos obligatorios correspondientes

### Requirement: Auditoría de alta y restablecimiento sin contraseña en claro

El alta de usuario MUST auditarse bajo la acción CREAR junto con un ASIGNAR_ROL por rol, y el restablecimiento bajo RESTABLECER_CREDENCIAL registrando el estado resultante en valorNuevo, en ambos casos sin incluir la contraseña ni su hash.

#### Scenario: Registro de auditoría en alta y restablecimiento de credenciales
- **WHEN** un Administrador crea un usuario o restablece su credencial
- **THEN** los eventos de auditoría se registran consignando los roles y estados sin exponer la contraseña ni su hash

### Requirement: Ausencia de contraseña en el paso obligatorio de PIN

En el paso obligatorio «Configurar PIN», el formulario MUST solicitar el PIN dos veces con validación de validatePin y SHALL NOT solicitar la contraseña del usuario.

#### Scenario: Configuración de PIN en paso obligatorio sin requerir contraseña
- **GIVEN** un usuario en el paso obligatorio de configuración de PIN
- **WHEN** visualiza y completa el formulario
- **THEN** se le solicita el PIN y su repetición sin requerir el ingreso de su contraseña

## Estado

Estado: implementado 2026-10-22 (migración 0097). Reversión: `docs/rollbacks/contrasena-temporal.md`.

> Decisiones del usuario (2026-10-22):
> - El Administrador, al dar de alta un usuario, le **asigna una contraseña temporal**. Reemplaza al código de activación de un solo uso (72 h) y a la pantalla `/activar`.
> - Con esa contraseña la persona **inicia sesión normalmente**. Antes de poder usar el sistema tiene que (1) **cambiar la contraseña** por una propia y (2) **configurar su PIN**.
> - La contraseña temporal **no vence**: vale hasta que la persona la cambie.
> - «Restablecer credencial» funciona igual que el alta: el Administrador asigna una nueva contraseña temporal. **El PIN se conserva**; solo se obliga a cambiar la contraseña.
> - El PIN pasa a ser **obligatorio para todo usuario que no sea cuenta de sector**, también para los que ya estaban activos sin PIN: lo configuran la próxima vez que usen el sistema.
> - La contraseña temporal que escribe el Administrador (alta, «Restablecer credencial» y primer admin de `create-tenant`) necesita **al menos 6 caracteres**, sin exigir mayúscula (2026-10-23). La contraseña que la persona elige para sí misma (paso 1, «Mi cuenta») mantiene la política completa: 8 caracteres y una mayúscula (12 hasta el 2026-10-26).
> - El usuario cuyo único rol es Administrador no tiene PIN (2026-10-23): el Administrador no ejerce actos operativos. Con otro rol además, sí.
> - Las **cuentas de sector** no tienen PIN ni cambian su contraseña (decisión del usuario 2026-10-26, reemplaza a «solo es obligatorio el cambio de contraseña»): la contraseña que escribe el Administrador en el alta o en «Restablecer credencial» es la definitiva, así que cumple la política completa. No tienen ningún paso pendiente.
> - Mientras una persona tenga pendiente el cambio de contraseña, **no puede identificarse con su PIN en las cuentas de sector** (aunque conserve el PIN tras un restablecimiento).
> - Los usuarios que al desplegar estén `PENDIENTE_ACTIVACION` con un código sin usar: el código deja de servir y el Administrador les asigna una contraseña temporal con «Restablecer credencial».

Las decisiones marcadas **[decisión técnica]** no las tomó el usuario; son la opción por defecto del diseño y se pueden revisar.

## Por qué

El código de activación obligaba a entregar un string de ~43 caracteres que se muestra una sola vez, a usar una pantalla aparte (`/activar`) y a reemitirlo si vencía. Con una contraseña temporal elegida por el Administrador, la entrega es simple y el primer ingreso es el login de siempre. El PIN obligatorio asegura que todo empleado pueda identificarse en las cuentas de sector y en las acciones que piden PIN.

## Alcance

**Entra**
- Alta de usuario con contraseña temporal (`crearUsuario`, formulario `/admin/accesos/usuarios/nuevo`).
- «Restablecer credencial» con contraseña temporal (`restablecerCredencial`, su UI en el detalle del usuario).
- Paso obligatorio de cambio de contraseña y paso obligatorio de PIN después del login, con bloqueo de todo el resto del sistema mientras estén pendientes.
- Bootstrap del primer Administrador de un tenant (`scripts/create-tenant.ts`) con contraseña temporal.
- Retiro del flujo de activación por código (`/activar`, `activarCuenta`, componente `CredencialActivacion`).
- Migración `0097` + rollback.

**No entra**
- Vencimiento de la contraseña temporal (decisión: no vence).
- Envío de la contraseña por mail u otro canal: el Administrador la entrega en mano.
- Cambios a la política de la contraseña que elige la persona (`validatePassword`) o de PIN (`validatePin`). La contraseña temporal tiene su propia política más corta (ver Reglas → Alta).
- Eliminar el valor `PENDIENTE_ACTIVACION` del enum `EstadoUsuario` (queda como estado heredado, ver Modelo).

**Anti-objetivos** (aunque «funcione», sería un error)
- Que un usuario con un paso pendiente pueda ejecutar cualquier caso de uso de negocio o ver datos, aunque sea por una navegación cliente o una Server Action invocada directamente.
- Que la contraseña temporal quede en texto plano en algún lado: BD, auditoría, logs, estado del formulario devuelto al cliente.
- Que restablecer la credencial borre el PIN.

## Modelo

### Columna nueva `usuario.debe_cambiar_password`

`boolean NOT NULL DEFAULT false`. `true` cuando la contraseña vigente la asignó un Administrador (alta, restablecimiento, bootstrap). Vuelve a `false` solo cuando el propio usuario cambia su contraseña.

- `fsj_app` recibe `GRANT UPDATE (debe_cambiar_password)` (mismo patrón de grants por columna que la migración 0002).
- **[decisión técnica]** No hay columna «debe configurar PIN»: la obligación se **deriva** de `pin_hash IS NULL AND NOT es_sector`. Así también alcanza a los usuarios ya activos sin PIN y a los que pierden el PIN al ser suspendidos (`cambiarEstadoUsuario` limpia el PIN al salir de `ACTIVO`).

### Estados

- **[decisión técnica]** El usuario nuevo nace `ACTIVO` (con `password_hash` y `debe_cambiar_password = true`). Un insert directo en `ACTIVO` ya está permitido por el trigger (`trg_usuario_validar_transicion_estado` solo mira `UPDATE OF estado`).
- `PENDIENTE_ACTIVACION` deja de usarse para altas nuevas. Sigue existiendo en el enum para los usuarios que estén pendientes al desplegar; su única salida es «Restablecer credencial» (que los pasa a `ACTIVO`) o la baja.
- `login` y `validateSession` siguen exigiendo `estado = ACTIVO`: no cambian.

### `credencial_activacion`

- **[decisión técnica]** La tabla **se conserva** (historial y auditoría de credenciales emitidas), pero el código deja de escribir y de leer en ella.
- La migración `0097` revoca toda credencial viva (`revocada_en = now()` donde `usada_en IS NULL AND revocada_en IS NULL`), para que no quede ninguna fila «activa».

## Reglas

### Alta (`crearUsuario`)

- El formulario agrega **Contraseña temporal** y **Repetir contraseña temporal** para personas, y **Contraseña** y **Repetir contraseña** para cuentas de sector (definitiva).
- Se valida con la política de contraseña temporal (`validateTemporaryPassword`): al menos 6 caracteres, sin exigir mayúscula. La contraseña que la persona elige después (paso 1) mantiene la política completa (`validatePassword`: 8 caracteres y una mayúscula). Si las dos no coinciden, error de campo.
- Una cuenta de sector usa la política completa (`validatePassword`): su contraseña no se cambia después (`refinarPasswordTemporal(…, esSector)`).
- Se guarda solo el hash (argon2id, `hashPassword`), con `estado = ACTIVO` y `debe_cambiar_password = true` (`false` para una cuenta de sector).
- No se genera código; `CrearUsuarioResult` deja de tener `credencial` y `credencialVenceEn`.
- Al terminar bien, se vuelve al detalle del usuario (o al listado) con un toast. La contraseña **no** se vuelve a mostrar: el Administrador ya la conoce porque la escribió.
- Auditoría: la de hoy (`CREAR` + un `ASIGNAR_ROL` por rol), sin la contraseña ni su hash.
- **[decisión técnica]** Un usuario con un paso pendiente no puede ejecutar acciones de terceros, así que la regla INV-U07 sobre el emisor deja de aplicarse a credenciales nuevas: no se emiten más.

### Restablecer credencial (`restablecerCredencial`)

- Pasa a ser un formulario con **Contraseña temporal** y **Repetir contraseña temporal** (misma validación que el alta).
- Efectos, en una transacción:
  - Guarda el nuevo hash y `debe_cambiar_password = true`.
  - Revoca todas las sesiones del usuario.
  - Resetea `intentos_fallidos` y `bloqueado_hasta`.
  - **No toca el PIN.**
- Estado:
  - `PENDIENTE_ACTIVACION` → `ACTIVO` (salida de los pendientes heredados).
  - `ACTIVO` queda `ACTIVO`.
  - **[decisión técnica]** `SUSPENDIDO` queda `SUSPENDIDO`: restablecer la contraseña no reactiva a nadie. Al reactivarlo podrá entrar con la temporal.
  - `BAJA`: se rechaza, igual que hoy.
- Se mantienen la regla «no sobre sí mismo» y el lock de `admin-guard`.
- Auditoría `RESTABLECER_CREDENCIAL`, sin la contraseña. `valorNuevo` registra el estado resultante.
- `cambiarEstadoUsuario` hoy limpia el PIN al salir de `ACTIVO`. Restablecer ya no saca al usuario de `ACTIVO`, así que el PIN se conserva.

### Pasos obligatorios después del login

Una sesión tiene **pasos pendientes** si no es de una cuenta de sector (que nunca tiene pasos, aunque una fila anterior conserve `debe_cambiar_password = true`) y:

1. `debe_cambiar_password = true` → paso **Cambiar contraseña**.
2. El paso 1 no está pendiente, `pin_hash IS NULL` y el usuario no es cuenta de sector, ni el usuario técnico SISTEMA (que nunca inicia sesión), ni un usuario cuyo único rol es Administrador (`rol.es_administrador`; con Administrador más otro rol, sí) → paso **Configurar PIN**. `configurarPinObligatorio` rechaza al usuario solo-Administrador («El Administrador no usa PIN.»).

Siempre en ese orden: el PIN se pide recién después del cambio de contraseña.

**Paso 1 — Cambiar contraseña**
- Pide la nueva contraseña dos veces y muestra los requisitos (`NewPasswordFields`).
- **[decisión técnica]** No pide la contraseña actual: la temporal se acaba de usar para iniciar sesión.
- **[decisión técnica]** La nueva no puede ser igual a la temporal.
- Si sale bien: guarda el hash, `debe_cambiar_password = false`, revoca las **otras** sesiones (la actual sigue, igual que `cambiarPassword`) y audita `MODIFICAR` con motivo «Cambio de contraseña temporal por el propio usuario».

**Paso 2 — Configurar PIN**
- Pide el PIN dos veces, con la misma validación de `validatePin` (4 dígitos, no triviales).
- No pide la contraseña (decisión del usuario).
- Audita lo mismo que `configurarPin` hoy, sin el PIN ni su hash.

**Bloqueo** (las dos capas son obligatorias)
- **Páginas**: el layout de `app/(app)` redirige a la pantalla del paso pendiente. Las pantallas de los pasos viven **fuera** de `app/(app)` (grupo propio con layout mínimo, sin sidebar), para no generar bucles de redirección.
- **Sesión**: **[decisión técnica]** el bloqueo vive en `requireSession()`, no solo en `shared/usecase.ts`. Hay llamadores que usan `requireSession()` directamente (route handlers de `/api`, `page.tsx`, algunos casos de uso como `confirmar-preparacion.ts` o `anular-asiento.ts`) y un bloqueo solo en `defineCommand` / `defineQuery` los dejaría afuera. Con pasos pendientes, `requireSession()` lanza un error tipado (por ejemplo `PasosPendientesError`). Solo lo evitan, con una opción explícita (por ejemplo `requireSession({ permitirPasosPendientes: true })`), los casos de uso y las pantallas del propio flujo: cambiar contraseña, configurar PIN y logout. Esto cubre Server Actions llamadas directamente, navegaciones cliente que no re-renderizan el layout, `@modal` y `/api`.
- **Formularios abiertos**: **[decisión técnica]** si el bloqueo salta en una Server Action (caso típico: un usuario sin PIN con un formulario largo abierto en el momento del despliegue), el error tipado vuelve como un error del formulario («Antes de seguir tenés que configurar tu PIN», con link al paso). `use-form-submit` solo resetea si sale bien, así que lo escrito se conserva.
- La sesión expone el estado (por ejemplo `pasosPendientes: ("cambiar-password" | "configurar-pin")[]`), cargado junto con el resto de la sesión en `findSesionCompletaByTokenHash`.
- Desde las pantallas de los pasos el usuario siempre puede **cerrar sesión**.
- El login, al terminar bien, redirige directo al primer paso pendiente si lo hay.

### Identificación por PIN en cuentas de sector

Un empleado con `debe_cambiar_password = true` **no puede identificarse como operador** en una cuenta de sector, aunque tenga PIN. Se aplica en los dos lugares donde hoy se decide quién es operador válido (`openspec/specs/cuentas-de-sector/spec.md`):
- La lista de operadores candidatos (`operadores-repository.ts`) lo excluye.
- La verificación del PIN (`verificarOperadorEnTx` y su tabla de decisión `OperadorPolicy`) lo rechaza aunque el PIN sea correcto. Se trata como cualquier operador no válido: no suma intentos fallidos de PIN.

Cuando cambia su contraseña, vuelve a poder identificarse sin hacer nada más.

Lo mismo vale para la **co-firma del Director Técnico** (stock, libro y pesada real, que reutiliza la verificación de stock): un DT con `debe_cambiar_password = true` no puede co-firmar aunque su contraseña sea correcta. La tabla `decideCoFirma` devuelve `DEBE_CAMBIAR_PASSWORD` justo después de `INACTIVO` y antes de comparar la contraseña, así que no suma intentos fallidos ni bloquea; el mensaje al operador es el mismo genérico de siempre y el motivo interno queda en la auditoría. El selector de DT de la co-firma no lista a esos DT.

### Eliminar PIN

**[decisión técnica]** Con el PIN obligatorio, «Eliminar PIN» de `/cuenta` deja de tener sentido para un usuario que no sea de sector. Se quita esa opción (y `eliminarPin`). Cambiar el PIN sigue igual. Para las cuentas de sector se oculta el panel de PIN en `/cuenta`: no tienen PIN.

### Primer Administrador (`scripts/create-tenant.ts`)

- Recibe la contraseña temporal por argumento o prompt. Inserta al Administrador `ACTIVO`, con el hash y `debe_cambiar_password = true`.
- El primer login lo lleva a los dos pasos, como a cualquier usuario.
- Deja de generar e imprimir el código de activación.

### Despliegue

- Los usuarios `PENDIENTE_ACTIVACION` no pueden iniciar sesión (como hoy) y sus códigos quedan revocados por la migración. El Administrador los ve en el listado (filtro y badge «Pendiente») y les asigna una contraseña temporal con «Restablecer credencial».
- Los usuarios activos sin PIN no tienen que hacer nada distinto: en su próxima página o acción el sistema los lleva al paso «Configurar PIN».

## Pantallas

| Pantalla | Cambio |
|---|---|
| `/admin/accesos/usuarios/nuevo` | Agrega «Contraseña temporal» y «Repetir». Quita la pantalla «Usuario creado» con la credencial. Se cambia la descripción («Queda pendiente de activación…»). |
| Detalle del usuario → «Restablecer credencial» | Formulario con «Contraseña temporal» y «Repetir» en vez del botón que mostraba el código. |
| `/login` | Quita el link a `/activar`. Al entrar, redirige al paso pendiente si lo hay. |
| `/activar` | Se elimina (también de `PUBLIC_PATHS` en `proxy.ts`). |
| Paso «Cambiar contraseña» (nueva, fuera de `(app)`) | Nueva contraseña + repetir, requisitos visibles, botón «Cerrar sesión». |
| Paso «Configurar PIN» (nueva, fuera de `(app)`) | PIN + repetir, botón «Cerrar sesión». |
| Detalle del usuario → «PIN» (2026-10-28, RP1–RP8) | Estado del PIN («Configurado», «Bloqueado por intentos fallidos», «Sin configurar») y, si hay PIN, «Restablecer PIN» con confirmación. No se muestra para uno mismo, cuentas de sector, Administrador exclusivo ni BAJA. |
| `/cuenta` | Sin «Eliminar PIN». Sin panel PIN para cuentas de sector ni para el usuario cuyo único rol es Administrador; `configurarPin` además los rechaza en el servidor. |

Todos los formularios usan `shared/ui/use-form-submit.ts` y conservan lo escrito ante un error.

## Invariantes nuevas

| ID | Regla | Dónde |
|---|---|---|
| CT1 | La contraseña temporal nunca se guarda ni se audita en claro; solo su hash argon2id. | `crear-usuario.ts`, `restablecer-credencial.ts`, `create-tenant.ts` |
| CT2 | Con `debe_cambiar_password = true` ningún caso de uso, salvo los del flujo, se ejecuta. | `requireSession` + test |
| CT3 | Un usuario que no es de sector y no tiene PIN no ejecuta ningún caso de uso, salvo los del flujo. | `requireSession` + test |
| CT4 | `debe_cambiar_password` vuelve a `false` solo por el cambio de contraseña del propio usuario. | `cambiar-password.ts` / paso 1 |
| CT5 | Restablecer la credencial no modifica `pin_hash`. | `restablecer-credencial.ts` + test |
| CT6 | Las cuentas de sector nunca reciben pasos pendientes («Configurar PIN» ni «Cambiar contraseña») y no cambian su propia contraseña (`cambiarPassword` las rechaza; «Mi cuenta» no muestra el formulario). | `derivarPasosPendientes`, `cambiar-password.ts`, `app/(app)/cuenta/page.tsx` + test |
| CT7 | Un empleado con `debe_cambiar_password = true` no se identifica como operador en una cuenta de sector, aunque su PIN sea correcto. | `verificar-operador.ts`, `operadores-repository.ts` + test |
| CT8 | Un DT con `debe_cambiar_password = true` no puede co-firmar (stock, libro, pesada real) aunque su contraseña sea correcta; no suma intentos fallidos. | `modules/stock/domain/co-firma.ts`, `modules/{stock,libro}/infrastructure/co-firma-repository.ts`, `modules/{stock,libro}/application/verificar-co-firma-dt.ts` + `tests/unit/contrasena-temporal-co-firma.test.ts` |
| CT9 | Un usuario cuyo único rol es Administrador nunca recibe el paso «Configurar PIN»; con Administrador más otro rol, sí. | `esSoloAdministrador` y `derivarPasosPendientes` (`modules/auth/domain/pasos-pendientes.ts`), `validate-session.ts`, `loadPasosPendientes`, `configurar-pin-obligatorio.ts`, `app/(app)/cuenta/page.tsx` + `tests/unit/auth-pasos-pendientes.test.ts`, `tests/unit/auth-configurar-pin-obligatorio.test.ts` |

## Código

**Se agrega**
- `prisma/migrations/<timestamp>_0097_contrasena_temporal/migration.sql`: columna, grant y revocación de las credenciales vivas.
- `prisma/rollbacks/0097_contrasena_temporal.down.sql`.
- `docs/rollbacks/contrasena-temporal.md`.
- Las pantallas de los dos pasos y sus Server Actions.
- Los casos de uso del paso 1 y del paso 2 (o variantes de `cambiarPassword` / `configurarPin` sin la contraseña actual, limitadas a sesiones con el paso pendiente).

**Se modifica**
- `modules/usuarios/application/crear-usuario.ts`, `restablecer-credencial.ts`, `infrastructure/usuario-repository.ts`.
- `app/(app)/admin/accesos/usuarios/nuevo/*`, `modules/usuarios/ui/restablecer-credencial.tsx`, `modules/usuarios/ui/actions.ts`.
- `modules/auth/domain/session.ts`, `modules/auth/infrastructure/session-repository.ts`, `validate-session.ts`, `shared/usecase.ts`, `app/(app)/layout.tsx`.
- `app/(auth)/login/*`, `proxy.ts`, `app/(app)/cuenta/*`, `scripts/create-tenant.ts`, `shared/auth/policy.ts`.
- `modules/auth/application/verificar-operador.ts` (y `OperadorPolicy`), `modules/operadores/infrastructure/operadores-repository.ts`.
- `modules/stock/domain/co-firma.ts`, `modules/{stock,libro}/infrastructure/co-firma-repository.ts`, `modules/{stock,libro}/application/verificar-co-firma-dt.ts` (CT8).
- Specs y docs que mencionan la credencial de activación: `openspec/specs/cuentas-de-sector/spec.md`, `shared/auth/README.md`.

**Se elimina**
- `app/(auth)/activar/*`, `modules/auth/application/activar-cuenta.ts`, `modules/auth/domain/activation-policy.ts`, `modules/usuarios/ui/credencial-activacion.tsx`, `modules/auth/application/eliminar-pin.ts`.
- `consumeCredencialActivacion`, `activarUsuario`, `insertCredencialActivacion`, `revokeCredencialesActivas` (también su uso en `suspender-usuario.ts` y `dar-de-baja-usuario.ts`, junto con el `credencialesRevocadas` que devuelven) y `AUTH_POLICY.activationCredentialTtlHours`.
- `token.ts` se conserva: lo usan las sesiones.
- **[decisión técnica]** El permiso `auth.activar` queda en el catálogo (sacarlo de migraciones anteriores no aporta), pero ningún caso de uso lo usa.

**Tests a actualizar**: los de activación (`tests/db/auth-login-activacion.test.ts`, `tests/unit/auth-activation-policy.test.ts`, `auth-policy.test.ts`), los de alta y restablecimiento (`usuarios-crear-usuario-audit`, `cuentas-de-sector-alta`, `usuarios-m3-lock-order`, `roles-personalizables-usecases`, `tests/db/usuarios-admin`, `credenciales-sesiones`, `inv-u07-actor-activo`) y los nuevos de CT2–CT6.

## Desviaciones

Decisiones de implementación que precisan o difieren del texto de arriba.

- CT4: el literal `debeCambiarPassword: false` se admite en dos archivos: el repositorio de usuarios de auth (`modules/auth/infrastructure/usuario-repository.ts`, la única escritura) y `operadores-repository.ts` (un filtro `WHERE` de lectura para CT7). Los filtros de CT8 en los dos `co-firma-repository.ts` son SQL crudo (`u.debe_cambiar_password = false`), no contienen ese literal y por eso no están en la lista.
- Tras crear un usuario se vuelve a su detalle con `?creado=1` y se muestra un toast; no hay un toaster compartido en el layout, así que el detalle lo monta él mismo.
- El error tipado de pasos pendientes (`PASOS_PENDIENTES`) se suma al mapa de códigos HTTP (403) de los route handlers de `/api`. En las Server Actions vuelve como error de formulario con un link al paso.
- Suspender y dar de baja ya no revocan credenciales de activación (no se emiten más): `suspender-usuario.ts` y `dar-de-baja-usuario.ts` dejaron de devolver `credencialesRevocadas`.
- `create-tenant` recibe la contraseña con `--admin-password-temporal` o la pide por consola sin mostrarla.
- Las páginas de los pasos viven en el grupo de rutas `app/(pasos)`; `app/(app)/error.tsx` hace una carga completa para que el layout redirija al paso.

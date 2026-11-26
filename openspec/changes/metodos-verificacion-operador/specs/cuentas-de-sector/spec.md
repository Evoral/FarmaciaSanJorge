# Delta — Cuentas de sector: métodos de verificación del operador (registro único + huella)

> Decisión del usuario (2026-11-25): un solo registro de métodos de verificación; el PIN pasa a ser un método
> registrado sin cambio de comportamiento; se suma el método **huella** (lector que escribe un código + Enter);
> el Administrador habilita los métodos por farmacia. Qué acciones piden verificación no cambia
> (`accion_con_pin`, `PERMISOS_CON_PIN_*`, `/admin/configuracion/pin` conservan su nombre).
>
> Convención de este delta: «método» es un modo de verificación registrado (`PIN`, `HUELLA`); «prueba» es lo que el
> empleado presenta con ese método; «código» es la prueba de un método de código secreto (PIN o huella). Toda regla
> existente del PIN se conserva como la instancia PIN del requisito neutral; ninguna se elimina.

## MODIFIED Requirements

### Requirement: S1 — Rechazo de acción con PIN sin empleado identificado

Una acción con PIN (acción que exige verificación del empleado; el nombre se conserva) en una cuenta de sector SHALL NOT ejecutarse sin un empleado identificado en esa misma solicitud, sea cual sea el método con que se identifique. La solicitud MUST ser rechazada antes de abrir ninguna transacción de base de datos, rigiendo para todo comando, presente o futuro.

#### Scenario: Solicitud a acción con PIN sin empleado identificado en cuenta de sector
- **GIVEN** una sesión activa correspondiente a una cuenta de sector
- **AND** una acción configurada para requerir identificación por PIN
- **WHEN** se envía una solicitud para ejecutar dicha acción sin los datos del empleado y su PIN
- **THEN** el sistema rechaza la solicitud antes de abrir ninguna transacción

#### Scenario: Solicitud sin prueba de ningún método
- **GIVEN** una sesión activa de cuenta de sector y una acción que exige verificación
- **WHEN** se envía la solicitud sin ninguna prueba de verificación, de ningún método
- **THEN** el sistema rechaza la solicitud antes de abrir ninguna transacción

### Requirement: S2 — Verificación de PIN en cada acción

La prueba del empleado, con el método que sea, MUST verificarse en cada acción individual sin mantener un estado de operador activo persistente en el tiempo. Una acción compuesta que encadene varios comandos en la misma solicitud MUST verificar la prueba una sola vez, antes del primer comando; si la solicitud trae una prueba, también la verifica un comando que no la pide, de modo que una prueba errónea no deja nada guardado.

#### Scenario: Dos acciones consecutivas en la misma cuenta de sector
- **GIVEN** una cuenta de sector donde un empleado se identificó con su PIN para una acción previa
- **WHEN** se solicita una nueva acción posterior que requiere PIN
- **THEN** el sistema exige nuevamente el ingreso del PIN

#### Scenario: Dos acciones consecutivas identificadas con huella
- **GIVEN** una cuenta de sector donde un empleado se identificó con su huella para una acción previa
- **WHEN** se solicita una nueva acción posterior que exige verificación
- **THEN** el sistema exige nuevamente una prueba de verificación

#### Scenario: Acción que encadena múltiples comandos en una única solicitud
- **GIVEN** una cuenta de sector y una solicitud que involucra la ejecución de varios comandos encadenados con PIN
- **WHEN** se procesa la solicitud
- **THEN** el sistema verifica el PIN una sola vez para toda la secuencia de comandos

#### Scenario: Acción compuesta con un comando sin PIN y otro con PIN
- **GIVEN** una cuenta de sector donde `recetas.crear` no pide PIN y `fichas.generar` sí
- **WHEN** se guarda una receta con un PIN que no corresponde a ningún empleado
- **THEN** la receta no se guarda: el PIN que trae la solicitud se verifica antes de cada comando, aunque ese comando no pida PIN, y la acción se rechaza en el campo PIN

### Requirement: S5 — Auditoría con contexto de terminal de sector y método PIN

Toda fila de auditoría generada a nombre de un empleado desde una cuenta de sector MUST registrar en su campo contexto la terminal de origen con usuarioId, usuario y sesionId de la cuenta de sector, junto con el método de verificación usado, con el valor `PIN` o `HUELLA` según el método con que se identificó. La visualización de la auditoría MUST mostrar el nombre del método («identificado con PIN», «identificado con huella»).

#### Scenario: Registro de auditoría de acción ejecutada en cuenta de sector
- **GIVEN** una acción con PIN confirmada por un empleado desde una cuenta de sector
- **WHEN** se escribe el registro de auditoría
- **THEN** el registro contiene `contexto.terminal` con los datos de la cuenta de sector y `contexto.verificacion` con el valor `"PIN"`

#### Scenario: Registro de auditoría de acción identificada con huella
- **GIVEN** una acción que exige verificación confirmada por un empleado con su huella desde una cuenta de sector
- **WHEN** se escribe el registro de auditoría
- **THEN** el registro contiene `contexto.terminal` con los datos de la cuenta de sector y `contexto.verificacion` con el valor `"HUELLA"`
- **AND** el registro no contiene el código de la huella

### Requirement: S7 — Condiciones para calificar como operador

Solo un usuario de la farmacia en estado ACTIVO que no sea cuenta de sector ni usuario técnico, que posea una credencial configurada del método con que se identifica (PIN configurado para el método PIN, huella enrolada para el método HUELLA) y que no tenga cambio de contraseña temporal pendiente (debeCambiarPassword) SHALL ser admitido como operador. Las condiciones son las mismas para todos los métodos; las únicas candidatas de un método son las personas que cumplen S7 y tienen la credencial de ese método.

#### Scenario: Empleado activo con PIN y sin cambio de contraseña pendiente
- **GIVEN** un usuario en estado ACTIVO, con PIN establecido, sin ser cuenta de sector ni usuario técnico, y con debeCambiarPassword en falso
- **WHEN** ingresa su PIN en una cuenta de sector
- **THEN** el sistema lo admite como operador válido

#### Scenario: Usuario con cambio de contraseña temporal pendiente
- **GIVEN** un usuario que tiene debeCambiarPassword en verdadero
- **WHEN** ingresa su PIN en una cuenta de sector
- **THEN** el sistema no lo admite como operador

#### Scenario: Empleado activo con huella enrolada
- **GIVEN** un usuario en estado ACTIVO con huella enrolada, sin ser cuenta de sector ni usuario técnico, y con debeCambiarPassword en falso
- **WHEN** presenta su huella en una cuenta de sector
- **THEN** el sistema lo admite como operador válido

#### Scenario: Usuario con cambio pendiente o suspendido presenta su huella
- **GIVEN** un usuario con huella enrolada que tiene debeCambiarPassword en verdadero, o que no está ACTIVO
- **WHEN** presenta su huella en una cuenta de sector
- **THEN** el sistema no lo admite como operador, igual que con su PIN

### Requirement: S8 — Identificación solo por PIN, sin bloqueo por intentos

En una cuenta de sector el empleado SHALL identificarse solo con la prueba de un método habilitado en la farmacia, sin elegir su nombre. El código (PIN o huella) MUST coincidir con el de exactamente un empleado admitido como operador (S7) entre los candidatos de ese método; si no coincide con ninguno o con más de uno, la acción MUST rechazarse sin atribuirse a nadie, con un mensaje genérico que no revela cuál fue el motivo. Un código rechazado SHALL NOT sumar intentos ni bloquear ningún código ni ningún método: identifica, no protege (decisión del usuario 2026-10-28), y esto rige igual para el PIN y para la huella.

El mensaje del PIN rechazado es «El PIN no corresponde a ningún empleado habilitado.»; el de la huella rechazada es «La huella no corresponde a ningún empleado habilitado.».

#### Scenario: PIN de un empleado habilitado
- **GIVEN** una cuenta de sector y un empleado admitido como operador
- **WHEN** se ingresa su PIN en una acción con PIN
- **THEN** la acción se ejecuta a nombre de ese empleado, sin haber elegido su nombre

#### Scenario: PIN que no corresponde a ningún empleado
- **GIVEN** una cuenta de sector
- **WHEN** se ingresa un PIN que no es el de ningún empleado admitido como operador
- **THEN** la acción se rechaza con «El PIN no corresponde a ningún empleado habilitado.» y ningún contador de intentos cambia

#### Scenario: PIN compartido por dos empleados
- **GIVEN** dos empleados de la farmacia con el mismo PIN, configurado antes de exigirse la unicidad
- **WHEN** se ingresa ese PIN en una cuenta de sector
- **THEN** la acción se rechaza pidiendo que se cambie el PIN desde «Mi cuenta»

#### Scenario: Huella de un empleado habilitado
- **GIVEN** una cuenta de sector, el método HUELLA habilitado y un empleado admitido como operador con huella enrolada
- **WHEN** el lector escribe su código y Enter en el diálogo de verificación
- **THEN** la acción se ejecuta a nombre de ese empleado, sin haber elegido su nombre

#### Scenario: Huella que no corresponde a ningún empleado
- **GIVEN** una cuenta de sector con el método HUELLA habilitado
- **WHEN** el lector escribe un código que no es el de ningún empleado admitido como operador
- **THEN** la acción se rechaza con «La huella no corresponde a ningún empleado habilitado.», ningún contador de intentos cambia y ningún código ni método queda bloqueado

### Requirement: S9 — Auditoría de intentos de identificación rechazados

Cada intento de identificación de operador rechazado MUST auditarse a nombre de la cuenta de sector con entidad operador y acción AUTORIZAR, registrando como destino a la propia cuenta de sector (no hay usuario seleccionado), el método con que se intentó y el motivo interno del rechazo, y sin almacenar jamás el código ingresado (PIN o huella). Una prueba de un método deshabilitado en la farmacia MUST auditarse igual que cualquier otro rechazo. En cambio, una prueba que nombra un método desconocido o que está malformada para su método MUST rechazarse con el mensaje genérico y NO se audita (no hay un intento de identificación que registrar).

#### Scenario: Registro de auditoría ante PIN incorrecto
- **GIVEN** un intento de identificación en cuenta de sector con PIN inválido
- **WHEN** el sistema rechaza la autenticación
- **THEN** se emite un registro de auditoría a nombre de la cuenta de sector, con el motivo interno del rechazo y sin incluir el PIN

#### Scenario: Registro de auditoría ante huella incorrecta
- **GIVEN** un intento de identificación en cuenta de sector con un código de huella que no corresponde a nadie
- **WHEN** el sistema rechaza la autenticación
- **THEN** se emite un registro de auditoría a nombre de la cuenta de sector, con el método `HUELLA` y el motivo interno del rechazo, sin incluir el código

#### Scenario: Registro de auditoría ante prueba de un método deshabilitado
- **GIVEN** una farmacia con el método HUELLA deshabilitado
- **WHEN** llega una solicitud con una prueba de huella
- **THEN** se emite el mismo registro de auditoría que ante cualquier identificación rechazada, con el motivo interno «método no habilitado» y sin incluir el código

### Requirement: Unicidad de PIN por farmacia

Dos usuarios de la misma farmacia SHALL NOT compartir el mismo código en un mismo método de código secreto (PIN o huella): es lo que permite identificar al empleado solo por su código (S8). Al elegirlo (el PIN en Mi cuenta o en el paso obligatorio; la huella en Mi cuenta), el sistema MUST verificar contra el hash de cada otro usuario de la farmacia que tenga ese método, bajo lock consultivo por farmacia y por método, de modo que dos altas simultáneas no elijan el mismo código. El rechazo MUST NOT decir que el código es de otro. La unicidad es por método y por farmacia: el mismo texto puede ser el PIN de un empleado y la huella de otro, y farmacias distintas no se influyen.

Mensajes: PIN «Ese PIN no se puede usar. Elegí otro.»; huella «Ese código no se puede usar. Probá con otro.».

#### Scenario: Empleado elige PIN ya en uso por otro empleado de la misma farmacia
- **GIVEN** un empleado de la farmacia que ya tiene configurado un PIN determinado
- **WHEN** otro empleado de la misma farmacia intenta configurar el mismo PIN
- **THEN** el sistema rechaza el PIN bajo lock consultivo con el mensaje «Ese PIN no se puede usar. Elegí otro.»

#### Scenario: Empleados de farmacias distintas configuran el mismo PIN
- **GIVEN** un empleado en una farmacia con un PIN determinado
- **WHEN** un empleado de otra farmacia distinta configura ese mismo PIN
- **THEN** el sistema acepta la configuración exitosamente

#### Scenario: Empleado enrola un código de huella ya en uso en la misma farmacia
- **GIVEN** un empleado de la farmacia con un código de huella enrolado
- **WHEN** otro empleado de la misma farmacia intenta enrolar el mismo código
- **THEN** el sistema rechaza el código bajo lock consultivo con el mensaje «Ese código no se puede usar. Probá con otro.» sin revelar de quién es

#### Scenario: Mismo código de huella en farmacias distintas
- **GIVEN** un empleado de una farmacia con un código de huella enrolado
- **WHEN** un empleado de otra farmacia enrola ese mismo código
- **THEN** el sistema acepta el enrolamiento

#### Scenario: Mismo texto como PIN de uno y huella de otro
- **GIVEN** un empleado con un PIN determinado
- **WHEN** otro empleado de la misma farmacia enrola una huella cuyo código es igual a ese PIN
- **THEN** el sistema acepta el enrolamiento, porque la unicidad es por método

### Requirement: Manejo de operador en Server Actions mediante conOperador

Toda Server Action que ejecute un caso de uso con acción configurable MUST envolver su ejecución en la utilidad conOperador para capturar la prueba de verificación del empleado, que viaja como un par genérico `{ método, prueba }` y no como un campo propio de cada método. Los sitios que llaman a conOperador, `resolverActor` y la escritura de auditoría MUST NOT cambiar al sumar un método nuevo. Si una acción con PIN no es envuelta por conOperador, el comando MUST rechazarse en cuenta de sector con un mensaje explícito.

#### Scenario: Ejecución de Server Action con conOperador
- **GIVEN** una Server Action que invoca un caso de uso con PIN envuelta en conOperador
- **WHEN** se reciben los datos del formulario con el empleado y PIN
- **THEN** el caso de uso procesa la credencial correctamente

#### Scenario: Server Action sin conOperador ejecutada desde cuenta de sector
- **GIVEN** una Server Action no envuelta en conOperador para una acción con PIN
- **WHEN** se invoca desde una cuenta de sector
- **THEN** el comando rechaza la ejecución con un mensaje claro sin atribuir en silencio

#### Scenario: Server Action con conOperador recibe prueba de huella
- **GIVEN** una Server Action envuelta en conOperador, con el método HUELLA habilitado
- **WHEN** se reciben los datos del formulario con una prueba de método `HUELLA`
- **THEN** el caso de uso procesa la credencial sin que la Server Action conozca el método

## ADDED Requirements

### Requirement: Registro único de métodos de verificación

Cada método de verificación SHALL declararse en un único registro consumido por toda la aplicación, y toda prueba de verificación MUST nombrar su método. Los métodos de esta versión son `PIN` y `HUELLA`.

#### Scenario: PIN sigue funcionando como método registrado
- **GIVEN** una cuenta de sector y un empleado con PIN
- **WHEN** se identifica con su PIN
- **THEN** el comportamiento, los mensajes y las filas de auditoría son los mismos que antes de existir el registro

### Requirement: Contenido de cada método registrado

Un método registrado SHALL declarar la forma de su prueba, cómo identifica al empleado, el texto de su rechazo genérico, su rótulo para el usuario y qué datos de su prueba son secretos, que nunca aparecen en registros ni en auditoría.

#### Scenario: Dato secreto de un método
- **GIVEN** un método cuya prueba contiene un dato secreto
- **WHEN** la prueba se procesa, con éxito o con rechazo
- **THEN** ese dato no aparece en los registros de la aplicación ni en la auditoría

### Requirement: Sumar un método no cambia el pipeline

Sumar un método nuevo MUST requerir solo definir ese método (cómo se enrola y cómo se lee) y habilitarlo desde la administración, sin cambiar los sitios que llaman a conOperador, `resolverActor` ni la escritura de auditoría.

#### Scenario: Método nuevo registrado
- **GIVEN** un método nuevo definido en el registro y habilitado en una farmacia
- **WHEN** un empleado se identifica con él en una acción con PIN
- **THEN** la acción se ejecuta a su nombre sin que cambie ningún sitio de conOperador ni el pipeline de comandos

### Requirement: Rechazo en el servidor de pruebas inválidas

Una prueba que nombra un método desconocido, o está malformada para su método, MUST rechazarse en el servidor antes de cualquier efecto de negocio, con el rechazo genérico y sin auditoría (S9 solo audita los intentos de identificación rechazados, no las pruebas inválidas).

#### Scenario: Prueba con método desconocido
- **GIVEN** una cuenta de sector y una acción que exige verificación
- **WHEN** llega una solicitud con una prueba cuyo método no existe en el registro
- **THEN** el sistema rechaza la solicitud antes de cualquier efecto de negocio, con el rechazo genérico, sin auditoría y sin guardar la prueba

#### Scenario: Prueba malformada para su método
- **GIVEN** una cuenta de sector y el método HUELLA habilitado
- **WHEN** llega una prueba de método `HUELLA` con un código de entre 1 y 5 caracteres
- **THEN** el sistema rechaza la solicitud como una identificación fallida, auditada según S9, sin guardar el código

#### Scenario: Prueba con código vacío
- **GIVEN** una cuenta de sector y el método HUELLA habilitado
- **WHEN** llega una prueba de método `HUELLA` con un código vacío
- **THEN** el sistema la trata como malformada: rechazo genérico, sin auditoría y sin guardar la prueba

### Requirement: Habilitación de métodos por farmacia

Cada farmacia SHALL tener una configuración de qué métodos de verificación están habilitados. El método `PIN` MUST estar siempre habilitado en esta versión y no se puede deshabilitar.

#### Scenario: Intento de deshabilitar el PIN
- **GIVEN** un usuario con `config.editar`
- **WHEN** intenta deshabilitar el método `PIN`
- **THEN** el sistema lo impide y el conjunto de métodos habilitados no cambia

### Requirement: Valores iniciales de los métodos habilitados

Una farmacia nueva MUST nacer con `PIN` habilitado y los demás métodos deshabilitados, y las farmacias existentes MUST quedar con `PIN` habilitado.

#### Scenario: Farmacia nueva
- **WHEN** se crea una farmacia nueva
- **THEN** nace con `PIN` habilitado y la huella deshabilitada

#### Scenario: Farmacia existente
- **GIVEN** una farmacia creada antes de este cambio
- **WHEN** se aplica el cambio
- **THEN** conserva `PIN` habilitado y la huella deshabilitada

### Requirement: Cambio y auditoría de los métodos habilitados

Un usuario con el permiso `config.editar` MUST poder habilitar o deshabilitar cada método que no sea `PIN` en Configuración, y el cambio MUST auditarse con el conjunto de métodos habilitados antes y después. Rige desde la próxima acción de cada cuenta de sector.

#### Scenario: Administrador habilita la huella
- **GIVEN** un usuario con `config.editar` y una farmacia con solo `PIN` habilitado
- **WHEN** habilita el método huella y guarda
- **THEN** la farmacia tiene `PIN` y `HUELLA` habilitados
- **AND** la auditoría registra el conjunto antes (`PIN`) y después (`PIN`, `HUELLA`)
- **AND** la próxima acción de cada cuenta de sector ofrece la huella

#### Scenario: Usuario sin permiso
- **GIVEN** un usuario sin `config.editar`
- **WHEN** intenta cambiar los métodos habilitados
- **THEN** el sistema rechaza el cambio y la configuración no cambia

### Requirement: Rechazo en el servidor de un método deshabilitado

El servidor MUST rechazar una prueba de un método deshabilitado en la farmacia, sin efecto de negocio y con el rechazo genérico y la auditoría de S9, aunque la interfaz no lo ofrezca.

#### Scenario: Prueba de un método deshabilitado
- **GIVEN** una farmacia con el método HUELLA deshabilitado y un empleado con huella enrolada
- **WHEN** llega al servidor una prueba de huella válida de ese empleado
- **THEN** el sistema rechaza la solicitud con el rechazo genérico, sin efecto de negocio, y audita el intento según S9

### Requirement: Conservación de los códigos al deshabilitar un método

Deshabilitar un método SHALL conservar los códigos enrolados, que se ignoran mientras el método está deshabilitado; al habilitarlo de nuevo vuelven a regir sin re-enrolar.

#### Scenario: Deshabilitar la huella conserva los códigos enrolados
- **GIVEN** una farmacia con la huella habilitada y empleados con huella enrolada
- **WHEN** un usuario con `config.editar` deshabilita la huella
- **THEN** los códigos enrolados se conservan y se ignoran mientras el método está deshabilitado
- **AND** al volver a habilitarla los empleados se identifican con la misma huella, sin volver a enrolarla

### Requirement: Método huella — código de lector

El método `HUELLA` SHALL identificar al empleado por un código que un lector escribe como teclado seguido de Enter (igual que el lector de QR), de al menos 6 caracteres.

#### Scenario: Código de huella demasiado corto
- **GIVEN** un empleado enrolando su huella en «Mi cuenta»
- **WHEN** el lector escribe un código de 5 caracteres y Enter
- **THEN** el sistema rechaza el enrolamiento indicando el mínimo de 6 caracteres y no guarda nada

### Requirement: Método huella — almacenamiento y secreto del código

El código de huella MUST almacenarse solo con hash y MUST NOT aparecer jamás en los registros de la aplicación ni en la auditoría, ni siquiera en un rechazo. Cada empleado MUST tener como máximo una huella enrolada.

#### Scenario: El código de huella no queda en claro ni en registros
- **GIVEN** un empleado que enrola o presenta su huella
- **WHEN** la operación termina, con éxito o con rechazo
- **THEN** lo almacenado es solo un hash, y ni los registros de la aplicación ni la auditoría contienen el código

#### Scenario: Empleado vuelve a enrolar
- **GIVEN** un empleado con una huella enrolada
- **WHEN** enrola un código nuevo
- **THEN** el código nuevo reemplaza al anterior y el anterior deja de identificarlo

### Requirement: Método huella — misma semántica de identificación que el PIN

La identificación por huella SHALL tener la semántica del PIN: sin selector de nombre, sin bloqueo por intentos, con mensaje genérico (S8) y con cada rechazo auditado (S9). El código de huella MUST NOT verificarse contra el PIN del empleado.

#### Scenario: Código de huella igual al PIN del mismo empleado
- **GIVEN** un empleado con un PIN determinado
- **WHEN** enrola una huella cuyo código es igual a su PIN
- **THEN** el sistema acepta el enrolamiento

### Requirement: Enrolamiento de la huella por el propio empleado

Cada empleado SHALL poder enrolar, reemplazar y eliminar su propia huella desde «Mi cuenta», con su sesión individual.

#### Scenario: Empleado enrola su huella
- **GIVEN** un empleado con sesión individual en «Mi cuenta»
- **WHEN** el lector escribe un código válido y Enter en el panel de huella
- **THEN** la huella queda enrolada y el empleado puede identificarse con ella

#### Scenario: Empleado reemplaza o elimina su huella
- **GIVEN** un empleado con una huella enrolada
- **WHEN** la reemplaza o la elimina desde «Mi cuenta»
- **THEN** el código anterior deja de identificarlo

### Requirement: Cuentas de sector no gestionan huellas

Una cuenta de sector SHALL NOT ver el panel de huella en «Mi cuenta», y el servidor MUST rechazar el enrolamiento, el reemplazo o la baja de huella provenientes de una cuenta de sector.

#### Scenario: Cuenta de sector no puede enrolar
- **GIVEN** una sesión de cuenta de sector
- **WHEN** abre «Mi cuenta» o envía una solicitud de enrolamiento, reemplazo o baja de huella
- **THEN** no ve el panel de huella y el servidor rechaza la solicitud

### Requirement: Baja de la huella por el Administrador

Un Administrador (con el permiso de gestión de credenciales de usuarios) MUST poder eliminar la huella de un empleado desde Usuarios › detalle, y MUST NOT poder enrolarla ni ver nada de su código. La baja no toca el PIN del empleado, y restablecer el PIN no toca la huella.

#### Scenario: Administrador elimina la huella de un empleado
- **GIVEN** un Administrador y un empleado con huella enrolada
- **WHEN** elimina la huella desde Usuarios › detalle
- **THEN** el empleado deja de poder identificarse con huella, su PIN no cambia y la auditoría registra la baja a nombre del Administrador sin el código

#### Scenario: Administrador no puede enrolar ni ver el código
- **GIVEN** un Administrador en Usuarios › detalle de un empleado
- **WHEN** consulta la sección de huella
- **THEN** solo ve si hay una huella enrolada y puede eliminarla; no puede enrolarla ni ver nada del código

### Requirement: Auditoría del enrolamiento y la baja de huella

Enrolar, reemplazar y eliminar una huella MUST auditarse registrando quién la hizo y sobre quién, sin el código.

#### Scenario: Enrolamiento auditado sin el código
- **GIVEN** un empleado que enrola, reemplaza o elimina su huella, o un Administrador que la elimina
- **WHEN** la operación termina
- **THEN** la auditoría registra quién actuó y sobre quién, y no contiene ningún código

### Requirement: Diálogo de verificación ofrece los métodos habilitados

El diálogo «¿Quién realiza esta acción?» MUST ofrecer solo los métodos habilitados en la farmacia; con solo el PIN habilitado es el del PIN, igual que antes.

#### Scenario: Diálogo con solo el PIN habilitado
- **GIVEN** una cuenta de sector y una farmacia con solo el PIN habilitado
- **WHEN** se abre el diálogo de verificación
- **THEN** se muestra solo el campo de PIN, como antes de este cambio

### Requirement: Diálogo abre en la huella cuando está habilitada

Cuando la huella está habilitada, el diálogo MUST abrirse en el método huella con el foco en su campo, porque el lector escribe en el campo con foco, y el PIN MUST quedar a un clic. Al enviar el código con Enter la acción se ejecuta como con el PIN.

#### Scenario: Diálogo con la huella habilitada
- **GIVEN** una cuenta de sector y una farmacia con PIN y huella habilitados
- **WHEN** se abre el diálogo de verificación
- **THEN** se muestra el campo de huella con el foco, y hay una opción visible para cambiar al PIN con un clic

### Requirement: Diálogo conserva lo cargado ante un rechazo

Ante un rechazo de la identificación, el formulario MUST conservar lo que el usuario cargó y el error MUST marcarse en el campo del método usado (convención de formularios).

#### Scenario: Rechazo conserva lo cargado
- **GIVEN** un formulario con datos cargados y el diálogo abierto
- **WHEN** el servidor rechaza la identificación
- **THEN** el formulario conserva lo que el usuario cargó y el error se muestra en el campo del método usado

#### Scenario: El código rechazado se vacía para volver a leer
- **GIVEN** el diálogo abierto en un método de código (PIN o huella) y un código rechazado por el servidor
- **WHEN** el diálogo vuelve a abrirse con el error
- **THEN** el campo del código queda vacío y con el foco, para que una nueva lectura del lector no se sume al código anterior, y el resto del formulario conserva lo cargado

### Requirement: Métodos fuera de alcance

El sistema SHALL NOT ofrecer en este cambio WebAuthn, la biometría de la plataforma (Windows Hello, Face ID), las llaves FIDO2 y TOTP, y también deshabilitar el PIN, elegir método por acción o por equipo y la reautenticación (step-up) con su contador y bloqueo de PIN.

#### Scenario: Biometría del sistema operativo no se ofrece como método
- **GIVEN** cualquier farmacia
- **WHEN** el Administrador revisa los métodos que puede habilitar
- **THEN** solo existen `PIN` y `HUELLA`; no hay WebAuthn, Windows Hello, Face ID, FIDO2 ni TOTP

### Requirement: Contrato del servidor abierto a métodos de dos pasos

El contrato del servidor MUST dejar lugar a un método de dos pasos, en el que el servidor emite un desafío antes de la prueba, sin que haya uno en esta versión.

#### Scenario: Ningún método de dos pasos en esta versión
- **GIVEN** los métodos registrados en esta versión
- **WHEN** se identifica a un empleado con `PIN` o `HUELLA`
- **THEN** la identificación se resuelve con una sola prueba, sin desafío del servidor

### Requirement: Nota de seguridad — el código de un lector es un secreto estático

Un lector que emite un código SHALL tratarse como un secreto estático, tan fuerte como su código, igual que una tarjeta de acceso: quien conozca o copie el código se identifica como ese empleado.

#### Scenario: Código copiado
- **GIVEN** una persona que conoce el código de huella de un empleado
- **WHEN** lo presenta en una cuenta de sector
- **THEN** el sistema la identifica como ese empleado, porque el método identifica por el código y no por la persona

### Requirement: Nota de seguridad — una biometría futura debe ser identificadora

En una PC de sector compartida, una biometría del sistema operativo verifica presencia, no identidad; por eso una biometría futura MUST ser identificadora (un autenticador por empleado o identificar y luego verificar).

#### Scenario: Biometría del sistema operativo en equipo compartido
- **GIVEN** una propuesta de usar una biometría del sistema operativo en una PC de sector compartida
- **WHEN** se evalúa como método de verificación
- **THEN** no es admisible, porque cualquier persona enrolada en el equipo la pasaría sin identificar a quién es

### Requirement: Significado de «PIN del operador» en las demás specs

En cualquier spec, «PIN del operador» e «identificación por PIN» SHALL significar la verificación del operador con cualquiera de los métodos habilitados en la farmacia, de modo que las specs que solo los nombran no requieren cambios.

#### Scenario: Otra spec pide el PIN del operador
- **GIVEN** una acción cuya spec dice que se pide el PIN del operador (envíos, retiro vencido, pesada real, existencia inicial) y una farmacia con la huella habilitada
- **WHEN** se ejecuta la acción desde una cuenta de sector
- **THEN** se pide la verificación del operador y el empleado puede identificarse con la huella o con el PIN

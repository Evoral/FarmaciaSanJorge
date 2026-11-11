## ADDED Requirements

Los requisitos "Aviso de quiebre de la cadena" y "Aviso — resultado en memoria" NO cambian: el aviso, su texto y el resultado en memoria siguen como están. Lo que sigue agrega un registro persistente al costado.

### Requirement: Incidente de integridad — registro al detectar un quiebre

Cuando la verificación del aviso se ejecuta de verdad (nunca al leer el resultado en memoria) y encuentra un quiebre en un libro abierto, el sistema SHALL registrar un incidente en `fsj.libro_incidente_integridad`, ABIERTO mientras `resuelto_en` sea nulo. Un libro MUST tener a lo sumo uno abierto, garantizado por la base. El registro es un comando separado de la consulta, que sigue de solo lectura.

#### Scenario: Primer quiebre detectado
- **GIVEN** un libro abierto sin incidente abierto y cuya cadena se rompe en el asiento Nº N
- **WHEN** un usuario con `libro.ver` navega y el resultado en memoria no existe o venció
- **THEN** se crea un incidente abierto con número N, `detecciones` = 1 y `detectado_en` = `ultima_deteccion_en`

#### Scenario: Resultado en memoria vigente
- **GIVEN** un libro roto con resultado en memoria vigente
- **WHEN** el usuario navega a otra página
- **THEN** no se escribe ni se actualiza ningún incidente

### Requirement: Incidente de integridad — idempotente y por libro

Registrar el mismo quiebre más de una vez SHALL ser idempotente: si el libro ya tiene un incidente abierto con el mismo número de asiento roto, el registro MUST actualizar `ultima_deteccion_en` y sumar 1 a `detecciones` sin crear otra fila. Si el número roto es distinto, el registro SHALL cerrar el incidente abierto (`resuelto_en` = instante actual) y abrir uno nuevo con el nuevo número, en la misma transacción. Cada libro se evalúa por separado.

#### Scenario: Detección repetida en otro proceso
- **GIVEN** un incidente abierto en el asiento Nº N con `detecciones` = 1
- **WHEN** otra instancia de la app, con su propio resultado en memoria, vuelve a detectar el quiebre en el Nº N
- **THEN** sigue habiendo un solo incidente abierto, con `detecciones` = 2 y `ultima_deteccion_en` actualizada

#### Scenario: Detecciones simultáneas
- **GIVEN** un libro roto sin incidente abierto
- **WHEN** dos instancias intentan registrar el quiebre a la vez
- **THEN** queda un solo incidente abierto, con `detecciones` = 2 o igual al número de intentos que se aplicaron

#### Scenario: El quiebre se corre de número
- **GIVEN** un incidente abierto en el asiento Nº N
- **WHEN** la verificación encuentra el quiebre en el Nº M distinto de N
- **THEN** el incidente del Nº N queda resuelto y se abre otro con Nº M y `detecciones` = 1

#### Scenario: Dos libros rotos
- **GIVEN** el libro recetario y el contralor rotos a la vez
- **WHEN** se registra la verificación
- **THEN** cada libro tiene su propio incidente abierto

### Requirement: Incidente de integridad — se cierra solo cuando verifica

Cuando la verificación de un libro con incidente abierto da OK, el registro SHALL cerrarlo con `resuelto_en` = instante actual. El incidente cerrado MUST conservarse como historia; no se borra ni se reabre: un quiebre posterior abre un incidente nuevo. Un incidente MUST NOT decidir la integridad de un libro: la fuente de verdad es siempre `fsj.verificar_cadena`, y el aviso se calcula de ella, nunca de la tabla.

#### Scenario: Reanclaje exitoso
- **GIVEN** un incidente abierto por un hueco en el asiento Nº N
- **WHEN** el DT reancla el hueco y la siguiente verificación da OK
- **THEN** el incidente queda con `resuelto_en` y el aviso desaparece

#### Scenario: Reanclaje y luego otro quiebre
- **GIVEN** un incidente resuelto por reanclaje
- **WHEN** más tarde la verificación encuentra un quiebre, en el mismo número o en otro
- **THEN** se abre un incidente nuevo con `detecciones` = 1 y el resuelto no cambia

#### Scenario: Libro cerrado estando roto
- **GIVEN** un libro con incidente abierto que se cierra (ya no es un libro abierto, no se verifica)
- **WHEN** pasan las verificaciones siguientes
- **THEN** el incidente sigue abierto: solo una verificación OK lo cierra

#### Scenario: Tabla y verificador discrepan
- **GIVEN** un incidente abierto en la tabla
- **WHEN** `fsj.verificar_cadena` da OK para ese libro
- **THEN** el aviso no se muestra y el incidente se cierra; la tabla nunca mantiene el aviso encendido

### Requirement: Incidente de integridad — falla sin efecto visible

El registro SHALL ser de mejor esfuerzo: el aviso se calcula primero y cualquier falla al registrar (base caída, restricción, error inesperado) MUST capturarse y registrarse en el log en nivel `warn`, sin alterar el aviso, la página ni el resultado en memoria, y sin propagar el error al usuario.

#### Scenario: La base falla al registrar
- **GIVEN** un libro roto y una falla de la base al escribir el incidente
- **WHEN** un usuario con `libro.ver` navega
- **THEN** la página carga normal, el aviso rojo se muestra igual y queda un log `warn` con la falla

#### Scenario: Usuario sin libro.ver
- **GIVEN** un usuario sin `libro.ver`
- **WHEN** navega
- **THEN** no se verifica ni se registra nada por su navegación

### Requirement: Incidente de integridad — sin atribución a un usuario

El comando de registro (`libro.integridad.registrarIncidentes`) SHALL omitir la auditoría con razón explícita (`audit: { skip: true, reason }`) y la tabla MUST NOT guardar al usuario que navegaba: ese usuario no causó el quiebre, y la fila es en sí el registro. La tabla MUST tener RLS habilitado y forzado, y MUST ser accesible solo por el tenant dueño.

#### Scenario: Registro sin actor
- **WHEN** se registra un incidente
- **THEN** la fila no tiene columna de usuario, no se escribe fila de auditoría de usuario y la omisión de auditoría declara su razón

#### Scenario: Otro tenant
- **GIVEN** un incidente de la farmacia A
- **WHEN** un usuario de la farmacia B consulta la tabla
- **THEN** no ve la fila

### Requirement: Incidente de integridad — log estructurado al abrir

Al abrir un incidente nuevo (no al actualizar uno existente) el sistema SHALL emitir una línea estructurada de nivel `error` con tenant, libro (tipo), número de asiento roto e id del incidente. La línea y la tabla MUST NOT contener contenido de asientos ni datos de pacientes.

#### Scenario: Se abre un incidente
- **WHEN** se abre un incidente nuevo
- **THEN** se emite una línea `error` con tenant, tipo de libro, número y id del incidente, sin datos de asientos ni de pacientes

#### Scenario: Detección repetida
- **GIVEN** un incidente abierto
- **WHEN** se vuelve a detectar el mismo quiebre
- **THEN** no se emite una nueva línea `error`

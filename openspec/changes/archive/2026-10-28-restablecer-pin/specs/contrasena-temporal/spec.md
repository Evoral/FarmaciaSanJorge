## ADDED Requirements

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


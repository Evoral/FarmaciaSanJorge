## ADDED Requirements

### Requirement: CA1 — Acceso al chat de ayuda
El chat de ayuda SHALL estar disponible para toda sesión con el permiso `ayuda.consultar`. El botón que lo abre MUST NOT mostrarse cuando la sesión no tiene el permiso o cuando el servidor no tiene configurada la clave del proveedor del LLM.

#### Scenario: Sin clave del proveedor
- GIVEN un servidor sin la clave del proveedor configurada
- WHEN un usuario con `ayuda.consultar` entra a la app
- THEN no ve el botón de ayuda

### Requirement: CA2 — Guía de uso global
Las respuestas SHALL salir de una guía de uso que vive en el código y es igual para todas las farmacias. Cada entrada MUST tener un título, los permisos que exige, la ruta de la pantalla, los pasos en lenguaje de mostrador y, opcionalmente, detalles por tema.

#### Scenario: Entrada de la guía
- GIVEN la entrada "Cargar receta" con permiso `recetas.crear`, ruta `/recetas/nuevo` y el detalle "Importar PDF"
- WHEN se arma el contexto del chat para un usuario que tiene `recetas.crear`
- THEN la entrada está disponible con su ruta y sus pasos

### Requirement: CA3 — Filtro por permisos antes del modelo
Una entrada de la guía SHALL llegar al modelo solo si la sesión tiene todos los permisos que la entrada exige. El modelo MUST NOT recibir entradas no permitidas, ni siquiera su título. El filtro corre en el servidor antes de cualquier llamada al modelo.

#### Scenario: Acción no permitida
- GIVEN un usuario sin el permiso `cierres.firmar`
- WHEN pregunta "¿cómo firmo el cierre?"
- THEN el contexto enviado al modelo no contiene la entrada de firma del cierre
- AND el chat responde como indica "Consulta fuera de las opciones del usuario"

### Requirement: CA4 — Respuesta solo desde la guía
La respuesta SHALL basarse únicamente en las entradas enviadas al modelo. MUST NOT nombrar pantallas, botones ni rutas que no estén en ellas. Si la pregunta no corresponde a ninguna entrada, el chat SHALL responder como indica "Consulta fuera de las opciones del usuario".

#### Scenario: Pregunta fuera de la guía
- GIVEN una guía sin entradas sobre facturación electrónica
- WHEN el usuario pregunta "¿cómo hago una factura electrónica?"
- THEN el chat responde como indica "Consulta fuera de las opciones del usuario"

### Requirement: CA4b — Consulta fuera de las opciones del usuario
Cuando la pregunta no corresponde a ninguna entrada que el usuario recibió, el chat SHALL mostrar un cartel fijo: "No lo encuentro entre tus opciones. Puede que lo haga otro rol: preguntale a tu director técnico o al administrador." El cartel MUST NOT revelar si la acción existe para otro rol.

#### Scenario: Cartel para preguntar al DT
- GIVEN un usuario sin el permiso `cierres.firmar`
- WHEN pregunta "¿cómo firmo el cierre?"
- THEN ve el cartel que le sugiere preguntarle a su director técnico o al administrador

### Requirement: CA5 — Respuesta corta y sin tecnicismos
La respuesta SHALL ser corta (como máximo tres oraciones salvo que el usuario pida el detalle), en el tono de la guía, y MUST NOT usar términos técnicos del sistema (permisos, códigos, rutas internas, nombres de tablas).

#### Scenario: Cómo cargar una receta
- GIVEN un usuario con `recetas.crear`
- WHEN pregunta "¿cómo cargo una receta?"
- THEN la respuesta dice que vaya a Recetas y toque "Nueva receta"

### Requirement: CA6 — Botón "Ir a" armado por el servidor
Cuando la respuesta corresponde a una entrada, el chat SHALL mostrar un botón "Ir a" con la ruta de esa entrada. La ruta MUST salir de la guía en el servidor, nunca del texto que redacta el modelo, y el modelo solo puede señalar una entrada de las que recibió.

#### Scenario: Botón hacia la pantalla
- GIVEN la respuesta a "¿cómo cargo una receta?"
- WHEN el chat la muestra
- THEN muestra un botón "Ir a Cargar receta" que lleva a `/recetas/nuevo`

### Requirement: CA7 — Entrada en foco y sus detalles
La entrada de la última respuesta SHALL quedar en foco. En el turno siguiente el servidor MUST revalidar que la sesión tenga los permisos de esa entrada y, si los tiene, enviar sus detalles al modelo; de las demás entradas el modelo recibe solo título y pasos.

#### Scenario: Repregunta sobre la misma acción
- GIVEN la conversación tiene en foco "Cargar receta"
- WHEN el usuario pregunta "no entiendo cómo importar el pdf"
- THEN la respuesta usa el detalle "Importar PDF" de esa entrada

#### Scenario: Foco no permitido
- GIVEN un cliente que envía en foco una entrada cuyos permisos la sesión no tiene
- WHEN el servidor arma el contexto
- THEN ignora el foco y no envía los detalles de esa entrada

### Requirement: CA8 — Detalle de otra entrada
Si para responder hace falta el detalle de una entrada permitida que no está en foco, el servidor SHALL hacer una segunda consulta al modelo con los detalles de esa entrada. Un turno MUST NOT hacer más de dos consultas al modelo.

#### Scenario: Detalle fuera de foco
- GIVEN la conversación tiene en foco "Cargar receta"
- WHEN el usuario pregunta cómo se anula una entrega y tiene el permiso para hacerlo
- THEN el servidor consulta otra vez con los detalles de esa entrada
- AND la respuesta llega en ese mismo turno

### Requirement: CA9 — Historial enviado al modelo
El historial que acompaña cada pregunta SHALL armarse en el navegador con como máximo los últimos seis mensajes, de hasta 500 caracteres cada uno; la pregunta MUST tener como máximo 300 caracteres. El servidor MUST NOT tomar el historial de la base para armar el contexto.

#### Scenario: Pregunta demasiado larga
- GIVEN una pregunta de más de 300 caracteres
- WHEN el usuario la envía
- THEN el chat muestra el error de largo y conserva el texto escrito

### Requirement: CA10 — Privacidad de las consultas
El modelo SHALL recibir solo la guía filtrada y la conversación, nunca datos de la farmacia. Las consultas registradas MUST quedar aisladas por farmacia como el resto de sus datos. La clave del proveedor MUST usarse solo en el servidor y en una modalidad que no use las consultas para entrenar.

#### Scenario: Datos de la farmacia
- GIVEN un usuario que pregunta por el stock de una droga
- WHEN se arma el contexto
- THEN el contexto no contiene datos de stock
- AND la respuesta indica cómo llegar a la consulta de stock si el usuario tiene ese permiso

### Requirement: CA11 — Proveedor no disponible
Si el proveedor del LLM falla o no responde a tiempo, el chat SHALL mostrar "La ayuda no está disponible en este momento." y MUST conservar el historial y la pregunta escrita. La consulta queda registrada con resultado de error.

#### Scenario: Falla del proveedor
- GIVEN el proveedor del LLM no responde a tiempo
- WHEN el usuario envía una pregunta
- THEN ve "La ayuda no está disponible en este momento."
- AND su pregunta sigue escrita en el campo

### Requirement: CA12 — Cuentas de sector
En una cuenta de sector el chat SHALL responder con los permisos de la sesión de la cuenta y MUST NOT pedir PIN. Si la acción descripta pide PIN, la respuesta puede avisarlo cuando la guía lo indique.

#### Scenario: Consulta desde una cuenta de sector
- GIVEN una sesión de cuenta de sector
- WHEN un empleado pregunta cómo registrar una entrega
- THEN la respuesta se arma con los permisos de la cuenta, sin pedir PIN

### Requirement: CA13 — Registro de consultas
Cada pregunta SHALL registrarse con farmacia, usuario, conversación, fecha, respuesta, entrada elegida y resultado: respondida, fuera de opciones o error. El registro completo es solo para el dueño de la plataforma: MUST NOT mostrarse a ningún usuario de las farmacias, ni a ADMINISTRADOR ni al DT. Desde la app solo se puede agregar la calificación; MUST NOT poder borrarse. Se conserva sin vencimiento hasta que el dueño decida eliminarlo.

#### Scenario: Pregunta respondida
- GIVEN un usuario con `recetas.crear`
- WHEN pregunta "¿cómo cargo una receta?" y recibe la respuesta
- THEN queda registrada la pregunta, la respuesta, la entrada "Cargar receta" y el resultado respondida

#### Scenario: El administrador no ve el registro
- GIVEN un ADMINISTRADOR de una farmacia
- WHEN navega la app
- THEN no hay ninguna pantalla que le muestre las consultas de sus empleados

### Requirement: CA14 — Calificación de la respuesta
Cada respuesta del chat SHALL ofrecer "¿Te sirvió?" con Sí y No. La calificación MUST guardarse en la consulta registrada y solo puede calificarla el usuario que la hizo.

#### Scenario: Respuesta que no sirvió
- GIVEN una respuesta del chat
- WHEN el usuario marca "No"
- THEN la consulta queda calificada como no útil

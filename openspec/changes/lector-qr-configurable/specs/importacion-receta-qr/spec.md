# Delta — Importación de receta digital por QR o link

## ADDED Requirements

### Requirement: Modo del lector

El panel QR SHALL tener un **modo del lector**, `CAMARA` ("Cámara") o `LECTOR` ("Lector USB"). En modo Cámara el panel es el de siempre: campo y botón "Escanear con la cámara", con el texto "Usá el lector, pegá el link o escaneá con la cámara.". En modo Lector USB el panel no muestra el botón de cámara, ni su aviso de HTTPS, ni el escáner, y su texto es "Escaneá el QR con el lector o pegá el link.". En los dos modos el campo acepta el lector USB y el link pegado.

#### Scenario: P74 — Modo Cámara

- **GIVEN** el modo efectivo es Cámara
- **WHEN** se abre `/recetas/nuevo`
- **THEN** el panel QR muestra el campo y el botón "Escanear con la cámara", como antes de este cambio
- **AND** un lector USB que escribe el código y presiona Enter en el campo lee la receta

#### Scenario: P75 — Modo Lector USB

- **GIVEN** el modo efectivo es Lector USB
- **WHEN** se abre `/recetas/nuevo`
- **THEN** el panel QR no muestra el botón de cámara ni el aviso de HTTPS
- **AND** el texto del panel es "Escaneá el QR con el lector o pegá el link."
- **AND** escanear con el lector USB o pegar el link lee la receta igual que en modo Cámara

### Requirement: Modo de la farmacia

Cada farmacia SHALL tener el parámetro `lector_qr_receta` ("Lector de QR de recetas"), con valor `CAMARA` o `LECTOR` y valor por defecto `CAMARA`. Se edita en Administración → Configuración → Parámetros con un selector, con el permiso `config.editar`, y el cambio se audita como cualquier parámetro (valor anterior y nuevo). Una farmacia sin la fila, o con un valor que no es uno de los dos, se comporta como `CAMARA`.

#### Scenario: P76 — Cambiar el modo de la farmacia

- **GIVEN** un usuario con `config.editar`
- **WHEN** elige "Lector USB" en "Lector de QR de recetas" y guarda
- **THEN** el parámetro queda en `LECTOR`
- **AND** la auditoría registra el valor anterior y el nuevo
- **AND** los equipos que siguen a la farmacia muestran el panel en modo Lector USB

#### Scenario: P77 — Valor fuera de las opciones

- **WHEN** se intenta guardar el parámetro con un valor que no es `CAMARA` ni `LECTOR`
- **THEN** se rechaza con "Elegí una de las opciones." y el valor guardado no cambia

#### Scenario: P78 — Sin permiso

- **GIVEN** un usuario sin `config.editar`
- **WHEN** abre la pantalla de Parámetros (si puede verla) o intenta guardar el parámetro
- **THEN** no puede cambiar el modo de la farmacia

#### Scenario: P79 — Farmacia sin la fila

- **GIVEN** una farmacia sin la fila `lector_qr_receta`, o con un valor desconocido
- **WHEN** se abre `/recetas/nuevo`
- **THEN** el modo de la farmacia es Cámara

### Requirement: Modo del equipo

El panel QR SHALL ofrecer un selector "En este equipo" con las opciones "Según la farmacia (<modo de la farmacia>)", "Cámara" y "Lector USB", que puede usar cualquier usuario que llega al panel (`recetas.crear`). La elección se guarda en el navegador de ese equipo, por farmacia, y no se audita: solo cambia lo que muestra ese equipo. "Según la farmacia" borra la elección. El selector no envía el formulario ni mueve el foco.

#### Scenario: P80 — El equipo pisa a la farmacia

- **GIVEN** la farmacia en Lector USB
- **WHEN** en un equipo se elige "Cámara" en "En este equipo"
- **THEN** ese equipo muestra el botón de cámara, también después de recargar
- **AND** los demás equipos siguen en Lector USB

#### Scenario: P81 — Volver a seguir a la farmacia

- **GIVEN** un equipo con "Cámara" elegido y la farmacia en Lector USB
- **WHEN** se elige "Según la farmacia (Lector USB)"
- **THEN** el equipo pasa a Lector USB
- **AND** si después la farmacia cambia a Cámara, el equipo pasa a Cámara

#### Scenario: P82 — Preferencia perdida o no disponible

- **GIVEN** un equipo con una elección guardada
- **WHEN** se borran los datos del navegador, se usa otro navegador o una ventana privada, o el navegador bloquea el guardado
- **THEN** el equipo sigue el modo de la farmacia
- **AND** si el navegador bloquea el guardado, una elección hecha vale solo para la página abierta

### Requirement: Modo efectivo

El modo efectivo SHALL ser el del equipo si eligió "Cámara" o "Lector USB"; si no, el de la farmacia; si tampoco hay, Cámara. Un valor guardado desconocido, en cualquiera de los dos niveles, se ignora.

#### Scenario: P83 — Resolución del modo

- **WHEN** se combinan el modo de la farmacia (Cámara, Lector USB o ausente) con el del equipo (Cámara, Lector USB, "Según la farmacia", ausente o desconocido)
- **THEN** manda el del equipo si es Cámara o Lector USB, si no el de la farmacia, y si no Cámara

### Requirement: El modo no cambia la lectura

El modo SHALL decidir solo qué muestra el panel. La Server Action, la extracción del hash, la consulta a RCTA, las validaciones, las reglas de foco y la `Permissions-Policy` de `/recetas/nuevo` (`camera=(self)`) son las mismas en los dos modos; el servidor no lee el modo del equipo ni rechaza una lectura por el modo. Si el modo pasa a Lector USB con la cámara abierta, el escáner se cierra y se detienen todas las pistas del `MediaStream`.

#### Scenario: P84 — Cambio de modo con la cámara abierta

- **GIVEN** la cámara abierta en modo Cámara
- **WHEN** se elige "Lector USB" en "En este equipo"
- **THEN** el escáner se cierra y la luz de la cámara se apaga
- **AND** el campo sigue funcionando

#### Scenario: P85 — Gadnic CODBAR10 (verificación manual)

- **GIVEN** un Gadnic CODBAR10 conectado por USB, configurado con sufijo Enter, y el equipo en modo Lector USB
- **WHEN** se le acerca el QR de una receta RCTA
- **THEN** el panel lee la receta y muestra la vista previa

## MODIFIED Requirements

### Requirement: Cámara por el mismo camino

En modo Cámara, el botón "Escanear con la cámara" del panel SHALL abrir la cámara, leer el QR y mandar el texto leído **por el mismo camino que un código escrito**: lo pone en el mismo campo y envía el mismo formulario (`requestSubmit`), con la misma Server Action y las mismas validaciones. La cámara no valida nada por su cuenta. En modo Lector USB el botón no se muestra (ver «Modo del lector»).

#### Scenario: QR leído con la cámara

- **WHEN** la cámara lee un QR con un hash de receta
- **THEN** el texto se pone en el campo y se envía con `requestSubmit` por la misma Server Action

### Requirement: Cámara solo con HTTPS

Los navegadores solo dan la cámara a una página segura (HTTPS o `localhost`). En modo Cámara, en una página no segura (por ejemplo, `http://192.168.x.x:3000` desde un celular en la red local) el botón SHALL quedar deshabilitado y explicar que hace falta HTTPS. En modo Lector USB no se muestran ni el botón ni la explicación.

#### Scenario: P60–P61 — Errores de cámara

- **WHEN** el permiso se deniega, no hay cámara, la cámara está en uso, el contexto es inseguro o no hay API
- **THEN** se muestra un mensaje claro y el campo manual sigue funcionando
- **AND** sobre `http://` en la red local el botón se deshabilita con su explicación

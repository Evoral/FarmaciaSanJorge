# Importación de receta digital desde PDF

## Purpose

En `/recetas/nuevo`, el usuario sube el PDF de una receta digital; el sistema lo lee, precarga el formulario y muestra
una vista previa, y nada se guarda hasta que el usuario confirma.

> Fuente: decisiones del usuario (2026-09-29), sobre una receta real de la plataforma RCTA ("Tu Recetario Digital").
> Resuelve DP-23 y DP-29 (ver `docs/plan-implementacion.md` §21, DP-42).
> Las notas **[ACLARACIÓN]** son deducciones de consistencia; no agregan requisitos.

## Requirements

### Requirement: Vista previa sin guardar

En `/recetas/nuevo`, el usuario sube el PDF de una receta digital. El sistema SHALL leerlo, **precargar el formulario** y mostrar una vista previa con advertencias. Nada se guarda hasta que el usuario confirma.

#### Scenario: Leer un PDF y no confirmar

- **GIVEN** un usuario con `recetas.crear`
- **WHEN** sube el PDF de una receta digital en `/recetas/nuevo`
- **THEN** el formulario queda precargado y se muestra la vista previa con advertencias
- **AND** no se guarda nada mientras no confirme

### Requirement: Alta en una sola transacción al confirmar

Al confirmar, en **una sola transacción**, el sistema SHALL dar de alta el paciente y el médico que falten, crear la receta y guardar los alias de drogas que el usuario eligió recordar.

#### Scenario: Confirmar con paciente y médico nuevos

- **GIVEN** una vista previa con un paciente y un médico que no existen y una droga marcada para recordar su equivalencia
- **WHEN** el usuario confirma
- **THEN** en una sola transacción se dan de alta el paciente y el médico, se crea la receta y se guarda el alias

### Requirement: El PDF no se almacena

El PDF MUST NOT almacenarse: vive en memoria durante la lectura y se descarta.

#### Scenario: Después de la lectura

- **WHEN** termina la lectura de un PDF
- **THEN** el PDF no queda guardado en ningún lado

### Requirement: Vista previa compartida con el QR y rótulo del origen

La misma vista previa y confirmación SHALL alimentarse también desde el QR o link de la receta (`openspec/specs/importacion-receta-qr/spec.md`). El rótulo del origen `DIGITAL_PDF` es "Digital (PDF o QR)".

#### Scenario: Rótulo del origen

- **WHEN** se muestra el origen de una receta `DIGITAL_PDF`
- **THEN** el rótulo es "Digital (PDF o QR)"

### Requirement: Datos de la receta desde RCTA

**Decisión del usuario (2026-10-23).** Los datos de la receta SHALL salir de RCTA, por el mismo camino que el QR, y no del texto del PDF, para que un PDF y un QR de la misma receta carguen exactamente lo mismo.

#### Scenario: PDF y QR de la misma receta

- **GIVEN** una receta RCTA leída una vez desde su PDF y otra desde su QR
- **WHEN** se comparan las dos vistas previas
- **THEN** cargan exactamente los mismos datos

### Requirement: Hash del link del PDF

El link "Ver Link" del PDF (`https://verumrp.com.ar/prescripcion/<hash>`) lleva el mismo hash que el QR impreso al lado: `hashDeLinksPdf` (`domain/receta-qr.ts`) SHALL tomarlo con `extraerHashRcta`. No se decodifica la imagen del QR.

#### Scenario: PDF con el link de RCTA

- **GIVEN** un PDF con el link "Ver Link" `https://verumrp.com.ar/prescripcion/<hash>`
- **WHEN** se lee el PDF
- **THEN** se toma ese hash con `extraerHashRcta`, sin decodificar la imagen del QR

### Requirement: Consulta a RCTA con el hash del PDF

Con el hash del link del PDF, `leerRecetaRcta` (`application/lectura-rcta.ts`, compartido con `leer-receta-qr.ts`) SHALL consultar a RCTA y aplicar `mapearRecetaRcta`. Corre en el `prepare` de la query, fuera de la transacción.

#### Scenario: Consulta durante la lectura

- **WHEN** se lee un PDF con link de RCTA
- **THEN** la consulta a RCTA corre en el `prepare`, sin ninguna transacción abierta

### Requirement: Solo el nombre del paciente sale del texto del PDF

Del texto del PDF SHALL tomarse **solo el nombre del paciente** (RCTA lo anonimiza), con el parser de la Pieza 2: `conNombrePacienteDelPdf` (`domain/receta-rcta-json.ts`). Si el parser no lo encuentra, queda para escribirlo, con su advertencia. El parser de la Pieza 2 queda como está: hoy solo aporta el nombre del paciente.

#### Scenario: Parser que encuentra el nombre

- **WHEN** se lee un PDF cuyo texto trae `Paciente: <nombre completo>`
- **THEN** el nombre del paciente de la vista previa es ese, y el resto de los datos sale de RCTA

#### Scenario: Parser que no encuentra el nombre

- **WHEN** se lee un PDF cuyo texto el parser no puede leer
- **THEN** el nombre del paciente queda para escribirlo, con su advertencia

### Requirement: Error sin RCTA

Sin link de RCTA, o si RCTA no encuentra la receta, no responde o responde en otro formato, la lectura SHALL terminar en **error** (`MENSAJES_LECTURA_PDF`), sin volver a leer el texto del PDF. La carga manual sigue disponible.

#### Scenario: PDF sin link de RCTA

- **WHEN** se lee un PDF sin link de RCTA
- **THEN** la lectura termina en un error de `MENSAJES_LECTURA_PDF` y no se usan los datos del texto
- **AND** la carga manual sigue disponible

#### Scenario: RCTA no responde

- **GIVEN** un PDF con link de RCTA
- **WHEN** RCTA no responde
- **THEN** la lectura termina en un error de `MENSAJES_LECTURA_PDF`

### Requirement: Válida desde no anterior a la prescripción

La confirmación (`recetas.importar`) SHALL validar además que "válida desde" no sea anterior a la fecha de prescripción, igual que el alta y la edición.

#### Scenario: Válida desde anterior

- **WHEN** se confirma una importación con "válida desde" anterior a la fecha de prescripción
- **THEN** se rechaza

### Requirement: Pieza 1 — Extracción

La extracción (`import "server-only"` + `unpdf`) SHALL devolver solo `TextItemLite[][]` (`str, x, y, width, height`) y los links del documento (anotaciones `Link` con URI). Nada más.

#### Scenario: Extraer un PDF

- **WHEN** se extrae un PDF
- **THEN** se obtienen sus items de texto y sus links con URI, y nada más

### Requirement: Pieza 2 — Parser puro

El parser SHALL ser una función **pura**: recibe los items y links y devuelve `{ borrador, advertencias }`. Se testea con datos sintéticos, sin PDFs binarios en el repo. Los fixtures del parser se arman a mano con datos **ficticios**. El PDF real contiene datos personales de un paciente y **no** se versiona.

#### Scenario: P1 — Muestra RCTA (datos sintéticos equivalentes)

- **GIVEN** los items y links sintéticos equivalentes a la muestra RCTA
- **WHEN** se parsean
- **THEN** el emisor es `RCTA`, con nro de receta y URL presentes
- **AND** el paciente tiene 2 palabras (separación sin confirmación) y el médico es `PROVINCIAL`
- **AND** hay 6 componentes `POR_DOSIS` (incluye `0,3 mg` → 0.3 y `1,6 mg` → 1.6)
- **AND** la presentación es `COMPRIMIDO` × 60 (30 recetados a media dosis), con fracción 0.5
- **AND** la posología es `Media dosis cada 12 horas`, la duración 30 y el diagnóstico `E66.0`
- **AND** el renglón `- …` se lee como domicilio del paciente (sin el `- `, sin advertencia)
- **AND** no hay advertencia de consistencia

### Requirement: Pieza 3 — Orden obligatorio de la frontera de confianza

La server action de lectura SHALL validar el archivo en este orden obligatorio: permiso `recetas.crear`; `instanceof File`; `size === 0` → error; `size > MAX_PDF_BYTES` (1 MB, igual al `bodySizeLimit` de Server Actions) → error, **antes** de `arrayBuffer()`; `file.type === "application/pdf"`; firma `%PDF-` en los primeros 1024 bytes. La firma es el chequeo que realmente vale.

#### Scenario: P8 — Frontera

- **WHEN** se sube un archivo vacío, uno de más de 1 MB, uno de tipo incorrecto, o un `.exe` renombrado a `.pdf` (sin firma `%PDF-`)
- **THEN** cada uno se rechaza con error

#### Scenario: Archivo de más de 1 MB

- **WHEN** se sube un archivo de más de 1 MB
- **THEN** se rechaza antes de leer su contenido con `arrayBuffer()`

### Requirement: PDF cifrado

Un PDF cifrado solo con contraseña de permisos (la muestra de RCTA usa AES-128 sin contraseña de apertura) SHALL leerse igual. Si pide contraseña de apertura → error "PDF protegido".

#### Scenario: Contraseña de permisos

- **WHEN** se sube un PDF cifrado con AES-128 solo con contraseña de permisos
- **THEN** se lee igual

#### Scenario: Contraseña de apertura

- **WHEN** se sube un PDF que pide contraseña de apertura
- **THEN** se rechaza con "PDF protegido"

### Requirement: Datos personales de la lectura (DP-24)

El PDF y el borrador SHALL viajar solo por POST; nunca en URL ni en logs. La lectura **no** se audita (es una consulta); lo que se audita es la confirmación.

#### Scenario: Leer sin confirmar

- **WHEN** se lee un PDF y no se confirma
- **THEN** no se escribe auditoría, y ni el PDF ni el borrador aparecen en una URL ni en logs

### Requirement: Renglones visuales

El parser SHALL agrupar los items en renglones visuales por proximidad de `y`, con tolerancia `max(2, medianaAltura × 0.6)`. Dentro del renglón, ordena por `x` y une con espacio.

#### Scenario: Dos items a la misma altura

- **GIVEN** items con `medianaAltura` 10 (tolerancia `max(2, 6)` = 6) y dos items cuyas `y` difieren en 1
- **WHEN** se arman los renglones
- **THEN** los dos items forman un renglón, ordenados por `x` y unidos con espacio

### Requirement: Detección de emisor

El logo del emisor es una imagen: el logo SHALL NOT detectarse por texto. Se detecta por el host del link de verificación o por el número de registro `RL-AAAA-NNNNNNNNN`, según la tabla «Detección de emisor». Cada emisor nuevo es un parser nuevo (estrategia por emisor), con sus propios tests.

#### Scenario: Link de RCTA

- **WHEN** se parsea un PDF con un link a `verumrp.com.ar/prescripcion/…`
- **THEN** el emisor es `RCTA`

### Requirement: Emisor desconocido

Con emisor desconocido el parser SHALL responder "formato de receta no reconocido" y no precargar nada.

#### Scenario: P2 — Sin link ni registro reconocible

- **WHEN** se parsea un PDF sin link ni registro reconocible
- **THEN** responde "formato no reconocido"

### Requirement: Campos del encabezado (RCTA)

El parser RCTA SHALL llevar cada campo del encabezado del PDF a su destino según la tabla «Campos del encabezado (RCTA)», con las reglas de esa tabla.

#### Scenario: Encabezado completo

- **WHEN** se parsea un encabezado RCTA con `Creada: 01/09/2026`, `Válida desde: 02/09/2026`, `DNI:` y `CUIL:`
- **THEN** `receta.fechaPrescripcion` es el 01/09/2026, `receta.fechaValidaDesde` el 02/09/2026, y DNI y CUIL van a `paciente.dni` y `paciente.cuil`

#### Scenario: Link de verificación ausente

- **WHEN** se parsea un PDF RCTA sin el link "Ver Link"
- **THEN** `receta.urlVerificacion` queda vacío, sin impedir la importación

### Requirement: Número de receta del emisor obligatorio

El número del código de barras (arriba a la izquierda, solo dígitos, ≥ 10) SHALL ir a `receta.nroRecetaEmisor` y es obligatorio: si falta, no se puede importar.

#### Scenario: P4 — Sin número de receta del emisor

- **WHEN** se parsea un PDF sin número de receta del emisor
- **THEN** no es importable

### Requirement: Cobertura y plan ignorados

Del campo `N° Credencial:` SHALL tomarse solo `paciente.nroCredencial`; cobertura y plan se ignoran (DP-30).

#### Scenario: Credencial con cobertura

- **WHEN** se parsea un encabezado con `N° Credencial:`, cobertura y plan
- **THEN** solo se toma el número de credencial

### Requirement: Datos del médico del encabezado

La especialidad del médico SHALL ser el texto después de `MÉDICO - ` (`MÉDICO - MEDICINA GENERAL`). `Matrícula Prov.:NNNN` / `MP NNNN` va a `medico.matricula` con `jurisdiccion = PROVINCIAL`; `Nac.` / `MN` → `NACIONAL`. La dirección y el teléfono del pie van a `medico.direccionRegistrada` y `medico.telefono`.

#### Scenario: Matrícula provincial

- **WHEN** se parsea `MÉDICO - MEDICINA GENERAL` y `MP 1234`
- **THEN** la especialidad es `MEDICINA GENERAL`, la matrícula 1234 y la jurisdicción `PROVINCIAL`

#### Scenario: Matrícula nacional

- **WHEN** se parsea `MN 1234`
- **THEN** la jurisdicción es `NACIONAL`

### Requirement: Diagnóstico del encabezado

`Diagnóstico: <código> - <descripción>` SHALL ir a `receta.diagnosticoCodigo` (código CIE-10) y `receta.diagnosticoDescripcion`.

#### Scenario: Diagnóstico de la muestra

- **WHEN** se parsea `Diagnóstico: E66.0 - <descripción>`
- **THEN** el código es `E66.0` y la descripción es el texto después del guion

### Requirement: Clasificación de los renglones del cuerpo Rp./

Cada renglón del cuerpo `Rp./` (entre `Rp./` y `Diagnóstico:`) SHALL clasificarse con la primera regla que matchee, en este orden: Domicilio del paciente, Componente, Presentación, Fracción de dosis, Posología, Duración, Otro (tabla «Cuerpo Rp./»).

#### Scenario: Renglón que matchea dos reglas

- **WHEN** un renglón del cuerpo matchea la regla Componente y también una regla posterior
- **THEN** se clasifica como Componente

### Requirement: Domicilio en el cuerpo Rp./

Un renglón que empieza con `- ` inmediatamente después de `Rp./` SHALL salir del cuerpo sin advertencia y su texto, sin el `- `, precarga `receta.domicilioPaciente`. Solo ese primer renglón: un `- …` más abajo cae en "Otro".

#### Scenario: Primer renglón con guion

- **WHEN** el renglón inmediatamente después de `Rp./` es `- Avellaneda 14 las Heras`
- **THEN** `receta.domicilioPaciente` se precarga con `Avellaneda 14 las Heras`, sin advertencia

#### Scenario: Renglón con guion más abajo

- **WHEN** un renglón `- …` aparece después del primero del cuerpo
- **THEN** cae en "Otro" y genera advertencia con su texto

### Requirement: Renglón componente

Un renglón que matchea `^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|µg|ml|UI|%)$` (patrón ilustrativo) SHALL ser un componente `POR_DOSIS`, con la cantidad en es-AR (coma decimal). Si es principio activo no se lee del PDF: lo define la clase de la droga elegida en el catálogo (`DROGA`), al guardar.

#### Scenario: Cantidad con coma decimal

- **WHEN** el cuerpo tiene un renglón con `0,3 mg`
- **THEN** es un componente `POR_DOSIS` de cantidad 0.3 en `mg`

### Requirement: Renglón presentación

Un renglón que matchea `^(\d+)\s+(comprimidos?|c[áa]psulas?|…)$`, o en orden inverso `^(comprimidos?|c[áa]psulas?|…)\s*(:|x)?\s*(\d+)$` («Cápsulas 30»), SHALL dar `cantidadUnidades` + `formaFarmaceutica` por léxico.

#### Scenario: Orden inverso

- **WHEN** el cuerpo tiene el renglón «Cápsulas 30»
- **THEN** da 30 unidades y la forma farmacéutica de cápsulas

### Requirement: Renglón fracción de dosis

Un renglón que contiene `media dosis` / `½ dosis` SHALL dar `fraccionDosisPorUnidad = 0.5` (convención de `openspec/specs/ficha-tecnica/spec.md`, asiento 34147), y se duplican las unidades a elaborar.

#### Scenario: Media dosis

- **WHEN** el cuerpo tiene un renglón con `media dosis`
- **THEN** `fraccionDosisPorUnidad` es 0.5

### Requirement: Renglón posología

Un renglón que contiene `cada N horas` (u otra indicación de toma) SHALL ir literal a `item.posologia`.

#### Scenario: Cada 8 horas

- **WHEN** el cuerpo tiene el renglón `1 comprimido cada 8 horas`
- **THEN** `item.posologia` es `1 comprimido cada 8 horas`

### Requirement: Renglón duración

Un renglón `tratamiento por N d[ií]as`, con o sin texto a continuación («Tratamiento por 30 días de …»), SHALL dar `item.duracionTratamientoDias = N`. El texto que sigue a «días» se descarta sin advertencia (decisión del usuario, 2026-10-14).

#### Scenario: Duración con texto a continuación

- **WHEN** el cuerpo tiene el renglón «Tratamiento por 30 días de …»
- **THEN** `item.duracionTratamientoDias` es 30 y el resto se descarta sin advertencia

### Requirement: Renglón no clasificable

Un renglón del cuerpo que no matchea ninguna otra regla («Otro») SHALL generar una **advertencia visible** con el texto del renglón.

#### Scenario: P3 — Renglón no clasificable

- **WHEN** el cuerpo tiene un renglón no clasificable
- **THEN** hay una advertencia con el texto literal

### Requirement: Dosis completa y fracción por defecto

La dosis indicada SHALL ser la dosis completa: los componentes se cargan `POR_DOSIS`. Sin mención de fracción → `fraccionDosisPorUnidad = 1`.

#### Scenario: Sin fracción

- **WHEN** el cuerpo no menciona una fracción de dosis
- **THEN** `fraccionDosisPorUnidad` es 1

### Requirement: Unidades a elaborar

La cantidad de la receta («30 comprimidos») cuenta dosis completas. Cada unidad elaborada lleva `fraccionDosisPorUnidad` de dosis, así que `cantidadUnidades` SHALL ser `unidades recetadas / fracción`. Decisión del usuario (2026-10-07).

#### Scenario: 30 comprimidos a media dosis

- **WHEN** el cuerpo tiene «30 comprimidos» y «Media dosis cada 12 horas»
- **THEN** se elaboran **60** comprimidos de media dosis, para que el paciente no tenga que partirlos

### Requirement: Renglón de fracción y posología

Un renglón que es a la vez fracción y posología (`Media dosis cada 12 horas`) SHALL aplicar ambas.

#### Scenario: Media dosis cada 12 horas

- **WHEN** el cuerpo tiene `Media dosis cada 12 horas`
- **THEN** `fraccionDosisPorUnidad` es 0.5 y `item.posologia` es `Media dosis cada 12 horas`

### Requirement: Un ítem por receta RCTA

Una receta RCTA SHALL tener un único ítem. Si aparecen señales de más de un ítem → advertencia.

#### Scenario: Señales de dos ítems

- **WHEN** el cuerpo muestra señales de más de un ítem
- **THEN** hay una advertencia

### Requirement: Control de consistencia

Con `cantidadUnidades` (ya convertidas a unidades a elaborar), tomas por día (`24 / N horas`, una unidad por toma) y `duracionTratamientoDias`, si `cantidadUnidades / tomasPorDia ≠ duracion` el parser SHALL dar la advertencia "Las unidades alcanzan para X días; la receta indica Y". Es solo advertencia, nunca bloquea.

#### Scenario: La muestra no la dispara

- **WHEN** se parsean 30 comprimidos a media dosis (60 unidades), una toma cada 12 h, 30 días
- **THEN** no hay advertencia de consistencia

#### Scenario: Unidades que no alcanzan

- **WHEN** se parsean 30 comprimidos (fracción 1), una toma cada 8 h (3 tomas por día) y tratamiento por 30 días
- **THEN** aparece la advertencia "Las unidades alcanzan para 10 días; la receta indica 30"
- **AND** la importación no se bloquea

### Requirement: Domicilio del paciente por receta

**Decisión del usuario (2026-10-07).** El domicilio del paciente SHALL guardarse **por receta** (`receta.domicilio_paciente`, migración 0070): para un reclamo importa el domicilio a la fecha de la receta. Nunca se usa para el match. **Actualizado (2026-10-23, `openspec/specs/domicilios/spec.md` D3):** si se confirma sin cambios, además actualiza el domicilio del cliente (`paciente.domicilio`, migración 0099).

#### Scenario: Match con domicilio distinto

- **GIVEN** un paciente existente con el mismo CUIL y otro domicilio
- **WHEN** se lee una receta con domicilio
- **THEN** el match lo encuentra igual por CUIL y la receta guarda su propio domicilio

### Requirement: Formato del domicilio del paciente

El domicilio del paciente SHALL ser opcional, texto libre: se recorta, vacío → `NULL`, máximo 300 caracteres (el parser trunca a ese largo).

#### Scenario: Domicilio de más de 300 caracteres

- **WHEN** el renglón de domicilio tiene más de 300 caracteres
- **THEN** el parser lo trunca a 300

### Requirement: Domicilio del paciente en los formularios

El formulario SHALL precargar el domicilio del paciente y el usuario puede corregirlo o borrarlo antes de confirmar. La carga manual y la edición también lo aceptan (campo "Domicilio del paciente", junto al paciente). El detalle de la receta y el puesto de toma de `/preparaciones` lo muestran bajo el paciente.

#### Scenario: Borrar el domicilio precargado

- **WHEN** el usuario borra el domicilio precargado y confirma
- **THEN** la receta queda sin domicilio del paciente

### Requirement: Excepción al registrar un envío

Excepción a "solo editable en `PENDIENTE_PREPARACION`": al registrar un envío de una receta `PREPARADA` sin domicilio, `registrarEntrega` SHALL guardarlo (`openspec/specs/envios-repartidores/spec.md` E4).

#### Scenario: Envío de una receta PREPARADA sin domicilio

- **GIVEN** una receta `PREPARADA` sin domicilio
- **WHEN** se registra un envío con el domicilio escrito
- **THEN** `registrarEntrega` lo guarda

### Requirement: Domicilio desde el QR

En el QR (`openspec/specs/importacion-receta-qr/spec.md`, "Renglones del cuerpo") el JSON de RCTA no trae un campo de domicilio; SHALL tomarse del primer renglón inicial del primer ítem, **con o sin guion** (el JSON no lo trae), con la misma normalización (`domicilioDesdeRenglon`, compartida).

#### Scenario: Primer renglón sin guion

- **WHEN** el primer renglón inicial del primer ítem del JSON es `Complejo sol naciente casa 10 Guaymallén`
- **THEN** precarga el domicilio del paciente

### Requirement: Separación de nombres

Con 2 palabras, la última SHALL ser el apellido. Con 3 o más → mejor esfuerzo (última palabra como apellido) y la vista previa **exige confirmación** del usuario.

#### Scenario: Dos palabras

- **WHEN** el nombre completo es `Ana Pérez`
- **THEN** el nombre es `Ana` y el apellido `Pérez`, sin confirmación

#### Scenario: P5 — Paciente de 3+ palabras

- **WHEN** el nombre completo del paciente tiene 3 o más palabras
- **THEN** la última es el apellido y la vista previa requiere confirmación

### Requirement: Pacientes como nombre apellido en los listados

En las tablas y listados, los **pacientes** SHALL mostrarse siempre como `nombre apellido`. Así, aunque la separación sea incorrecta, el nombre completo se lee igual.

#### Scenario: Separación incorrecta

- **GIVEN** un paciente `María José Gómez` separado como nombre `María José` y apellido `Gómez`
- **WHEN** aparece en un listado
- **THEN** se lee `María José Gómez`

### Requirement: Normalización del match

El match SHALL normalizar: minúsculas, NFD, sin diacríticos, espacios colapsados, trim; para drogas también se ignora la puntuación final («ACEITE DE GIRASOL.» = «ACEITE DE GIRASOL»; también en la factura de compra). La comparación es **exacta** sobre el normalizado; sin fuzzy.

#### Scenario: P7 — Match de drogas

- **WHEN** una droga tiene alias guardado, otra se escribe sin alias y con acento distinto, y otra con error ortográfico
- **THEN** la primera matchea por el alias, la segunda por normalización, y la tercera no matchea

#### Scenario: Puntuación final

- **WHEN** la receta trae «ACEITE DE GIRASOL.»
- **THEN** matchea la droga «ACEITE DE GIRASOL»

### Requirement: Match de paciente

El paciente SHALL buscarse por CUIL; si no, por DNI, incluidos los dados de baja. Sin match → alta nueva al confirmar. Si el match está dado de baja → advertencia; el usuario decide (no se reactiva solo).

#### Scenario: Paciente dado de baja

- **GIVEN** un paciente dado de baja con el CUIL de la receta
- **WHEN** se lee la receta
- **THEN** hay una advertencia y el paciente no se reactiva solo

### Requirement: Match de médico

El médico SHALL buscarse por (`jurisdiccion`, `matricula`) entre vigentes. Sin match → alta nueva al confirmar.

#### Scenario: Médico sin match

- **WHEN** no hay médico vigente con la jurisdicción y matrícula de la receta
- **THEN** se da de alta uno nuevo al confirmar

### Requirement: Match de droga

La droga SHALL buscarse por `droga_alias.aliasNormalizado` (sinónimo vigente de droga vigente), luego por `droga.nombre` normalizado. Solo vigentes y nunca de clase `MATERIAL` (cápsulas, envases: no se prescriben; tampoco aparecen en el buscador de drogas de la receta).

#### Scenario: Droga de clase MATERIAL

- **WHEN** el nombre de un renglón coincide con una droga de clase `MATERIAL`
- **THEN** no matchea

### Requirement: Droga sin match

Sin match de droga, el usuario SHALL elegir la droga en la vista previa; la opción "recordar esta equivalencia" agrega el texto como **sinónimo** de esa droga (`openspec/specs/sinonimos-droga/spec.md`).

#### Scenario: Recordar la equivalencia

- **WHEN** el usuario elige una droga para un texto sin match, tilda "recordar esta equivalencia" y confirma
- **THEN** el texto queda como sinónimo de esa droga

### Requirement: Match de unidad

La unidad SHALL buscarse por `simbolo` / `codigo` normalizado (`mg` → MILIGRAMO). Sin match → advertencia; el usuario elige.

#### Scenario: mg

- **WHEN** la receta trae `mg`
- **THEN** matchea MILIGRAMO

### Requirement: Paciente o médico existente

Para un paciente o médico **existente** SHALL completarse solo los campos vacíos con datos del PDF; nunca se pisa un valor existente. Si hay diferencias (ej. otro teléfono) → advertencia informativa.

#### Scenario: P9 — Paciente existente

- **GIVEN** un paciente existente con fecha de nacimiento vacía y otro teléfono
- **WHEN** se lee una receta de ese paciente
- **THEN** la vista previa muestra una advertencia por el teléfono distinto
- **AND** al confirmar, la fecha de nacimiento se completa y el teléfono no se pisa

### Requirement: Teléfono del paciente nuevo

Para un paciente **nuevo** el formulario SHALL ofrecer un campo "Teléfono (opcional)": los archivos (PDF, QR) nunca traen el teléfono del paciente; cargarlo acá evita editar el paciente después. El alta rápida del picker (carga manual) ofrece el mismo campo. Decisión del usuario (2026-10-14).

#### Scenario: Paciente nuevo

- **WHEN** la vista previa tiene un paciente nuevo
- **THEN** ofrece el campo "Teléfono (opcional)"

### Requirement: Receta ya importada

Una receta ya importada (mismo `emisor` + `nroRecetaEmisor`, no ANULADA) SHALL dar el error "Esta receta ya fue cargada (receta interna N°…)" antes de mostrar la vista previa.

#### Scenario: P6 — Receta ya importada

- **GIVEN** una receta con el mismo `emisor` + `nroRecetaEmisor`, no ANULADA
- **WHEN** se lee de nuevo
- **THEN** hay un error con el número interno existente, antes de la vista previa

#### Scenario: P6 — Anterior anulada

- **GIVEN** la única receta con el mismo `emisor` + `nroRecetaEmisor` está ANULADA
- **WHEN** se lee de nuevo
- **THEN** se permite

### Requirement: Confirmación — comando recetas.importar

La confirmación SHALL ser una transacción con permiso `recetas.crear`: alta de paciente y/o médico nuevos, o completado de campos vacíos de los existentes; alta de la receta con `origen = DIGITAL_PDF`, `emisor`, `nroRecetaEmisor`, `urlVerificacion`, diagnóstico, domicilio del paciente e ítems, con las mismas validaciones V1–V9 que en la carga manual; alta de los alias de drogas marcados para recordar.

#### Scenario: Ítem inválido

- **WHEN** se confirma una importación con un ítem que no cumple una de las validaciones V1–V9
- **THEN** se rechaza como en la carga manual y no se guarda nada

### Requirement: Auditoría de la confirmación

La confirmación SHALL auditar una entrada por cada alta o modificación (paciente, médico, receta, alias), según INV-A01. Cada entrada lleva `contexto = { origen: "importacion_receta_pdf", fuente }`, con `fuente` = `"PDF"` (por defecto) o `"QR"`.

#### Scenario: Confirmar con paciente nuevo

- **WHEN** se confirma una importación por PDF con un paciente nuevo
- **THEN** hay una entrada para el paciente y otra para la receta, cada una con `contexto = { origen: "importacion_receta_pdf", fuente: "PDF" }`

### Requirement: fuente sin valor de autorización

`fuente` la declara el cliente (viaja de la vista previa al payload de confirmación): es solo para auditoría y MUST NOT tener valor de autorización; ninguna regla ni permiso depende de él.

#### Scenario: fuente alterada

- **WHEN** el cliente envía `fuente = "QR"` en una importación de PDF
- **THEN** solo cambia el valor auditado; ninguna regla ni permiso cambia

### Requirement: Permisos de alta dentro del flujo de recetas

`recetas.crear` SHALL habilitar el alta de pacientes y médicos **dentro del flujo de recetas**: tanto la importación como el alta rápida existente de los pickers. No habilita editar ni dar de baja (eso sigue en `pacientes.gestionar` / `medicos.gestionar`).

#### Scenario: Usuario solo con recetas.crear

- **GIVEN** un usuario con `recetas.crear` y sin `pacientes.gestionar`
- **WHEN** confirma una importación con un paciente nuevo
- **THEN** el paciente se da de alta
- **AND** el usuario no puede editar ni dar de baja pacientes

### Requirement: Sin atributo de receta física recibida

**Decisión del cliente (2026-10-01).** Ninguna receta, manual o importada, SHALL tener el atributo "receta física recibida" (`recetaFisicaRecibida`/`_en`/`_por_id`); INV-R07 queda superado y la regularización (INV-R10/DP-15) se eliminó.

#### Scenario: Alta de una receta

- **WHEN** se da de alta una receta, manual o importada
- **THEN** no hay dato de receta física recibida que registrar

### Requirement: Recetas DIGITAL_PDF fuera del archivo físico

Las recetas `DIGITAL_PDF` SHALL NOT entrar en lotes de archivo físico ni en destrucción (no hay papel): se excluyen en la selección de recetas elegibles de `modules/archivo`.

#### Scenario: P10 — Receta DIGITAL_PDF entregada

- **GIVEN** una receta `DIGITAL_PDF` ENTREGADA
- **WHEN** se buscan recetas elegibles para un lote de archivo
- **THEN** no aparece

### Requirement: Columnas de la receta importada

`receta` SHALL tener `emisor`, `nro_receta_emisor`, `url_verificacion`, `diagnostico_codigo` y `diagnostico_descripcion` (tabla «Cambios de esquema»). `emisor` y `nro_receta_emisor` se cargan juntos (CHECK). `diagnostico_codigo` cumple el CHECK de formato CIE-10 `^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$`.

#### Scenario: Emisor sin número

- **WHEN** se escribe una receta con `emisor` y sin `nro_receta_emisor`
- **THEN** la base la rechaza

#### Scenario: Código no CIE-10

- **WHEN** se escribe `diagnostico_codigo = E660`
- **THEN** la base lo rechaza por el CHECK de formato CIE-10

### Requirement: Adjunto de una receta digital

`receta_adjunto_digital_check` SHALL aceptar: origen no digital, **o** `archivo_adjunto_url` no nulo, **o** `nro_receta_emisor` no nulo.

#### Scenario: Receta importada sin adjunto

- **WHEN** se guarda una receta `DIGITAL_PDF` sin `archivo_adjunto_url` y con `nro_receta_emisor`
- **THEN** cumple `receta_adjunto_digital_check`

### Requirement: Unicidad de la receta importada

Un índice único parcial SHALL cubrir `(tenant_id, emisor, nro_receta_emisor) WHERE nro_receta_emisor IS NOT NULL AND estado <> 'ANULADA'`. Una receta anulada por error se puede volver a importar.

#### Scenario: Reimportar una receta anulada

- **GIVEN** una receta importada que se anuló por error
- **WHEN** se vuelve a importar
- **THEN** el índice lo permite

### Requirement: Posología y duración del ítem

`item_receta` SHALL tener `posologia` (`text NULL`) y `duracion_tratamiento_dias` (`int NULL`, CHECK `> 0`). La carga manual también puede completar diagnóstico, posología y duración.

#### Scenario: Duración cero

- **WHEN** se guarda un ítem con `duracion_tratamiento_dias = 0`
- **THEN** la base lo rechaza

### Requirement: Jurisdicción de la matrícula del médico

`medico.matricula_jurisdiccion` SHALL ser enum `NACIONAL`/`PROVINCIAL`, `NOT NULL`, con backfill de filas existentes a `PROVINCIAL`. `uq_medico_matricula_vigente` pasa a `(tenant_id, matricula_jurisdiccion, matricula)` entre vigentes. El formulario de médico (alta y edición) y el alta rápida suman el selector de jurisdicción.

#### Scenario: Misma matrícula en dos jurisdicciones

- **GIVEN** un médico vigente con matrícula 1234 `PROVINCIAL`
- **WHEN** se da de alta otro médico con matrícula 1234 `NACIONAL`
- **THEN** el índice lo permite

### Requirement: Origen DIGITAL_PDF habilitado

`validarOrigenHabilitado` SHALL habilitar `DIGITAL_PDF`; `DIGITAL_FOTO` sigue rechazado.

#### Scenario: Origen DIGITAL_FOTO

- **WHEN** se intenta guardar una receta con origen `DIGITAL_FOTO`
- **THEN** se rechaza

### Requirement: Migración 0070 — domicilio de la receta

La migración 0070 (`receta_domicilio_paciente`) SHALL agregar `receta.domicilio_paciente text NULL` + `GRANT UPDATE` de la columna a `fsj_app` (editable como el diagnóstico).

#### Scenario: Edición del domicilio

- **WHEN** la aplicación edita el domicilio del paciente de una receta editable
- **THEN** `fsj_app` puede actualizar `receta.domicilio_paciente`

## Alcance

En `/recetas/nuevo`, el usuario sube el PDF de una receta digital. El sistema lo lee, **precarga el formulario** y muestra una vista previa con advertencias. Nada se guarda hasta que el usuario confirma. Al confirmar, en **una sola transacción**, se dan de alta el paciente y el médico que falten, se crea la receta y se guardan los alias de drogas que el usuario eligió recordar.

El PDF **no se almacena**: vive en memoria durante la lectura y se descarta.

La misma vista previa y confirmación también se alimentan desde el QR o link de la receta: ver `openspec/specs/importacion-receta-qr/spec.md`. El rótulo del origen `DIGITAL_PDF` es "Digital (PDF o QR)".

Fuera de alcance: recetas escaneadas (sin capa de texto), `DIGITAL_FOTO`, obras sociales (DP-30), OCR y LLM.

## Lectura por RCTA

> **Decisión del usuario (2026-10-23).** Los datos de la receta ya no salen del texto del PDF: salen de RCTA, por el mismo camino que el QR, para que un PDF y un QR de la misma receta carguen exactamente lo mismo.

1. Frontera de confianza (Pieza 3) y extracción (Pieza 1), sin cambios.
2. El link "Ver Link" del PDF (`https://verumrp.com.ar/prescripcion/<hash>`) lleva el mismo hash que el QR impreso al lado: `hashDeLinksPdf` (`domain/receta-qr.ts`) lo toma con `extraerHashRcta`. No se decodifica la imagen del QR.
3. Con ese hash, `leerRecetaRcta` (`application/lectura-rcta.ts`, compartido con `leer-receta-qr.ts`): consulta a RCTA y `mapearRecetaRcta`. Corre en el `prepare` de la query, fuera de la transacción.
4. Del texto del PDF se toma **solo el nombre del paciente** (RCTA lo anonimiza), con el parser de la Pieza 2: `conNombrePacienteDelPdf` (`domain/receta-rcta-json.ts`). Si el parser no lo encuentra, queda para escribirlo, con su advertencia.
5. Sin link de RCTA, o si RCTA no encuentra la receta, no responde o responde en otro formato: **error** (`MENSAJES_LECTURA_PDF`), sin volver a leer el texto del PDF. La carga manual sigue disponible.

El parser de la Pieza 2 queda como está: hoy solo aporta el nombre del paciente, y sus tests siguen cubriendo el formato del PDF.

La confirmación (`recetas.importar`) valida además que "válida desde" no sea anterior a la fecha de prescripción, igual que el alta y la edición.

## Arquitectura (4 piezas)

| Pieza | Ubicación sugerida | Naturaleza |
|---|---|---|
| 1. Extracción | `modules/recetas/infrastructure/receta-pdf.server.ts` | `import "server-only"` + `unpdf`: devuelve `TextItemLite[][]` (`str, x, y, width, height`) y los links del documento (anotaciones `Link` con URI). Nada más. |
| 2. Parser | `modules/recetas/domain/receta-pdf-parser.ts` | Función **pura**. Recibe los items y links; devuelve `{ borrador, advertencias }`. Se testea con datos sintéticos, sin PDFs binarios en el repo. |
| 3. Frontera de confianza | server action de lectura | Validaciones del archivo (ver abajo). |
| 4. Match | `modules/recetas/application/` | Vincula el borrador con paciente, médico, drogas y unidades existentes. |

## Detección de emisor

| Emisor | Señal | Código |
|---|---|---|
| RCTA | link a `verumrp.com.ar/prescripcion/…` | `RCTA` |

## Campos del encabezado (RCTA)

| Campo PDF | Destino | Regla |
|---|---|---|
| Número del código de barras (arriba a la izquierda, solo dígitos, ≥ 10) | `receta.nroRecetaEmisor` | Obligatorio. Si falta → no se puede importar. |
| Link "Ver Link" | `receta.urlVerificacion` | Opcional. |
| `Creada: dd/mm/aaaa` | `receta.fechaPrescripcion` | |
| `Válida desde: dd/mm/aaaa` | `receta.fechaValidaDesde` | |
| `Paciente: <nombre completo>` | `paciente.nombre` / `apellido` | Ver "Separación de nombres". |
| `DNI:` | `paciente.dni` | |
| `CUIL:` | `paciente.cuil` | |
| `Sexo:` | `paciente.sexo` | |
| `F. Nacimiento:` | `paciente.fechaNacimiento` | |
| `N° Credencial:` | `paciente.nroCredencial` | Cobertura y plan se ignoran (DP-30). |
| Nombre del médico (bloque superior) | `medico.nombre` / `apellido` | Ver "Separación de nombres". |
| Especialidad (`MÉDICO - MEDICINA GENERAL`) | `medico.especialidad` | Texto después de `MÉDICO - `. |
| `Matrícula Prov.:NNNN` / `MP NNNN` | `medico.matricula` + `jurisdiccion = PROVINCIAL` | `Nac.` / `MN` → `NACIONAL`. |
| Dirección y teléfono del pie | `medico.direccionRegistrada`, `medico.telefono` | |
| `Diagnóstico: <código> - <descripción>` | `receta.diagnosticoCodigo`, `receta.diagnosticoDescripcion` | Código CIE-10. |
| Primer renglón `- <domicilio>` del cuerpo | `receta.domicilioPaciente` | Ver "Domicilio del paciente". |

## Cuerpo Rp./

Cuerpo `Rp./` (entre `Rp./` y `Diagnóstico:`). Cada renglón se clasifica con la primera regla que matchee:

| Regla | Patrón (ilustrativo) | Resultado |
|---|---|---|
| Domicilio del paciente | empieza con `- ` inmediatamente después de `Rp./` | Sale del cuerpo sin advertencia y su texto, sin el `- `, precarga `receta.domicilioPaciente` (ej. `- Avellaneda 14 las Heras` → `Avellaneda 14 las Heras`). Solo ese primer renglón: un `- …` más abajo cae en "Otro". |
| Componente | `^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(mg\|g\|mcg\|µg\|ml\|UI\|%)$` | Componente `POR_DOSIS`, cantidad en es-AR (coma decimal). Si es principio activo no se lee del PDF: lo define la clase de la droga elegida en el catálogo (`DROGA`), al guardar. |
| Presentación | `^(\d+)\s+(comprimidos?\|c[áa]psulas?\|…)$`, o en orden inverso `^(comprimidos?\|c[áa]psulas?\|…)\s*(:\|x)?\s*(\d+)$` («Cápsulas 30») | `cantidadUnidades` + `formaFarmaceutica` por léxico. |
| Fracción de dosis | contiene `media dosis` / `½ dosis` | `fraccionDosisPorUnidad = 0.5` (convención de `openspec/specs/ficha-tecnica/spec.md`, asiento 34147) y se duplican las unidades a elaborar (ver abajo). |
| Posología | contiene `cada N horas` (u otra indicación de toma) | Renglón literal a `item.posologia`. |
| Duración | `tratamiento por N d[ií]as`, con o sin texto a continuación («Tratamiento por 30 días de …») | `item.duracionTratamientoDias = N`. El texto que sigue a «días» se descarta sin advertencia (decisión del usuario, 2026-10-14). |
| Otro | — | **Advertencia visible** con el texto del renglón. |

## Domicilio del paciente

> Decisión del usuario (2026-10-07): el primer renglón `- …` del cuerpo RCTA es el domicilio del paciente (antes se descartaba como "significado desconocido").

- Se guarda **por receta** (`receta.domicilio_paciente`, migración 0070): para un reclamo importa el domicilio a la fecha de la receta. Nunca se usa para el match. **Actualizado (2026-10-23, `openspec/specs/domicilios/spec.md` D3):** si se confirma sin cambios, además actualiza el domicilio del cliente (`paciente.domicilio`, migración 0099).
- Opcional, texto libre: se recorta, vacío → `NULL`, máximo 300 caracteres (el parser trunca a ese largo).
- El formulario lo precarga y el usuario puede corregirlo o borrarlo antes de confirmar. La carga manual y la edición también lo aceptan (campo "Domicilio del paciente", junto al paciente). El detalle de la receta y el puesto de toma de `/preparaciones` lo muestran bajo el paciente. Excepción a "solo editable en `PENDIENTE_PREPARACION`": al registrar un envío de una receta `PREPARADA` sin domicilio, `registrarEntrega` lo guarda (`openspec/specs/envios-repartidores/spec.md` E4).
- QR (`openspec/specs/importacion-receta-qr/spec.md`, "Renglones del cuerpo"): el JSON de RCTA no trae un campo de domicilio; se toma del primer renglón inicial del primer ítem, **con o sin guion** (el JSON no lo trae), con la misma normalización (`domicilioDesdeRenglon`, compartida).

## Match

| Entidad | Orden de búsqueda | Si no hay match |
|---|---|---|
| Paciente | CUIL; si no, DNI. Incluye dados de baja. | Alta nueva al confirmar. Si el match está dado de baja → advertencia; el usuario decide (no se reactiva solo). |
| Médico | (`jurisdiccion`, `matricula`) entre vigentes. | Alta nueva al confirmar. |
| Droga | `droga_alias.aliasNormalizado` (sinónimo vigente de droga vigente), luego `droga.nombre` normalizado. Solo vigentes y nunca de clase `MATERIAL` (cápsulas, envases: no se prescriben; tampoco aparecen en el buscador de drogas de la receta). | El usuario elige la droga en la vista previa; opción "recordar esta equivalencia" agrega el texto como **sinónimo** de esa droga (`openspec/specs/sinonimos-droga/spec.md`). |
| Unidad | `simbolo` / `codigo` normalizado (`mg` → MILIGRAMO). | Advertencia; el usuario elige. |

## Archivo físico

> **Decisión del cliente (2026-10-01):** se eliminó el atributo "receta física recibida" (`recetaFisicaRecibida`/`_en`/`_por_id`) de toda receta, manual o importada; INV-R07 queda superado y la regularización (INV-R10/DP-15) se eliminó. Ver `docs/plan-implementacion.md` §21 y la migración 0051.

Las recetas `DIGITAL_PDF` **no entran** en lotes de archivo físico ni en destrucción (no hay papel): se excluyen en la selección de recetas elegibles de `modules/archivo`.

## Cambios de esquema (una migración)

**`receta`**

| Columna | Tipo | Nota |
|---|---|---|
| `emisor` | `text NULL` | Código de plataforma (`RCTA`). |
| `nro_receta_emisor` | `text NULL` | |
| `url_verificacion` | `text NULL` | |
| `diagnostico_codigo` | `varchar(10) NULL` | CHECK formato CIE-10 `^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$`. |
| `diagnostico_descripcion` | `text NULL` | |

- CHECK: `emisor` y `nro_receta_emisor` se cargan juntos.
- `receta_adjunto_digital_check` pasa a: origen no digital, **o** `archivo_adjunto_url` no nulo, **o** `nro_receta_emisor` no nulo.
- Índice único parcial: `(tenant_id, emisor, nro_receta_emisor) WHERE nro_receta_emisor IS NOT NULL AND estado <> 'ANULADA'`. Una receta anulada por error se puede volver a importar.

**`item_receta`**

| Columna | Tipo | Nota |
|---|---|---|
| `posologia` | `text NULL` | |
| `duracion_tratamiento_dias` | `int NULL` | CHECK `> 0`. |

**`medico`**

| Columna | Tipo | Nota |
|---|---|---|
| `matricula_jurisdiccion` | enum `NACIONAL`/`PROVINCIAL`, `NOT NULL` | Backfill de filas existentes a `PROVINCIAL`. |

- `uq_medico_matricula_vigente` pasa a `(tenant_id, matricula_jurisdiccion, matricula)` entre vigentes.
- El formulario de médico (alta y edición) y el alta rápida suman el selector de jurisdicción.

**`droga_alias`** (nueva, con `tenant_id` y RLS como el resto)

> Desde la migración 0067 esta tabla guarda los **sinónimos de droga** y su
> regla completa (texto tal como se escribió, baja lógica, unicidad entre
> vigentes, exclusión nombre/sinónimo, búsqueda) vive en
> `openspec/specs/sinonimos-droga/spec.md`. La tabla de abajo es el diseño original de 0049.

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid | |
| `droga_id` | uuid | FK compuesta con tenant. |
| `alias_normalizado` | text | UNIQUE `(tenant_id, alias_normalizado)` (desde 0067: único solo entre vigentes). |
| `creado_por_id` | uuid | |
| `creado_en` | timestamptz | default `now()`. |

**Dominio**: `validarOrigenHabilitado` habilita `DIGITAL_PDF`; `DIGITAL_FOTO` sigue rechazado. La carga manual también puede completar diagnóstico, posología y duración.

**Migración 0070** (`receta_domicilio_paciente`, posterior): `receta.domicilio_paciente text NULL` + `GRANT UPDATE` de la columna a `fsj_app` (editable como el diagnóstico). Rollback: `docs/rollbacks/receta-domicilio-paciente.md`.

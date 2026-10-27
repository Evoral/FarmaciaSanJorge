# Importación de receta digital por QR o link

## Purpose

En `/recetas/nuevo`, el usuario escanea el QR de una receta RCTA o pega su link; el sistema consulta la receta en
RCTA, precarga el formulario y muestra la vista previa, y nada se guarda hasta que el usuario confirma.

> Continúa `openspec/specs/importacion-receta-pdf/spec.md` (casos P1–P10). Los casos de este documento siguen la numeración desde P11.
> Reutiliza la vista previa, el formulario y el comando de confirmación (`recetas.importar`) de la importación por PDF.

## Requirements

### Requirement: Panel Importar con QR

En `/recetas/nuevo`, junto al panel "Importar desde PDF", SHALL haber un panel "Importar con QR". El usuario escanea el QR de la receta RCTA con un lector USB (que escribe el código y presiona Enter) o pega el link. El sistema extrae el **hash** de la receta, lo consulta en el servicio de RCTA, **precarga el formulario** y muestra la vista previa con avisos.

#### Scenario: Escanear con el lector USB

- **GIVEN** un usuario con `recetas.crear` en `/recetas/nuevo`
- **WHEN** escanea el QR de una receta RCTA con un lector USB que escribe el código y presiona Enter
- **THEN** el formulario queda precargado y se muestra la vista previa con avisos

### Requirement: Nada se guarda hasta confirmar

Con una importación por QR, nada SHALL guardarse hasta que el usuario confirma; la confirmación no vuelve a consultar RCTA.

#### Scenario: P52–P53 — Vista previa y confirmación

- **WHEN** se lee una receta por QR y luego se confirma
- **THEN** la vista previa es la misma que la del PDF
- **AND** confirmar no vuelve a consultar RCTA

### Requirement: Una sola importación activa

Solo SHALL haber una importación activa: leer otra receta (por PDF o por QR) reemplaza la anterior. "Descartar importación" vuelve al formulario manual.

#### Scenario: Leer otra receta

- **GIVEN** una receta leída por QR
- **WHEN** se lee otra receta por PDF
- **THEN** la nueva reemplaza a la anterior

#### Scenario: P54 — Descartar

- **GIVEN** una receta leída por QR
- **WHEN** el usuario elige "Descartar importación"
- **THEN** vuelve al formulario manual y no se guarda nada

### Requirement: Flujo — permiso antes de la consulta

El permiso `recetas.crear` SHALL verificarse **antes** de cualquier consulta externa.

#### Scenario: Sin permiso no se consulta

- **GIVEN** un usuario sin `recetas.crear`
- **WHEN** envía un código de receta
- **THEN** se rechaza sin consultar RCTA

### Requirement: Flujo — extracción antes de la consulta

La extracción del hash del texto SHALL ser una función pura. Sin hash válido, no hay consulta.

#### Scenario: Código inválido no se consulta

- **WHEN** se envía un texto sin hash válido
- **THEN** no se consulta RCTA

### Requirement: Flujo — consulta fuera de toda transacción

La consulta HTTP al servicio de RCTA SHALL hacerse **fuera de toda transacción** de base de datos. Después, el JSON se valida y se mapea al mismo borrador que produce el PDF (`BorradorReceta`).

#### Scenario: Ninguna transacción abierta

- **WHEN** se consulta RCTA
- **THEN** no hay ninguna transacción de base de datos abierta

### Requirement: Flujo — match y duplicado después de la consulta

El match con paciente, médico, drogas y unidades, y la detección de receta duplicada SHALL hacerse solo después de la consulta.

#### Scenario: Receta ya cargada

- **GIVEN** una receta no ANULADA con el mismo emisor y número de receta del emisor
- **WHEN** se lee por QR
- **THEN** después de consultar RCTA se informa que la receta ya fue cargada

#### Scenario: Anterior anulada

- **GIVEN** la única receta con el mismo emisor y número está ANULADA
- **WHEN** se lee por QR
- **THEN** se permite

#### Scenario: P46–P51 — Consulta y match

- **WHEN** se lee por QR sin permiso, con un código inválido, una receta ya cargada, o la receta de un paciente existente o nuevo
- **THEN** sin permiso no se consulta y un código inválido no se consulta
- **AND** la receta ya cargada se informa (y se permite si la anterior está ANULADA)
- **AND** el paciente existente o nuevo se resuelve por el match
- **AND** no hay ninguna transacción abierta durante la consulta

### Requirement: Flujo — confirmación igual que el PDF

La confirmación SHALL usar el mismo flujo que el PDF: el mismo comando `recetas.importar`, con sus mismas reglas (V1–V9, el `principio activo` de cada componente según la clase de la droga, y que la receta no tenga más de un mes desde su prescripción o, si trae fecha de validez, que esa fecha sea del mes en curso aunque la prescripción sea más antigua; una receta vencida se rechaza al confirmar).

#### Scenario: P73 — Vigencia y principio activo

- **WHEN** se confirma una importación por PDF o por QR
- **THEN** se aplica la misma vigencia de un mes
- **AND** el principio activo sale de la clase de la droga, no del payload

#### Scenario: Receta vencida

- **WHEN** se confirma una receta sin fecha de validez y con más de un mes desde su prescripción, o con una fecha de validez que no es del mes en curso
- **THEN** se rechaza

### Requirement: Texto escaneado solo por POST

El texto escaneado SHALL viajar solo por POST (Server Action), nunca en una URL de esta aplicación.

#### Scenario: Leer un código

- **WHEN** se envía un código escaneado
- **THEN** viaja en el cuerpo de un POST y no aparece en ninguna URL de la aplicación

### Requirement: Forma del hash

El hash SHALL ser una secuencia de exactamente 64 caracteres hexadecimales (sin otro carácter hexadecimal pegado antes o después), sin distinguir mayúsculas al leerlo (un lector con Bloq Mayús invertido igual funciona). Dos tramos que difieren solo en mayúsculas son el mismo hash.

#### Scenario: Bloq Mayús invertido

- **WHEN** el lector escribe el hash en minúsculas
- **THEN** se reconoce el mismo hash

### Requirement: Forma canónica en MAYÚSCULAS

**El decrypter de RCTA SÍ distingue mayúsculas** en el hash: en mayúsculas (como lo imprime el link del QR) devuelve la receta, y en minúsculas devuelve 500 "Recipe does not exists". Por eso la forma canónica SHALL ser **MAYÚSCULAS**: `extraerHashRcta` siempre devuelve el hash en mayúsculas.

#### Scenario: P11–P14 — Extracción

- **WHEN** el texto es el link completo, el hash solo (con espacios o salto de línea), el hash en cualquier combinación de mayúsculas/minúsculas, o un link deformado por el teclado
- **THEN** se extrae el hash, siempre en MAYÚSCULAS (forma canónica; RCTA distingue mayúsculas)

### Requirement: Adaptador y link en MAYÚSCULAS

El adaptador SHALL aceptar solo `[0-9A-F]{64}` (rechaza cualquier otra forma sin consultar) y enviarlo tal cual. El link de verificación (`https://verumrp.com.ar/prescripcion/<HASH>`) también lleva el hash en mayúsculas.

#### Scenario: Hash en minúsculas al adaptador

- **WHEN** el adaptador recibe un hash en minúsculas
- **THEN** lo rechaza sin consultar

### Requirement: Formas del texto escaneado

El texto SHALL poder ser el link completo (`https://verumrp.com.ar/prescripcion/<hash>`), el hash solo, o un link deformado por la distribución del teclado del lector (`https;--verumrp.com.ar-prescripcion-<hash>`).

#### Scenario: Link deformado

- **WHEN** el texto es `https;--verumrp.com.ar-prescripcion-<hash>`
- **THEN** se extrae el hash

### Requirement: Texto sin un hash válido

Más de un hash distinto, 63 o 65 caracteres hexadecimales, texto vacío o sin hash SHALL dar "QR no válido o receta no encontrada", sin consulta.

#### Scenario: P15–P16 — Inválido

- **WHEN** el texto tiene 63 o 65 hexadecimales, es basura, está vacío o tiene dos hashes distintos
- **THEN** es inválido ("QR no válido o receta no encontrada") y no se consulta

### Requirement: Restricción de host (P17)

**Restricción de host (P17, acotada a propósito).** Un texto con forma de URL completa `esquema://host/...` cuyo host no sea `verumrp.com.ar` (ni un subdominio) SHALL rechazarse sin consulta. El control **no** se aplica a textos sin `//` (`https:evil.com/<hash>` o `https:/evil.com/<hash>` devuelven el hash). Es inofensivo: del texto solo se usa el hash, y siempre contra un endpoint constante; la URL escaneada nunca se visita.

#### Scenario: P17 — Host ajeno

- **WHEN** el texto es una URL con `esquema://` y un host ajeno
- **THEN** es inválido y no se consulta

#### Scenario: P17 — Textos sin //

- **WHEN** el texto es `https:evil.com/<hash>` o `https:/evil.com/<hash>`
- **THEN** devuelve el hash

### Requirement: Largo máximo del texto

El texto escaneado SHALL tener un máximo de 2048 caracteres.

#### Scenario: Texto de más de 2048 caracteres

- **WHEN** se envía un texto de 2049 caracteres
- **THEN** no se acepta

### Requirement: Endpoint constante de RCTA

La consulta SHALL ir a un único endpoint constante (`https://decrypter.verumrp.com.ar/api/RecipeDecryption/WithPrescription`) con el hash (en mayúsculas, exactamente como se extrajo) como único dato variable. GET, sin seguir redirecciones, sin caché, `accept: application/json`, **timeout de 8 s**, cuerpo máximo de **64 KiB** (se corta la lectura al llegar al tope).

#### Scenario: Consulta

- **WHEN** se consulta un hash
- **THEN** se hace un GET al endpoint constante con el hash en mayúsculas, sin caché, con `accept: application/json`

### Requirement: Nada de la consulta en logs

La consulta MUST NOT registrar en logs el hash, la URL ni el cuerpo.

#### Scenario: P64–P66 — Logs y fixtures

- **WHEN** se consulta RCTA, con éxito o con error
- **THEN** el hash, la URL y el cuerpo no aparecen en logs ni en mensajes de error
- **AND** los fixtures de las pruebas son ficticios

### Requirement: Respuesta válida

Una respuesta 200 con JSON válido SHALL mapearse a la vista previa (tabla «Respuestas de RCTA»).

#### Scenario: 200 válido

- **WHEN** RCTA responde 200 con un JSON que cumple el esquema
- **THEN** se mapea a la vista previa

### Requirement: QR no válido según la respuesta

SHALL dar "QR no válido o receta no encontrada": un 200 vacío o `null`; HTTP 500 **o 404** con `{"error":"Recipe does not exists"}` y `content-type` JSON (así responde RCTA ante un hash desconocido; el 404 es un seguro por si RCTA cambia de código); **solo** HTTP 400 y 422.

#### Scenario: 500 Recipe does not exists

- **WHEN** RCTA responde 500 con `{"error":"Recipe does not exists"}` y `content-type: application/json`
- **THEN** el usuario ve "QR no válido o receta no encontrada"

### Requirement: RCTA no disponible

**Cualquier otro 4xx** (401, 403, 404 sin ese cuerpo, 405, 407, 408, 410, 421, 429, 451, ...), otros 5xx (incluido un 500 con otro cuerpo, o con ese cuerpo pero sin `content-type` JSON), error de red, timeout o redirección SHALL dar "No se pudo consultar RCTA, importá el PDF".

#### Scenario: 404 sin el cuerpo

- **WHEN** RCTA responde 404 sin el cuerpo "Recipe does not exists"
- **THEN** el usuario ve "No se pudo consultar RCTA, importá el PDF"

### Requirement: Por qué un 404 sin cuerpo es una caída

Como RCTA responde HTTP 500 (no 404) ante un hash desconocido, un 404 **sin** ese cuerpo SHALL tratarse como que el endpoint se movió o fue bloqueado: es una caída del servicio, no un QR inválido. Lo mismo vale para 401 y 403 (bloqueo de IP, WAF o autenticación futura), 408 y 429.

#### Scenario: 403 por bloqueo

- **WHEN** RCTA responde 403
- **THEN** se trata como caída del servicio ("No se pudo consultar RCTA, importá el PDF"), no como QR inválido

### Requirement: Formato inesperado

Un 200 que no es JSON, un cuerpo mayor a 64 KiB o un JSON que no cumple el esquema SHALL dar "RCTA devolvió la receta en un formato inesperado. Importá el PDF."

#### Scenario: Cuerpo de más de 64 KiB

- **WHEN** RCTA responde 200 con un cuerpo de más de 64 KiB
- **THEN** el usuario ve "RCTA devolvió la receta en un formato inesperado. Importá el PDF."

### Requirement: Recipe does not exists solo con content-type JSON

El mensaje "Recipe does not exists" SHALL contar **solo si la respuesta (500, o 404 como seguro) declara un `content-type` JSON** (`application/json` o `application/*+json`): el cuerpo se lee acotado (64 KiB) y se compara sin distinguir mayúsculas contra `/recipe does not exist/i`. Un 500 o un 404 con ese texto pero como HTML o texto plano es una caída del servicio (un balanceador o una página de error puede repetir esa frase), no un QR inválido.

#### Scenario: P18–P26 — Adaptador

- **WHEN** RCTA responde 200 válido
- **THEN** se mapea a la vista previa
- **AND** 200 vacío, `null` o `{}`, solo 400 y 422, y 500 "Recipe does not exists" (y 404 con ese mismo cuerpo JSON) dan QR no válido
- **AND** el mismo texto sin `content-type` JSON da RCTA no disponible
- **AND** cualquier otro 4xx (401, 403, 404 sin ese cuerpo, 405, 407, 408, 410, 421, 429, 451), otros 5xx, timeout, red y redirección dan RCTA no disponible
- **AND** no JSON, más de 64 KiB o esquema inválido dan formato inesperado

#### Scenario: Mismo texto como HTML

- **WHEN** RCTA responde 500 con "Recipe does not exists" en una página HTML
- **THEN** el usuario ve "No se pudo consultar RCTA, importá el PDF"

### Requirement: Esquema del JSON de RCTA

El esquema SHALL exigir `emisor = "RCTA"` y un `numeroReceta` que sea **string** de al menos 10 dígitos (un número JSON no se acepta). `prescripcion[]` no tiene tope de elementos (lo acota el límite de 64 KiB del cuerpo).

#### Scenario: numeroReceta numérico

- **WHEN** el JSON trae `numeroReceta` como número JSON
- **THEN** no cumple el esquema y el usuario ve el mensaje de formato inesperado

### Requirement: Identificación y fechas

`numeroReceta` SHALL ir a `nroRecetaEmisor`; la URL de verificación se **reconstruye** a partir del hash. Fechas verificadas: `fechaConfeccion` → `Creada` (fecha de prescripción); `fechaEmision` → `Vigencia desde`.

#### Scenario: Fechas

- **WHEN** se mapea un JSON con `fechaConfeccion` y `fechaEmision`
- **THEN** `fechaConfeccion` es la fecha de prescripción (`Creada`) y `fechaEmision` es `Vigencia desde`
- **AND** la URL de verificación se arma con el hash

### Requirement: Datos del paciente

Del paciente SHALL mapearse: DNI solo si el tipo de documento falta o es DNI; CUIL; sexo `F`/`M` → Femenino/Masculino (otro valor → vacío); `fechaNacimiento` → `AAAA-MM-DD` (`0001-01-01` o inválida → vacía); `cobertura.numero` → N° de credencial.

#### Scenario: Documento que no es DNI

- **WHEN** el JSON trae un documento de otro tipo
- **THEN** el DNI queda vacío

#### Scenario: Fecha de nacimiento 0001-01-01

- **WHEN** el JSON trae `fechaNacimiento` `0001-01-01`
- **THEN** la fecha de nacimiento queda vacía

### Requirement: El nombre del paciente nunca se lee

**El nombre del paciente viene anonimizado y SHALL NOT leerse nunca**: la vista previa avisa que el QR no lo incluye y el usuario debe escribir nombre y apellido para confirmar (paciente nuevo).

#### Scenario: Paciente nuevo por QR

- **WHEN** se lee por QR la receta de un paciente nuevo
- **THEN** la vista previa avisa que el QR no incluye el nombre
- **AND** no se puede confirmar sin escribir nombre y apellido

### Requirement: Datos del médico

Del médico, la matrícula `MP` SHALL dar provincial y `MN` nacional; otro tipo → se conserva el número, la jurisdicción queda vacía y se avisa. `lugarAtencion` se divide en dirección y teléfono como el pie del PDF; sin "Teléfono", todo va a la dirección.

#### Scenario: Tipo de matrícula desconocido

- **WHEN** el JSON trae una matrícula de un tipo que no es `MP` ni `MN`
- **THEN** se conserva el número, la jurisdicción queda vacía y hay un aviso

#### Scenario: lugarAtencion sin teléfono

- **WHEN** `lugarAtencion` no trae "Teléfono"
- **THEN** todo va a la dirección

### Requirement: Diagnóstico

Código y descripción del diagnóstico SHALL combinarse **por campo** (el del nivel superior gana si no está vacío; si no, el del primer ítem). `E660` → `E66.0`; un código inválido se descarta con aviso y se conserva la descripción (máximo 2000 caracteres).

#### Scenario: Código sin punto

- **WHEN** el JSON trae el código `E660`
- **THEN** el diagnóstico es `E66.0`

#### Scenario: Código vacío arriba

- **WHEN** el código del nivel superior está vacío y el del primer ítem no
- **THEN** se usa el código del primer ítem

#### Scenario: Código inválido

- **WHEN** el código es inválido
- **THEN** se descarta con aviso y se conserva la descripción

#### Scenario: P27–P39 — Cabecera

- **WHEN** se mapea un JSON de RCTA
- **THEN** la cabecera, el paciente (nombre nunca leído), el médico, la matrícula, la dirección y el teléfono, el diagnóstico y las fechas siguen las reglas de mapeo

### Requirement: Ítems

SHALL haber un ítem por elemento de `prescripcion[]`. El texto se divide en renglones y pasa por el **mismo parser de cuerpo que el PDF** (componentes, presentación, fracción de dosis, posología, duración, control de consistencia). `cantidad` se ignora.

#### Scenario: Dos elementos

- **WHEN** `prescripcion[]` tiene dos elementos
- **THEN** la vista previa tiene dos ítems, cada uno armado con el parser de cuerpo del PDF, sin usar `cantidad`

### Requirement: Datos no importados

`notas`, `codPractica`, `nroCUIR` y `practica` SHALL generar un aviso "no se importa" y nunca se guardan. Un arreglo, objeto o texto vacío cuenta como **dato ausente** (sin aviso).

#### Scenario: Notas con texto

- **WHEN** el JSON trae `notas` con texto
- **THEN** hay un aviso "no se importa" y las notas no se guardan

#### Scenario: Dato ausente

- **WHEN** `codPractica` es un texto vacío
- **THEN** no hay aviso

### Requirement: Guion inicial de lista

En los renglones del cuerpo (QR), un guion inicial de lista (`- `) SHALL quitarse de cada renglón; un renglón que era solo el guion se descarta.

#### Scenario: Renglón con guion

- **WHEN** un renglón es `- Tomar con agua`
- **THEN** se procesa como `Tomar con agua`

### Requirement: Domicilio del paciente desde el primer renglón

**Decisión del usuario (2026-10-07; migración 0070).** Si el **primer renglón del primer ítem** es un renglón inicial informativo (antes del primer componente, sin unidad de dosis), **con o sin guion**, su texto sin el guion (espacios colapsados, máximo 300 caracteres) SHALL precargar `receta.domicilioPaciente` y **no** generar aviso informativo. Mismo destino que en el PDF (`openspec/specs/importacion-receta-pdf/spec.md`).

#### Scenario: Sin guion

- **WHEN** el primer renglón del primer ítem es `Complejo sol naciente casa 10 Guaymallén`
- **THEN** precarga `receta.domicilioPaciente` con ese texto, sin aviso informativo

#### Scenario: Con guion

- **WHEN** el primer renglón del primer ítem es `- Avellaneda 14 las Heras`
- **THEN** precarga `receta.domicilioPaciente` con `Avellaneda 14 las Heras`, sin aviso informativo

### Requirement: Domicilio — deduplicación y otros renglones iniciales

El texto del domicilio del paciente (primer renglón del primer ítem) SHALL entrar en la deduplicación: si otro ítem repite el mismo renglón, tampoco se avisa. Cualquier otro renglón inicial (no primero, o de otro ítem) sigue la regla P44.

#### Scenario: Otro ítem repite el domicilio

- **WHEN** el segundo ítem empieza con el mismo renglón que el domicilio del primero
- **THEN** no se avisa

### Requirement: Domicilio — sin exigir el guion

A diferencia del PDF, en el QR SHALL NOT exigirse el guion: el JSON trae el domicilio como texto plano (corrección del usuario, 2026-10-09). El JSON de RCTA no tiene un campo de domicilio del paciente.

#### Scenario: P40–P45 — Ítems

- **WHEN** se mapean ítems: varios elementos, texto de ítem con el parser compartido, datos no importados, renglones iniciales (con y sin unidad de dosis) y posteriores, recetas con varios ítems, el primer renglón inicial del primer ítem (con o sin guion) y un dato ausente
- **THEN** hay un ítem por elemento, armado con el parser compartido
- **AND** hay avisos de datos no importados
- **AND** los renglones iniciales y posteriores siguen la regla P44, con el sufijo "(ítem N)"
- **AND** el primer renglón inicial del primer ítem, con o sin guion, es el domicilio del paciente, sin aviso
- **AND** el dato ausente no genera aviso

### Requirement: P44 — Renglones iniciales

**Regla P44 (refinada).** Los renglones no clasificables **antes del primer componente** SHALL mostrarse como información neutra ("Información de la receta (no se guarda)") y no se guardan (por ejemplo, la dirección del consultorio).

#### Scenario: Dirección del consultorio

- **WHEN** un renglón no clasificable sin unidad de dosis aparece antes del primer componente y no es el domicilio del paciente
- **THEN** se muestra como "Información de la receta (no se guarda)" y no se guarda

### Requirement: P44 — Renglón con unidad de dosis

La regla P44 SHALL decidirse por renglón: si un renglón no clasificable antes del primer componente contiene una **unidad de dosis** (`mg`, `g`, `mcg`, `µg`, `ml`, `UI`, `%`, palabra completa, sin distinguir mayúsculas) se interpreta como una droga en un formato desconocido y conserva el aviso ámbar `RENGLON_NO_RECONOCIDO` con el texto literal, para que nunca desaparezca. Los renglones no clasificables **después** del primer componente siempre generan ese aviso.

#### Scenario: Renglón inicial con MG

- **WHEN** un renglón no clasificable con la palabra `MG` aparece antes del primer componente
- **THEN** genera el aviso ámbar `RENGLON_NO_RECONOCIDO` con el texto literal

#### Scenario: Renglón posterior

- **WHEN** un renglón no clasificable aparece después del primer componente
- **THEN** genera el aviso `RENGLON_NO_RECONOCIDO`

### Requirement: Sufijo (ítem N)

En recetas con más de un ítem, todo aviso propio de un ítem SHALL terminar en "(ítem N)" antes del punto final. El aviso informativo de texto inicial, que se deduplica entre ítems, no lleva sufijo. Con un solo ítem no hay sufijo.

#### Scenario: Aviso del segundo ítem

- **WHEN** el segundo ítem de una receta de dos ítems genera un aviso propio
- **THEN** el aviso termina en "(ítem 2)" antes del punto final

#### Scenario: Un solo ítem

- **WHEN** una receta de un ítem genera un aviso
- **THEN** no lleva sufijo

### Requirement: Tope de avisos sobre la lista final

Los avisos reproducen texto que no es nuestro, y varias etapas agregan avisos (el mapeo del JSON, el parser de cuerpo y el match con el catálogo). Por eso el tope SHALL aplicarse **una sola vez, sobre la lista final de la vista previa** del QR (`acotarAvisos`, al terminar el match); el mapeo no recorta nada. La importación por PDF no cambia: el tope solo corre en el camino del QR.

#### Scenario: Muchas drogas sin match

- **WHEN** una receta leída por QR tiene muchas drogas sin match con nombres enormes
- **THEN** la vista previa del QR queda acotada

### Requirement: Largo del texto citado

Lo que el aviso **repite** de la receta SHALL cortarse a **200 caracteres** más "…" **antes** de armar el mensaje final: cada fragmento citado entre «…» dentro de `mensaje` (el renglón literal, las notas, el nombre de la droga o de la unidad, los valores de una diferencia) y el campo `texto`. El resto del mensaje (comillas de cierre, la sugerencia, el sufijo "(ítem N)") queda intacto.

#### Scenario: Renglón de 300 caracteres

- **WHEN** un aviso cita un renglón de 300 caracteres
- **THEN** el fragmento citado queda en sus primeros 200 caracteres más "…"
- **AND** las comillas de cierre, la sugerencia y el sufijo "(ítem N)" quedan intactos

### Requirement: Corte por caracteres Unicode

El corte del texto citado SHALL contar caracteres Unicode, así que un emoji nunca queda partido; un fragmento de 200 o menos no se toca, y aplicar el tope dos veces no agrega un segundo "…".

#### Scenario: Tope aplicado dos veces

- **WHEN** se aplica el tope a una lista de avisos ya acotada
- **THEN** ningún fragmento recibe un segundo "…"

#### Scenario: Fragmento de 200 caracteres

- **WHEN** un fragmento citado tiene exactamente 200 caracteres
- **THEN** no se toca

### Requirement: Tope de seguridad del mensaje

Además, el `mensaje` completo de un aviso SHALL NOT pasar de **600 caracteres** (más "…"): alcanza para dos fragmentos cortados y el texto fijo, y solo corta si algo todavía sale más largo.

#### Scenario: Mensaje todavía largo

- **WHEN** un mensaje, ya cortados sus fragmentos, todavía pasa de 600 caracteres
- **THEN** se corta a 600 caracteres más "…"

### Requirement: Cantidad máxima de avisos

La vista previa del QR SHALL tener como máximo **50 avisos**. Si hay más, se eligen los primeros 49 por **prioridad**: (1) los avisos **accionables del match** (`PACIENTE_DADO_DE_BAJA`, `DIFERENCIA_DATOS`, `DROGA_SIN_MATCH`, `UNIDAD_SIN_MATCH`), (2) el resto de las advertencias, (3) los avisos informativos; dentro de cada grupo manda el orden original. Con 50 avisos o menos no se agrega nada.

#### Scenario: 60 renglones no reconocidos y un paciente dado de baja

- **WHEN** la vista previa del QR tiene 60 avisos de renglones no reconocidos y uno de paciente dado de baja
- **THEN** se muestran 50 avisos y el aviso de la baja está entre ellos

#### Scenario: 50 avisos

- **WHEN** la vista previa del QR tiene 50 avisos
- **THEN** no se agrega nada

### Requirement: Aviso AVISOS_OMITIDOS

Cuando hay más de 50 avisos, los 49 elegidos SHALL conservar su orden original y la última posición pasa a ser un aviso con código propio `AVISOS_OMITIDOS` (advertencia ámbar): "Hay más avisos que no se muestran.".

#### Scenario: P45b — Tope de avisos

- **WHEN** se acota la lista final de avisos de la vista previa del QR
- **THEN** el texto citado se corta a 200 caracteres (el mensaje conserva cierre, sugerencia y sufijo; sin partir un par sustituto) y el mensaje a 600
- **AND** hay como máximo 50 avisos con prioridad (accionables del match, otras advertencias, informativos); 60 renglones no reconocidos más un paciente dado de baja conservan el aviso de la baja
- **AND** el último es `AVISOS_OMITIDOS`, sin mutar la entrada
- **AND** con muchas drogas sin match y nombres enormes la vista previa del QR queda acotada

### Requirement: Lectura sin botón

El panel QR SHALL NOT tener botón "Leer": la lectura arranca con el Enter del lector (o del teclado) y, al **pegar** un link en el campo, sola. Mientras lee se muestra un spinner junto al campo.

#### Scenario: Pegar un link

- **WHEN** el usuario pega un link en el campo
- **THEN** la lectura arranca sola y se muestra un spinner junto al campo

#### Scenario: P55–P57 — Enter y foco

- **WHEN** se presiona Enter con un texto escrito, con el campo vacío, y al cargar la página
- **THEN** Enter envía una sola vez el texto escrito y el campo vacío no consulta
- **AND** el panel PDF no cambia y el campo QR tiene el foco al cargar

### Requirement: Foco del campo QR

El campo SHALL tener el foco al cargar la página (salvo que ya se haya leído una receta). Después de una lectura con éxito y después de "Descartar importación", el foco vuelve al campo con el texto seleccionado: el próximo escaneo **reemplaza** el anterior.

#### Scenario: Después de una lectura con éxito

- **WHEN** termina con éxito una lectura escrita o del lector USB
- **THEN** el foco vuelve al campo con el texto seleccionado

### Requirement: Foco después de un error

Después de un **error**, el foco SHALL volver al campo QR solo si no está en otro lado (en el `body`, sin elemento activo, o dentro del panel): si el usuario ya pasó al formulario manual, un error tardío **no le roba el foco**.

#### Scenario: Error tardío

- **GIVEN** el usuario pasó al formulario manual mientras se leía
- **WHEN** llega un error de la lectura
- **THEN** el foco no se mueve

### Requirement: Un segundo Enter no inicia otra lectura

Mientras una lectura está en curso, un segundo Enter (por ejemplo, un lector que envía Enter dos veces) SHALL NOT iniciar otra lectura (se descarta por el estado pendiente y por una guarda adicional que se activa al enviar y se libera al llegar el resultado).

#### Scenario: Lector que envía Enter dos veces

- **WHEN** el lector envía Enter dos veces seguidas
- **THEN** se hace una sola lectura

### Requirement: Región de estado del panel

Una región de estado (`role="status"`) siempre presente SHALL anunciar "Leyendo…" y "Receta leída. Revisá la vista previa.". El mismo error dos veces seguidas se anuncia dos veces.

#### Scenario: Lectura con éxito

- **WHEN** se lee una receta con éxito
- **THEN** la región de estado anuncia "Leyendo…" y luego "Receta leída. Revisá la vista previa."

### Requirement: Error como alerta

El error SHALL mostrarse como alerta (`role="alert"`), el campo queda con `aria-describedby` apuntando a ella y, solo cuando el error es del código ingresado ("QR no válido o receta no encontrada", formato), con `aria-invalid`; una caída de RCTA o un error de permisos no marcan el campo como inválido.

#### Scenario: Caída de RCTA

- **WHEN** la lectura falla con "No se pudo consultar RCTA, importá el PDF"
- **THEN** el error se muestra como alerta y el campo no tiene `aria-invalid`

#### Scenario: Código inválido

- **WHEN** la lectura falla con "QR no válido o receta no encontrada"
- **THEN** el campo tiene `aria-invalid` y `aria-describedby` apunta a la alerta

### Requirement: Reinicio del otro panel

Cuando uno de los paneles (PDF o QR) lee una receta con éxito, el otro SHALL reiniciarse y perder su error anterior; el panel que leyó no se reinicia.

#### Scenario: QR después de un error del PDF

- **GIVEN** el panel PDF muestra un error
- **WHEN** el panel QR lee una receta con éxito
- **THEN** el panel PDF se reinicia sin el error y el panel QR no se reinicia

### Requirement: Cámara por el mismo camino

El botón "Escanear con la cámara" del panel SHALL abrir la cámara, leer el QR y mandar el texto leído **por el mismo camino que un código escrito**: lo pone en el mismo campo y envía el mismo formulario (`requestSubmit`), con la misma Server Action y las mismas validaciones. La cámara no valida nada por su cuenta.

#### Scenario: QR leído con la cámara

- **WHEN** la cámara lee un QR con un hash de receta
- **THEN** el texto se pone en el campo y se envía con `requestSubmit` por la misma Server Action

### Requirement: Cámara solo con HTTPS

Los navegadores solo dan la cámara a una página segura (HTTPS o `localhost`). En una página no segura (por ejemplo, `http://192.168.x.x:3000` desde un celular en la red local) el botón SHALL quedar deshabilitado y explicar que hace falta HTTPS.

#### Scenario: P60–P61 — Errores de cámara

- **WHEN** el permiso se deniega, no hay cámara, la cámara está en uso, el contexto es inseguro o no hay API
- **THEN** se muestra un mensaje claro y el campo manual sigue funcionando
- **AND** sobre `http://` en la red local el botón se deshabilita con su explicación

### Requirement: Lector según el navegador

Si el navegador tiene el detector nativo (`BarcodeDetector`) con formato `qr_code` (Chrome en Android), el lector SHALL usarlo; si no (Safari en iOS, Firefox), usa **jsQR** (dependencia `jsqr` 1.4.0, JavaScript puro sin dependencias propias, licencia Apache-2.0), que se carga solo en ese caso y lee los fotogramas desde un `canvas` (ancho máximo 640 px, unas 8 lecturas por segundo). Ninguno usa workers ni WebAssembly.

#### Scenario: P58–P59 — Elección del lector

- **WHEN** el navegador soporta `qr_code` en el detector nativo
- **THEN** se usa el detector nativo
- **AND** en caso contrario se usa jsQR

### Requirement: Fallo del lector

Si el detector nativo falla 5 fotogramas seguidos (lanza error, no es lo mismo que un fotograma sin QR), el lector SHALL pasar a jsQR; si jsQR falla igual, o el `canvas` no tiene contexto 2D, la cámara se cierra con un mensaje de error en vez de girar sin leer.

#### Scenario: Detector nativo que lanza errores

- **WHEN** el detector nativo lanza error en 5 fotogramas seguidos
- **THEN** el lector pasa a jsQR

#### Scenario: Sin contexto 2D

- **WHEN** el lector usa jsQR y el `canvas` no tiene contexto 2D
- **THEN** la cámara se cierra con un mensaje de error

### Requirement: Preferencias de la cámara

La cámara SHALL pedir la trasera y 1280 px de ancho como preferencias (`facingMode` y `width` con `ideal`), así que una notebook sigue abriendo.

#### Scenario: Notebook sin cámara trasera

- **WHEN** se abre la cámara en una notebook
- **THEN** la cámara abre igual

### Requirement: Qué QR se acepta

El primer QR que contiene un hash de receta SHALL detener la cámara y enviarse. Un QR sin hash (cualquier otro código a la vista) se ignora y se avisa "Ese QR no es de una receta. Seguí buscando."

#### Scenario: QR de otra cosa

- **WHEN** la cámara ve un QR sin hash de receta
- **THEN** se ignora y se avisa "Ese QR no es de una receta. Seguí buscando."

### Requirement: QR repetido

El mismo texto repetido en menos de 3 s SHALL NOT reevaluarse, para que un mismo QR no se envíe dos veces ni el aviso se repita en cada fotograma. El aviso se retira unos 3 s después de la última vez que ese QR estuvo a la vista.

#### Scenario: QR ajeno a la vista

- **WHEN** el mismo QR sin hash sigue a la vista durante varios fotogramas
- **THEN** el aviso no se repite en cada fotograma y se retira unos 3 s después de que deja de verse

### Requirement: Permisos y errores de la cámara

Permiso denegado (`NotAllowedError`, `SecurityError`) SHALL pedir permitirlo en el navegador. Sin cámara (`NotFoundError`, `OverconstrainedError`) y cámara en uso por otra aplicación (`NotReadableError`) tienen su mensaje. En todos los casos el campo manual sigue funcionando.

#### Scenario: Permiso denegado

- **WHEN** el navegador deniega la cámara con `NotAllowedError`
- **THEN** se pide permitirla en el navegador y el campo manual sigue funcionando

### Requirement: Reintentar y recargar

Los estados de error que pueden mejorar al insistir (permiso, sin cámara, en uso, error, cámara desconectada, cámara pausada) SHALL ofrecer un botón **Reintentar**; el bloqueo por política ofrece "Recargar la página", y la página insegura o sin API, ninguno.

#### Scenario: Cámara en uso

- **WHEN** la cámara está en uso por otra aplicación
- **THEN** se ofrece Reintentar

#### Scenario: Página insegura

- **WHEN** la página no es segura
- **THEN** no se ofrece ningún botón

### Requirement: Apagado de la cámara

Todas las pistas del `MediaStream` SHALL detenerse al leer un QR, al presionar "Cerrar cámara", al desmontar el componente, al ocultarse la pestaña (la cámara se cierra y se avisa) y si el permiso se concede cuando ya se había cerrado.

#### Scenario: P62 — Pistas detenidas

- **WHEN** se lee un QR, se cierra la cámara, se desmonta el componente o se oculta la pestaña
- **THEN** todas las pistas del `MediaStream` se detienen (la luz de la cámara se apaga)

### Requirement: Cámara pausada y desconectada

Las pistas del `MediaStream` también SHALL detenerse si al concederse el permiso la pestaña ya estaba oculta ("Cámara pausada", con Reintentar) y si la cámara se desconecta (`ended` de la pista o `inactive` del stream: "La cámara se desconectó", con Reintentar).

#### Scenario: P62 (a) — Permiso aceptado con la pestaña oculta

- **GIVEN** el aviso de permiso abierto
- **WHEN** el usuario cambia de pestaña y acepta
- **THEN** al volver se ve "Cámara pausada" y la luz de la cámara no queda encendida
- **AND** "Reintentar" la reanuda

#### Scenario: P62 (b) — Cámara desconectada

- **GIVEN** la cámara activa
- **WHEN** se desconecta (USB) o se revoca el permiso desde el navegador
- **THEN** se ve "La cámara se desconectó", sin lectura congelada, con "Reintentar"

### Requirement: Una lectura cierra el escáner

Al empezar cualquier lectura, escrita o escaneada, el escáner SHALL cerrarse; si una lectura de la cámara llega con otra en curso, se avisa por la región `role="status"` en vez de descartarla en silencio.

#### Scenario: P62 (c) — Lectura en curso

- **GIVEN** una lectura en curso
- **WHEN** se lee un QR con la cámara
- **THEN** no se pierde el aviso: se anuncia por la región `role="status"`

### Requirement: Foco y accesibilidad de la cámara

Una lectura que vino de la cámara SHALL NOT mover el foco al campo (evita abrir el teclado del celular); las escritas o del lector USB conservan las reglas de foco. El video tiene `aria-label`; los estados se anuncian en la región `role="status"` del panel.

#### Scenario: P62 (d) — Android

- **WHEN** en Android termina una lectura de la cámara
- **THEN** no se abre el teclado en pantalla

### Requirement: Política de permisos de la cámara

`next.config.ts` SHALL mantener `Permissions-Policy: camera=()` en toda la aplicación y solo `/recetas/nuevo` recibe `camera=(self)` (una entrada posterior de `headers()`: la última que coincide gana).

#### Scenario: P63 — Permissions-Policy

- **WHEN** se piden las cabeceras de una ruta
- **THEN** toda ruta salvo `/recetas/nuevo` tiene `camera=()` y `/recetas/nuevo` tiene `camera=(self)`
- **AND** los accesos a esa ruta son carga completa
- **AND** al llegar desde `/recetas` con el botón "Nueva receta" la cámara abre sin recargar (verificación manual)

### Requirement: Navegación completa a /recetas/nuevo

La política **se fija en cada respuesta de documento**: una navegación suave (`<Link>`, `router.push`/`replace`, o `redirect()` de una Server Action, que también es una navegación del lado del cliente) hacia `/recetas/nuevo` conserva el `camera=()` del documento de origen. Por eso los accesos a esa ruta SHALL ser enlaces `<a href>` comunes (carga completa; hoy, los dos de `/recetas`).

#### Scenario: Botón Nueva receta

- **WHEN** se sigue el acceso "Nueva receta" de `/recetas`
- **THEN** es una carga completa del documento

### Requirement: Prueba de navegación completa

Una prueba de código fuente (`tests/unit/recetas-nuevo-navegacion-completa.test.ts`) SHALL leer la sintaxis de `app/`, `modules/` y `shared/` con la API del compilador de TypeScript y fallar ante un `<Link>` de `next/link` (con el `href` literal, en una constante de ese archivo o importada, en una plantilla o en un `{ pathname }`), un `router.push/replace/prefetch` o un `redirect()` hacia esa ruta.

#### Scenario: Link agregado por error

- **WHEN** alguien agrega un `<Link href="/recetas/nuevo">` de `next/link`
- **THEN** la prueba falla

### Requirement: Llegada por navegación suave

El permiso vale **mientras el documento cargado en `/recetas/nuevo` siga siendo el mismo**. Si aun así se llegó con una navegación suave (o un enlace guardado), la cámara SHALL mostrar "Recargá la página" con un botón que la recarga (`window.location.reload()`).

#### Scenario: Llegada sin carga completa

- **GIVEN** `/recetas/nuevo` abierto con una navegación suave
- **WHEN** se intenta abrir la cámara
- **THEN** se muestra "Recargá la página" con un botón que recarga

### Requirement: Origen y rótulo

La receta importada por QR SHALL guardarse con `origen = DIGITAL_PDF`; el rótulo pasó a **"Digital (PDF o QR)"** en toda la aplicación (no hay cambio de enumeración ni de base de datos).

#### Scenario: P68–P70 — Rótulo y fuente

- **WHEN** se muestra una receta importada por PDF o por QR
- **THEN** el rótulo es "Digital (PDF o QR)"
- **AND** la auditoría registra `fuente` PDF o QR

### Requirement: Fuente en la auditoría

La auditoría SHALL registrar `contexto.fuente` = `"PDF"` o `"QR"`. Lo declara el cliente: es solo para auditoría y no tiene valor de autorización.

#### Scenario: Confirmar una importación por QR

- **WHEN** se confirma una importación leída por QR
- **THEN** la auditoría registra `contexto.fuente = "QR"`

### Requirement: Sin logs de las URL ni de los argumentos

**El hash es una capacidad al portador sobre datos de salud** y viaja en la query string hacia RCTA. `logging.fetches` de Next y las trazas que registren las URL completas de los fetch MUST NOT habilitarse. `next.config.ts` fija `logging.serverFunctions: false` para que el código escaneado no se imprima en la terminal en desarrollo.

#### Scenario: Leer un QR en desarrollo

- **WHEN** se lee un QR con el servidor de desarrollo
- **THEN** el código escaneado no se imprime en la terminal

### Requirement: Verificación de despliegue (M.2)

Tras desplegar, SHALL comprobarse con un hash de prueba que la salida desde Vercel hacia `decrypter.verumrp.com.ar` funciona; un bloqueo se vería como "No se pudo consultar RCTA". También se comparan las cabeceras: `/recetas/nuevo` debe devolver `Permissions-Policy: camera=(self), microphone=(), geolocation=()` y `/recetas` debe seguir devolviendo `camera=(), microphone=(), geolocation=()`.

#### Scenario: P67 — Verificación de despliegue

- **WHEN** se despliega
- **THEN** se comprueba manualmente con un hash de prueba que la consulta a RCTA funciona desde Vercel
- **AND** se comparan las cabeceras `Permissions-Policy` de `/recetas/nuevo` y `/recetas`

### Requirement: Regresión del PDF

El flujo y las pruebas de la importación por PDF SHALL NOT cambiar con la importación por QR.

#### Scenario: P71–P72 — Regresión

- **WHEN** se agrega la importación por QR
- **THEN** el flujo y las pruebas del PDF no cambian

### Requirement: Fixtures ficticios

Los fixtures SHALL armarse a mano con datos **ficticios** (hash inventado, nombres y documentos inventados); no se versiona ninguna respuesta real de RCTA.

#### Scenario: Fixture de respuesta

- **WHEN** se agrega un fixture de respuesta de RCTA
- **THEN** usa un hash, nombres y documentos inventados

## Alcance

En `/recetas/nuevo`, junto al panel "Importar desde PDF", hay un panel "Importar con QR". El usuario escanea el QR de la receta RCTA con un lector USB (que escribe el código y presiona Enter) o pega el link. El sistema extrae el **hash** de la receta, lo consulta en el servicio de RCTA, **precarga el formulario** y muestra la vista previa con avisos. Nada se guarda hasta que el usuario confirma; la confirmación no vuelve a consultar RCTA.

Solo hay una importación activa: leer otra receta (por PDF o por QR) reemplaza la anterior. "Descartar importación" vuelve al formulario manual.

La cámara del dispositivo es una segunda forma de ingresar el mismo código (ver "Lectura con la cámara"). Fuera de alcance de este documento: otros emisores.

## Datos del JSON de RCTA

- **Médico.** Nombre y apellido vienen separados (sin confirmación).

## Respuestas de RCTA

| Respuesta | Mensaje al usuario |
|---|---|
| 200 con JSON válido | Se mapea a la vista previa |
| 200 vacío o `null`; HTTP 500 **o 404** con `{"error":"Recipe does not exists"}` y `content-type` JSON (así responde RCTA ante un hash desconocido; el 404 es un seguro por si RCTA cambia de código); **solo** HTTP 400 y 422 | "QR no válido o receta no encontrada" |
| **Cualquier otro 4xx** (401, 403, 404 sin ese cuerpo, 405, 407, 408, 410, 421, 429, 451, ...), otros 5xx (incluido un 500 con otro cuerpo, o con ese cuerpo pero sin `content-type` JSON), error de red, timeout, redirección | "No se pudo consultar RCTA, importá el PDF" |
| 200 que no es JSON, cuerpo mayor a 64 KiB, JSON que no cumple el esquema | "RCTA devolvió la receta en un formato inesperado. Importá el PDF." |

## Límites de los avisos

Los avisos reproducen texto que no es nuestro (renglones de la receta, nombres de drogas), y varias etapas agregan avisos (el mapeo del JSON, el parser de cuerpo y el match con el catálogo: drogas y unidades sin match, paciente dado de baja, diferencias de datos). Por eso el tope se aplica **una sola vez, sobre la lista final de la vista previa** del QR (`acotarAvisos`, al terminar el match); el mapeo no recorta nada. La importación por PDF no cambia: ni el parser compartido ni el match se modificaron, el tope solo corre en el camino del QR.

## Panel y lector USB

Comportamiento del panel (verificación manual, ver P55–P57): requirements «Lectura sin botón» a «Reinicio del otro panel».

Configuración del lector:

- **Sufijo Tab.** Un lector configurado con sufijo Tab mueve el foco al siguiente control **sin enviar** el formulario. Configurarlo para que envíe **Enter**.
- **Prefijos.** Un prefijo del lector pegado directamente a un hash solo (sin link) puede invalidarlo: si el prefijo termina en un carácter hexadecimal (cifra o a–f) quedan más de 64 caracteres hexadecimales seguidos y el código se rechaza. Preferir escanear el QR completo, cuyo link tiene el hash separado por `/` o `-`.

## Cámara en desarrollo y CSP

- **Requisito: HTTPS.** Los navegadores solo dan la cámara a una página segura (HTTPS o `localhost`). Un celular que abre un servidor de desarrollo por la red local con `http://192.168.x.x:3000` **no puede usar la cámara**: el botón queda deshabilitado y explica que hace falta HTTPS (en producción no hay problema). Para probar en un celular, usar un túnel HTTPS o un certificado local.
- El permiso vale **mientras el documento cargado en `/recetas/nuevo` siga siendo el mismo**: tras la carga completa, ese documento conserva `camera=(self)` aunque después navegue de forma suave a otras páginas, y ninguna otra página usa la cámara, así que no hace falta nada más.
- **CSP.** `proxy.ts` no necesita cambios: el video recibe un `MediaStream` por `srcObject` (no es una carga de URL), el fragmento de jsQR se carga como cualquier otro bajo `strict-dynamic`, y no hay workers ni WebAssembly.

## Operación y riesgos

- **API de terceros no documentada.** El servicio de desencriptado de RCTA no es una integración oficial y puede cambiar sin aviso. La alternativa siempre disponible es la importación por PDF (los mensajes de error la sugieren).
- **El hash es una capacidad al portador sobre datos de salud** y viaja en la query string hacia RCTA. **No** habilitar `logging.fetches` de Next ni trazas que registren las URL completas de los fetch. En desarrollo, Next registra por defecto las llamadas a Server Functions con sus argumentos: `next.config.ts` fija `logging.serverFunctions: false` para que el código escaneado no se imprima en la terminal. Aun así, evitar códigos de recetas reales en desarrollo.
- **Verificación de despliegue (M.2).** Tras desplegar, comprobar con un hash de prueba que la salida desde Vercel hacia `decrypter.verumrp.com.ar` funciona; un bloqueo se vería como "No se pudo consultar RCTA".
- **Verificación de despliegue de la política de permisos (M.2).** Comparar las cabeceras de las dos rutas en el despliegue: `curl -I https://<despliegue>/recetas/nuevo` debe devolver `Permissions-Policy: camera=(self), microphone=(), geolocation=()` y `curl -I https://<despliegue>/recetas` debe seguir devolviendo `camera=(), microphone=(), geolocation=()`. Si Vercel o un proxy cambia la cabecera, la cámara no se podrá abrir aunque el código sea correcto.
- **Pendientes (no implementados):** límite de tasa por usuario o tenant; auditoría opcional de las consultas a RCTA; solicitar a Verum/RCTA una integración oficial.

## Casos de prueba

- **P11–P14** — Extracción: link completo, hash solo (con espacios o salto de línea), cualquier combinación de mayúsculas/minúsculas → siempre MAYÚSCULAS (forma canónica; RCTA distingue mayúsculas), link deformado por el teclado.
- **P15–P16** — 63 o 65 hexadecimales, basura, vacío, dos hashes distintos → inválido, sin consulta.
- **P17** — Host ajeno en una URL con `esquema://` → inválido, sin consulta; `https:evil.com/<hash>` y `https:/evil.com/<hash>` → devuelven el hash.
- **P18–P26** — Adaptador: 200 válido; 200 vacío, `null` o `{}`; solo 400 y 422 → QR no válido; 500 "Recipe does not exists" (y 404 con ese mismo cuerpo JSON) → QR no válido; el mismo texto sin `content-type` JSON → RCTA no disponible; cualquier otro 4xx (401, 403, 404 sin ese cuerpo, 405, 407, 408, 410, 421, 429, 451), otros 5xx, timeout, red y redirección → RCTA no disponible; no JSON, más de 64 KiB o esquema inválido → formato inesperado.
- **P27–P39** — Mapeo de cabecera, paciente (nombre nunca leído), médico, matrícula, dirección y teléfono, diagnóstico y fechas.
- **P40–P45** — Ítems: varios elementos, texto de ítem con el parser compartido, avisos de datos no importados, renglones iniciales (con y sin unidad de dosis) y posteriores, sufijo "(ítem N)", domicilio (el primer renglón inicial del primer ítem, con o sin guion, es el domicilio del paciente, sin aviso), dato ausente.
- **P45b** — Tope de avisos de la vista previa final: corte a 200 caracteres del texto citado (el mensaje conserva cierre, sugerencia y sufijo; sin partir un par sustituto) y tope de 600 del mensaje, máximo 50 avisos con prioridad (accionables del match, otras advertencias, informativos; 60 renglones no reconocidos más un paciente dado de baja conservan el aviso de la baja) y aviso `AVISOS_OMITIDOS`, sin mutar la entrada; con muchas drogas sin match y nombres enormes la vista previa del QR queda acotada.
- **P46–P51** — Sin permiso no se consulta; código inválido no se consulta; receta ya cargada (permitida si la anterior está ANULADA); paciente existente o nuevo; ninguna transacción abierta durante la consulta.
- **P52–P53** — La vista previa es la misma que la del PDF; confirmar no vuelve a consultar.
- **P54** — Descartar no guarda nada. **Verificación manual** (es solo de interfaz).
- **P55–P57** — Enter envía una sola vez el texto escrito; el campo vacío no consulta; el panel PDF no cambia y el campo QR tiene el foco al cargar. **Verificación manual**: vitest corre en node, sin DOM, y el componente no se puede renderizar en las pruebas automáticas. Lo que sí está automatizado es la Server Action (`tests/unit/recetas-actions-leer-qr.test.ts`: el campo `codigo`, el éxito, la traducción de errores y la marca `campo: "codigo"` que decide `aria-invalid`), el texto de la región de estado (`tests/unit/recetas-anuncio-lectura.test.ts`) y la decisión pura de devolver el foco tras un error (`tests/unit/recetas-foco-lectura.test.ts`).
- **P58–P59** — Detector nativo cuando soporta `qr_code`; jsQR en caso contrario. Automatizado: la elección del lector (`tests/unit/camara-qr.test.ts`). **Verificación manual** de la lectura real: P58 en Chrome de Android y P59 en Safari de iOS o Firefox, siempre sobre HTTPS.
- **P60–P61** — Permiso denegado, sin cámara, cámara en uso, contexto inseguro y sin API: mensaje claro y el campo manual sigue funcionando. Automatizado: la clasificación de errores y los mensajes (`tests/unit/camara-qr.test.ts`). **Verificación manual** de que el botón se deshabilita con su explicación sobre `http://` en la red local.
- **P62** — Todas las pistas del `MediaStream` se detienen al leer, cerrar, desmontar u ocultar la pestaña. **Verificación manual** (en el navegador, la luz de la cámara se apaga); no se puede automatizar sin DOM ni cámara. Casos manuales adicionales: (a) con el aviso de permiso abierto, cambiar de pestaña y aceptar: al volver debe verse "Cámara pausada" y la luz de la cámara no debe quedar encendida; "Reintentar" la reanuda. (b) Con la cámara activa, desconectarla (USB) o revocar el permiso desde el navegador: debe verse "La cámara se desconectó", sin lectura congelada, con "Reintentar". (c) Leer un QR mientras otra lectura está en curso no pierde el aviso. (d) En Android, una lectura de la cámara no abre el teclado en pantalla.
- **P63** — `Permissions-Policy`: `camera=()` en toda ruta salvo `/recetas/nuevo`, que recibe `camera=(self)` (`tests/unit/next-config-headers.test.ts`); los accesos a esa ruta son carga completa (`tests/unit/recetas-nuevo-navegacion-completa.test.ts`). **Verificación manual**: llegar desde `/recetas` con el botón "Nueva receta" y abrir la cámara sin recargar.
- **P64–P66** — El hash, la URL y el cuerpo no aparecen en logs ni mensajes de error; los fixtures son ficticios.
- **P67** — Verificación de despliegue (manual, ver "Operación y riesgos").
- **P68–P70** — Rótulo "Digital (PDF o QR)"; la auditoría registra `fuente` PDF o QR.
- **P71–P72** — Regresión: el flujo y las pruebas del PDF no cambian.
- **P73** — La confirmación aplica la vigencia de un mes igual para PDF y QR (`tests/unit/recetas-importacion-flujos.test.ts`, con la jornada simulada) y el principio activo sale de la clase de la droga, no del payload.

Los fixtures se arman a mano con datos **ficticios** (hash inventado, nombres y documentos inventados); no se versiona ninguna respuesta real de RCTA.

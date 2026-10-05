# SPEC — Importación de receta digital por QR o link

> Continúa `docs/specs/importacion-receta-pdf.md` (casos P1–P10). Los casos de este documento siguen la numeración desde P11.
> Reutiliza la vista previa, el formulario y el comando de confirmación (`recetas.importar`) de la importación por PDF.

## Alcance

En `/recetas/nuevo`, junto al panel "Importar desde PDF", hay un panel "Importar con QR". El usuario escanea el QR de la receta RCTA con un lector USB (que escribe el código y presiona Enter) o pega el link. El sistema extrae el **hash** de la receta, lo consulta en el servicio de RCTA, **precarga el formulario** y muestra la vista previa con avisos. Nada se guarda hasta que el usuario confirma; la confirmación no vuelve a consultar RCTA.

Solo hay una importación activa: leer otra receta (por PDF o por QR) reemplaza la anterior. "Descartar importación" vuelve al formulario manual.

Fuera de alcance de este documento: lectura con cámara (segunda etapa, casos P58–P63 de la especificación; pendiente) y otros emisores.

## Flujo

1. Permiso `recetas.crear` (se verifica **antes** de cualquier consulta externa).
2. Extracción del hash del texto (función pura). Sin hash válido, no hay consulta.
3. Consulta HTTP al servicio de RCTA, **fuera de toda transacción** de base de datos.
4. Validación del JSON y mapeo al mismo borrador que produce el PDF (`BorradorReceta`).
5. Match con paciente, médico, drogas y unidades, y detección de receta duplicada (solo después de la consulta).
6. Vista previa. La confirmación usa el mismo flujo que el PDF.

El texto escaneado viaja solo por POST (Server Action), nunca en una URL de esta aplicación.

## Extracción del hash

El hash es una secuencia de exactamente 64 caracteres hexadecimales (sin otro carácter hexadecimal pegado antes o después), sin distinguir mayúsculas; se devuelve en minúsculas. El texto puede ser el link completo (`https://verumrp.com.ar/prescripcion/<hash>`), el hash solo, o un link deformado por la distribución del teclado del lector (`https;--verumrp.com.ar-prescripcion-<hash>`).

- Más de un hash distinto, 63 o 65 caracteres hexadecimales, texto vacío o sin hash → "QR no válido o receta no encontrada", sin consulta.
- **Restricción de host (P17, acotada a propósito).** Un texto con forma de URL completa `esquema://host/...` cuyo host no sea `verumrp.com.ar` (ni un subdominio) se rechaza sin consulta. El control **no** se aplica a textos sin `//` (`https:evil.com/<hash>` o `https:/evil.com/<hash>` devuelven el hash). Es inofensivo: del texto solo se usa el hash, y siempre contra un endpoint constante; la URL escaneada nunca se visita.
- El texto tiene un máximo de 2048 caracteres.

## Consulta a RCTA

Un único endpoint constante (`https://decrypter.verumrp.com.ar/api/RecipeDecryption/WithPrescription`) con el hash como único dato variable. GET, sin seguir redirecciones, sin caché, `accept: application/json`, **timeout de 8 s**, cuerpo máximo de **64 KiB** (se corta la lectura al llegar al tope). No se registra en logs el hash, la URL ni el cuerpo.

| Respuesta | Mensaje al usuario |
|---|---|
| 200 con JSON válido | Se mapea a la vista previa |
| 200 vacío o `null`; HTTP 500 **o 404** con `{"error":"Recipe does not exists"}` y `content-type` JSON (así responde RCTA ante un hash desconocido; el 404 es un seguro por si RCTA cambia de código); **solo** HTTP 400 y 422 | "QR no válido o receta no encontrada" |
| **Cualquier otro 4xx** (401, 403, 404 sin ese cuerpo, 405, 407, 408, 410, 421, 429, 451, ...), otros 5xx (incluido un 500 con otro cuerpo, o con ese cuerpo pero sin `content-type` JSON), error de red, timeout, redirección | "No se pudo consultar RCTA, importá el PDF" |
| 200 que no es JSON, cuerpo mayor a 64 KiB, JSON que no cumple el esquema | "RCTA devolvió la receta en un formato inesperado. Importá el PDF." |

Como RCTA responde HTTP 500 (no 404) ante un hash desconocido, un 404 **sin** ese cuerpo significa que el endpoint se movió o fue bloqueado: es una caída del servicio, no un QR inválido. Lo mismo vale para 401 y 403 (bloqueo de IP, WAF o autenticación futura), 408 y 429.

El mensaje "Recipe does not exists" **solo cuenta si la respuesta (500, o 404 como seguro) declara un `content-type` JSON** (`application/json` o `application/*+json`): el cuerpo se lee acotado (64 KiB) y se compara sin distinguir mayúsculas contra `/recipe does not exist/i`. Un 500 o un 404 con ese texto pero como HTML o texto plano es una caída del servicio (un balanceador o una página de error puede repetir esa frase), no un QR inválido.

El esquema exige `emisor = "RCTA"` y un `numeroReceta` que sea **string** de al menos 10 dígitos (un número JSON no se acepta). `prescripcion[]` no tiene tope de elementos (lo acota el límite de 64 KiB del cuerpo).

## Mapeo del JSON al borrador

- **Identificación y fechas.** `numeroReceta` → `nroRecetaEmisor`; la URL de verificación se **reconstruye** a partir del hash. Fechas verificadas: `fechaConfeccion` → `Creada` (fecha de prescripción); `fechaEmision` → `Vigencia desde`.
- **Paciente.** DNI solo si el tipo de documento falta o es DNI; CUIL; sexo `F`/`M` → Femenino/Masculino (otro valor → vacío); `fechaNacimiento` → `AAAA-MM-DD` (`0001-01-01` o inválida → vacía); `cobertura.numero` → N° de credencial. **El nombre del paciente viene anonimizado y nunca se lee**: la vista previa avisa que el QR no lo incluye y el usuario debe escribir nombre y apellido para confirmar (paciente nuevo).
- **Médico.** Nombre y apellido vienen separados (sin confirmación). Matrícula `MP` → provincial, `MN` → nacional; otro tipo → se conserva el número, la jurisdicción queda vacía y se avisa. `lugarAtencion` se divide en dirección y teléfono como el pie del PDF; sin "Teléfono", todo va a la dirección.
- **Diagnóstico.** Código y descripción se combinan **por campo** (el del nivel superior gana si no está vacío; si no, el del primer ítem). `E660` → `E66.0`; un código inválido se descarta con aviso y se conserva la descripción (máximo 2000 caracteres).
- **Ítems.** Un ítem por elemento de `prescripcion[]`. El texto se divide en renglones y pasa por el **mismo parser de cuerpo que el PDF** (componentes, presentación, fracción de dosis, posología, duración, control de consistencia). `cantidad` se ignora.
- **Datos no importados.** `notas`, `codPractica`, `nroCUIR` y `practica` generan un aviso "no se importa" y nunca se guardan. Un arreglo, objeto o texto vacío cuenta como **dato ausente** (sin aviso).

### Renglones del cuerpo (QR)

- Un guion inicial de lista (`- `) se quita de cada renglón; un renglón que era solo el guion se descarta.
- **Regla P44 (refinada).** Los renglones no clasificables **antes del primer componente** se muestran como información neutra ("Información de la receta (no se guarda)") y no se guardan (por ejemplo, la dirección del consultorio). La regla se decide por renglón: si el renglón contiene una **unidad de dosis** (`mg`, `g`, `mcg`, `µg`, `ml`, `UI`, `%`, palabra completa, sin distinguir mayúsculas) se interpreta como una droga en un formato desconocido y conserva el aviso ámbar `RENGLON_NO_RECONOCIDO` con el texto literal, para que nunca desaparezca. Los renglones no clasificables **después** del primer componente siempre generan ese aviso.
- En recetas con más de un ítem, todo aviso propio de un ítem termina en "(ítem N)" antes del punto final. El aviso informativo de texto inicial, que se deduplica entre ítems, no lleva sufijo. Con un solo ítem no hay sufijo.

### Límites de los avisos

Los avisos reproducen texto que no es nuestro (renglones de la receta, nombres de drogas), y varias etapas agregan avisos (el mapeo del JSON, el parser de cuerpo y el match con el catálogo: drogas y unidades sin match, paciente dado de baja, diferencias de datos). Por eso el tope se aplica **una sola vez, sobre la lista final de la vista previa** del QR (`acotarAvisos`, al terminar el match); el mapeo no recorta nada. La importación por PDF no cambia: ni el parser compartido ni el match se modificaron, el tope solo corre en el camino del QR.

- **Largo del texto citado.** Lo que el aviso **repite** de la receta se corta a **200 caracteres** más "…" **antes** de armar el mensaje final: cada fragmento citado entre «…» dentro de `mensaje` (el renglón literal, las notas, el nombre de la droga o de la unidad, los valores de una diferencia) y el campo `texto`. El resto del mensaje (comillas de cierre, la sugerencia, el sufijo "(ítem N)") queda intacto. Se cuentan caracteres Unicode, así que un emoji nunca queda partido; un fragmento de 200 o menos no se toca, y aplicar el tope dos veces no agrega un segundo "…".
- **Tope de seguridad del mensaje.** Además, el `mensaje` completo no pasa de **600 caracteres** (más "…"): alcanza para dos fragmentos cortados y el texto fijo, y solo corta si algo todavía sale más largo.
- **Cantidad.** Como máximo **50 avisos**. Si hay más, se eligen los primeros 49 por **prioridad**: (1) los avisos **accionables del match** (`PACIENTE_DADO_DE_BAJA`, `DIFERENCIA_DATOS`, `DROGA_SIN_MATCH`, `UNIDAD_SIN_MATCH`), (2) el resto de las advertencias, (3) los avisos informativos; dentro de cada grupo manda el orden original. Los avisos elegidos conservan su orden original y la última posición pasa a ser un aviso con código propio `AVISOS_OMITIDOS` (advertencia ámbar): "Hay más avisos que no se muestran.". Así, 60 renglones no reconocidos y un paciente dado de baja nunca dejan afuera el aviso de la baja. Con 50 avisos o menos no se agrega nada.

## Panel y lector USB

Comportamiento del panel (verificación manual, ver P55–P57):

- El campo tiene el foco al cargar la página (salvo que ya se haya leído una receta). Después de una lectura con éxito y después de "Descartar importación", el foco vuelve al campo con el texto seleccionado: el próximo escaneo **reemplaza** el anterior. Después de un **error** el foco vuelve al campo solo si no está en otro lado (en el `body`, sin elemento activo, o dentro del panel): si el usuario ya pasó al formulario manual, un error tardío **no le roba el foco**.
- Mientras una lectura está en curso, un segundo Enter (por ejemplo, un lector que envía Enter dos veces) no inicia otra lectura (se descarta por el estado pendiente y por una guarda adicional que se activa al enviar y se libera al llegar el resultado).
- Una región de estado (`role="status"`) siempre presente anuncia "Leyendo…" y "Receta leída. Revisá la vista previa."; el error se muestra como alerta (`role="alert"`), el campo queda con `aria-describedby` apuntando a ella y, solo cuando el error es del código ingresado ("QR no válido o receta no encontrada", formato), con `aria-invalid`; una caída de RCTA o un error de permisos no marcan el campo como inválido. El mismo error dos veces seguidas se anuncia dos veces.
- Cuando uno de los paneles (PDF o QR) lee una receta con éxito, el otro se reinicia y pierde su error anterior; el panel que leyó no se reinicia.

Configuración del lector:

- **Sufijo Tab.** Un lector configurado con sufijo Tab mueve el foco al siguiente control **sin enviar** el formulario. Configurarlo para que envíe **Enter**.
- **Prefijos.** Un prefijo del lector pegado directamente a un hash solo (sin link) puede invalidarlo: si el prefijo termina en un carácter hexadecimal (cifra o a–f) quedan más de 64 caracteres hexadecimales seguidos y el código se rechaza. Preferir escanear el QR completo, cuyo link tiene el hash separado por `/` o `-`.

## Origen y auditoría

- La receta se guarda con `origen = DIGITAL_PDF`; el rótulo pasó a **"Digital (PDF o QR)"** en toda la aplicación (no hay cambio de enumeración ni de base de datos).
- La auditoría registra `contexto.fuente` = `"PDF"` o `"QR"`. Lo declara el cliente: es solo para auditoría y no tiene valor de autorización.

## Operación y riesgos

- **API de terceros no documentada.** El servicio de desencriptado de RCTA no es una integración oficial y puede cambiar sin aviso. La alternativa siempre disponible es la importación por PDF (los mensajes de error la sugieren).
- **El hash es una capacidad al portador sobre datos de salud** y viaja en la query string hacia RCTA. **No** habilitar `logging.fetches` de Next ni trazas que registren las URL completas de los fetch. En desarrollo, Next registra por defecto las llamadas a Server Functions con sus argumentos: `next.config.ts` fija `logging.serverFunctions: false` para que el código escaneado no se imprima en la terminal. Aun así, evitar códigos de recetas reales en desarrollo.
- **Verificación de despliegue (M.2).** Tras desplegar, comprobar con un hash de prueba que la salida desde Vercel hacia `decrypter.verumrp.com.ar` funciona; un bloqueo se vería como "No se pudo consultar RCTA".
- **Pendientes (no implementados):** límite de tasa por usuario o tenant; auditoría opcional de las consultas a RCTA; solicitar a Verum/RCTA una integración oficial.

## Casos de prueba

- **P11–P14** — Extracción: link completo, hash solo (con espacios o salto de línea), mayúsculas → minúsculas, link deformado por el teclado.
- **P15–P16** — 63 o 65 hexadecimales, basura, vacío, dos hashes distintos → inválido, sin consulta.
- **P17** — Host ajeno en una URL con `esquema://` → inválido, sin consulta; `https:evil.com/<hash>` y `https:/evil.com/<hash>` → devuelven el hash.
- **P18–P26** — Adaptador: 200 válido; 200 vacío, `null` o `{}`; solo 400 y 422 → QR no válido; 500 "Recipe does not exists" (y 404 con ese mismo cuerpo JSON) → QR no válido; el mismo texto sin `content-type` JSON → RCTA no disponible; cualquier otro 4xx (401, 403, 404 sin ese cuerpo, 405, 407, 408, 410, 421, 429, 451), otros 5xx, timeout, red y redirección → RCTA no disponible; no JSON, más de 64 KiB o esquema inválido → formato inesperado.
- **P27–P39** — Mapeo de cabecera, paciente (nombre nunca leído), médico, matrícula, dirección y teléfono, diagnóstico y fechas.
- **P40–P45** — Ítems: varios elementos, texto de ítem con el parser compartido, avisos de datos no importados, renglones iniciales (con y sin unidad de dosis) y posteriores, sufijo "(ítem N)", guion inicial, dato ausente.
- **P45b** — Tope de avisos de la vista previa final: corte a 200 caracteres del texto citado (el mensaje conserva cierre, sugerencia y sufijo; sin partir un par sustituto) y tope de 600 del mensaje, máximo 50 avisos con prioridad (accionables del match, otras advertencias, informativos; 60 renglones no reconocidos más un paciente dado de baja conservan el aviso de la baja) y aviso `AVISOS_OMITIDOS`, sin mutar la entrada; con muchas drogas sin match y nombres enormes la vista previa del QR queda acotada.
- **P46–P51** — Sin permiso no se consulta; código inválido no se consulta; receta ya cargada (permitida si la anterior está ANULADA); paciente existente o nuevo; ninguna transacción abierta durante la consulta.
- **P52–P53** — La vista previa es la misma que la del PDF; confirmar no vuelve a consultar.
- **P54** — Descartar no guarda nada. **Verificación manual** (es solo de interfaz).
- **P55–P57** — Enter envía una sola vez el texto escrito; el campo vacío no consulta; el panel PDF no cambia y el campo QR tiene el foco al cargar. **Verificación manual**: vitest corre en node, sin DOM, y el componente no se puede renderizar en las pruebas automáticas. Lo que sí está automatizado es la Server Action (`tests/unit/recetas-actions-leer-qr.test.ts`: el campo `codigo`, el éxito, la traducción de errores y la marca `campo: "codigo"` que decide `aria-invalid`), el texto de la región de estado (`tests/unit/recetas-anuncio-lectura.test.ts`) y la decisión pura de devolver el foco tras un error (`tests/unit/recetas-foco-lectura.test.ts`).
- **P64–P66** — El hash, la URL y el cuerpo no aparecen en logs ni mensajes de error; los fixtures son ficticios.
- **P67** — Verificación de despliegue (manual, ver "Operación y riesgos").
- **P68–P70** — Rótulo "Digital (PDF o QR)"; la auditoría registra `fuente` PDF o QR.
- **P71–P72** — Regresión: el flujo y las pruebas del PDF no cambian.

Los fixtures se arman a mano con datos **ficticios** (hash inventado, nombres y documentos inventados); no se versiona ninguna respuesta real de RCTA.

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
| 200 vacío o `null`; HTTP 500 con `{"error":"Recipe does not exists"}` (así responde RCTA ante un hash desconocido); cualquier otro 4xx | "QR no válido o receta no encontrada" |
| 401, 403 (bloqueo de IP, WAF o autenticación futura), 408, 429, otros 5xx, error de red, timeout, redirección | "No se pudo consultar RCTA, importá el PDF" |
| 200 que no es JSON, cuerpo mayor a 64 KiB, JSON que no cumple el esquema | "RCTA devolvió la receta en un formato inesperado. Importá el PDF." |

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

- Todo texto reproducido en un aviso (notas, renglón informativo, renglón no reconocido) se corta a **200 caracteres** más "…".
- Una receta produce como máximo **50 avisos**: se conservan los primeros 49 y se agrega "Hay más avisos que no se muestran.".

## Origen y auditoría

- La receta se guarda con `origen = DIGITAL_PDF`; el rótulo pasó a **"Digital (PDF o QR)"** en toda la aplicación (no hay cambio de enumeración ni de base de datos).
- La auditoría registra `contexto.fuente` = `"PDF"` o `"QR"`. Lo declara el cliente: es solo para auditoría y no tiene valor de autorización.

## Operación y riesgos

- **API de terceros no documentada.** El servicio de desencriptado de RCTA no es una integración oficial y puede cambiar sin aviso. La alternativa siempre disponible es la importación por PDF (los mensajes de error la sugieren).
- **El hash es una capacidad al portador sobre datos de salud** y viaja en la query string hacia RCTA. **No** habilitar `logging.fetches` de Next ni trazas que registren las URL completas de los fetch. En desarrollo, Next registra las llamadas a Server Functions con sus argumentos (`logging.serverFunctions`): no usar códigos de recetas reales en ese entorno.
- **Verificación de despliegue (M.2).** Tras desplegar, comprobar con un hash de prueba que la salida desde Vercel hacia `decrypter.verumrp.com.ar` funciona; un bloqueo se vería como "No se pudo consultar RCTA".
- **Pendientes (no implementados):** límite de tasa por usuario o tenant; auditoría opcional de las consultas a RCTA; solicitar a Verum/RCTA una integración oficial.

## Casos de prueba

- **P11–P14** — Extracción: link completo, hash solo (con espacios o salto de línea), mayúsculas → minúsculas, link deformado por el teclado.
- **P15–P16** — 63 o 65 hexadecimales, basura, vacío, dos hashes distintos → inválido, sin consulta.
- **P17** — Host ajeno en una URL con `esquema://` → inválido, sin consulta; `https:evil.com/<hash>` y `https:/evil.com/<hash>` → devuelven el hash.
- **P18–P26** — Adaptador: 200 válido; 200 vacío, `null` o `{}`; 4xx; 500 "Recipe does not exists"; otros 5xx, 401, 403, 408, 429, timeout, red y redirección → RCTA no disponible; no JSON, más de 64 KiB o esquema inválido → formato inesperado.
- **P27–P39** — Mapeo de cabecera, paciente (nombre nunca leído), médico, matrícula, dirección y teléfono, diagnóstico y fechas.
- **P40–P45** — Ítems: varios elementos, texto de ítem con el parser compartido, avisos de datos no importados, renglones iniciales (con y sin unidad de dosis) y posteriores, sufijo "(ítem N)", guion inicial, dato ausente, topes de 200 caracteres y 50 avisos.
- **P46–P51** — Sin permiso no se consulta; código inválido no se consulta; receta ya cargada (permitida si la anterior está ANULADA); paciente existente o nuevo; ninguna transacción abierta durante la consulta.
- **P52–P54** — La vista previa es la misma que la del PDF; confirmar no vuelve a consultar; descartar no guarda nada.
- **P55–P57** — Enter envía una sola vez el texto escrito; el campo vacío no consulta; el panel PDF no cambia y el campo QR tiene el foco al cargar.
- **P64–P66** — El hash, la URL y el cuerpo no aparecen en logs ni mensajes de error; los fixtures son ficticios.
- **P67** — Verificación de despliegue (manual, ver "Operación y riesgos").
- **P68–P70** — Rótulo "Digital (PDF o QR)"; la auditoría registra `fuente` PDF o QR.
- **P71–P72** — Regresión: el flujo y las pruebas del PDF no cambian.

Los fixtures se arman a mano con datos **ficticios** (hash inventado, nombres y documentos inventados); no se versiona ninguna respuesta real de RCTA.

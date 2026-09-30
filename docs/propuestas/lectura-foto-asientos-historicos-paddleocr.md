# Propuesta — Lectura de fotos del libro físico para asientos históricos (PaddleOCR local)

> **Estado:** propuesta, NO aprobada para implementar. Queda como posible implementación de la carga asistida en `/libro/historico` (FASE 9, punto 9.5, DP-17).
> **Condición previa:** repetir el benchmark con las fotos originales en resolución completa (ver §2.3). Si no se alcanzan los umbrales, se cambia el motor (§11) sin tocar el resto del diseño.
> **Convención:** igual que `docs/plan-implementacion.md` — **[CONFIRMADO]** sale de lo acordado con el usuario o de una medición; **[PROPUESTA TÉCNICA]** es revisable; **DECISIÓN PENDIENTE** se resuelve antes de implementar.

---

## 1. Objetivo y alcance

Hoy `/libro/historico` permite digitalizar **un asiento a la vez**, a mano (`modules/libro/ui/historico-form.tsx` → `crearAsientoHistoricoCommand`). Se quiere automatizar la carga a partir de una **foto de una página del libro recetario físico**:

1. El usuario sube la foto de una página e indica mes y año.
2. El sistema lee la página y arma **varios asientos a la vez**.
3. El usuario **previsualiza y corrige** todos los asientos en una tabla editable.
4. Recién con su **confirmación explícita** se guardan, todos juntos o ninguno.

Requisitos del usuario **[CONFIRMADO]**:

- Una carga puede traer **varios asientos**; la previsualización es obligatoria.
- El **número de asiento no se repite nunca** (se releva un solo libro como mucho).
- Los **asientos tachados no se relevan**.
- El servicio de lectura es **temporal** y corre **localmente en la PC del usuario** mientras dura el relevamiento.

Fuera de alcance: libros contralor, generación de movimientos de stock, correlativo o hash (DP-17: los históricos son solo control, en tabla aparte).

## 2. Evidencia: benchmark de motores locales (2026-09-28)

### 2.1 Formato del libro **[CONFIRMADO]**

- Encabezado de página: "Mes de ___" y "de 20__". El año del encabezado resultó ilegible en ambas muestras.
- Columnas: **Número · Médico · Fecha (solo el día) · Fórmula de la prescripción · Cantidades (con subcolumnas de unidad) · Precio**.
- Un asiento ocupa **varias líneas**: empieza en la fila con número y sigue hasta el próximo número. Hay una línea por componente ("Fluoxetina 20") más líneas de presentación ("Ludipress csp", "1 cap = 30 ½ dosis", "1 env = 30 gr").
- El médico figura como apellido ("Benedetti", "Blanco C") o como matrícula ("Mat nº 9517").
- **No hay columna de paciente.**
- Las primeras líneas de una página pueden ser la **continuación** de un asiento que empezó en la página anterior; no tienen número.

### 2.2 Resultados (2 páginas, 15 asientos, CPU)

Setup: Python 3.13, paddlepaddle 3.3.1 (CPU), paddleocr 3.7.0 (`lang="es"`, que usa PP-OCRv6 medium), easyocr 1.7.2. Detalle y salidas crudas en el scratchpad de la sesión (`ocr-bench/summary.md`); no están versionadas.

| Motor | s/página | Nº asiento exacto | Nº con 1 dígito mal | Día | Drogas exactas / a ≤2 letras | Cantidades en la fila correcta |
|---|---|---|---|---|---|---|
| **PaddleOCR PP-OCRv6** | 23 | 6/15 | 14/15 | 10/14 | 18/45 · 36/45 | 21/39 |
| PaddleOCR PP-OCRv5 latin | 19 | 4/15 | 14/15 | 9/14 | 13/45 · 28/45 | 18/39 |
| EasyOCR `es` | 5 | 0/15 | 2/15 | — | 1/45 · 4/45 | 0/39 |

Hallazgos que condicionan el diseño:

- **Se pierde la coma decimal**: "1,2" se lee "12" y "1,6" se lee "116", un error de dosis de 10×. Toda cantidad requiere revisión humana.
- **Hay que inclinar las columnas**: en una foto tomada en ángulo las columnas se desplazan a lo largo de la página. Con límites verticales fijos, las cantidades bajan a 8/39 y en la página 1 todas cayeron en "Precio". Con límites inclinados, ajustados en cada página, suben a 21/39.
- **Las filas se arman bien anclándolas al número**: con esa regla hubo un solo error de límite entre asientos por página.
- **El motor une el día con la fórmula**: a veces devuelve un solo bloque, como "26 Omeprazol". Hay que separarlo.
- **Los tachados no se detectan**: ningún motor da una señal de tachado; solo devuelven texto, confianza y coordenadas.
- **El preprocesamiento no sirve**: el umbral adaptativo empeora mucho, subir el contraste es neutro y agrandar la imagen no aporta nada. Hay que usar la imagen original en color.
- **Paddle 3.3.1 en CPU se cae con oneDNN**: hay que usar `enable_mkldnn=False`, y eso lo lleva a ~23 s por página.
- **La resolución de las muestras invalida la conclusión**: 553×751 y 489×628 px, con una letra de 8 a 12 px de alto.

### 2.3 Criterio para avanzar **[PROPUESTA TÉCNICA]**

Repetir el benchmark con fotos originales (de frente, con buena luz y resolución completa). Se avanza con PaddleOCR si, sobre al menos 3 páginas:

- el número de asiento es exacto en **≥ 80 %** de los casos, o exacto en ≥ 1 por página y con 1 dígito de error en el resto (la regla de secuencia de §5.4 cubre ese caso);
- el día es correcto en **≥ 90 %**;
- las cantidades quedan en la fila correcta en **≥ 75 %**.

Si no se cumple, se cambia el motor (§11). El resto del diseño no cambia.

## 3. Arquitectura

```
PC del usuario (solo durante el relevamiento)
┌──────────────────────────────────────────────────────────────────────┐
│  Navegador ──► Next.js (npm run dev, local)                          │
│                 │ Server Action leerFotoHistorico                    │
│                 │   valida → reenvía la imagen (en memoria)          │
│                 ▼                                                    │
│            Servicio OCR (FastAPI + PaddleOCR) en 127.0.0.1:8765      │
│                 │ devuelve tokens {texto, confianza, caja}           │
│                 ▼                                                    │
│  Next.js: parser PURO (TypeScript) → { asientos, advertencias }      │
│                 ▼                                                    │
│  Previsualización editable → confirmación                            │
│                 ▼                                                    │
│  crearAsientosHistoricosLoteCommand (1 transacción) → Supabase       │
└──────────────────────────────────────────────────────────────────────┘
```

Principios **[PROPUESTA TÉCNICA]**:

- **El motor solo lee; las reglas quedan en el código.** El servicio Python devuelve texto con coordenadas y nada más. Armar filas y columnas, validar, detectar duplicados y decidir qué se guarda lo hace el parser puro en TypeScript, que es testeable y no depende del motor. Así se puede cambiar el motor (§11) sin tocar las reglas.
- **La salida del motor es un dato no confiable.** Pasa por zod y por el parser, igual que cualquier input del usuario.
- **La imagen nunca se guarda.** Vive en memoria en Next.js y en el servicio OCR y se descarta al terminar la lectura.
- **Degradación visible.** Nada se descarta en silencio: todo lo que no se pudo interpretar se muestra como advertencia en la previsualización.
- **Producción no depende del servicio.** Si `OCR_SERVICE_URL` no está definida (Vercel), el botón "Leer foto" no se muestra y la carga manual sigue igual.

## 4. Servicio OCR local (Python)

### 4.1 Ubicación y stack

- Carpeta `tools/ocr-historico/` en el repo. No forma parte del build de Next ni del deploy.
  - `app.py` (FastAPI)
  - `requirements.txt` con versiones fijas
  - `README.md`
  - `start.ps1`
- Python 3.13, `paddlepaddle==3.3.1` (CPU), `paddleocr==3.7.0`, `fastapi`, `uvicorn`, `python-multipart`, `pillow`.
- Inicialización única al arrancar el proceso (el modelo se carga una vez):
  ```python
  PaddleOCR(lang="es", enable_mkldnn=False,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,          # probar True en el re-benchmark (fotos curvadas)
            use_textline_orientation=False)
  ```

### 4.2 Contrato

`GET /health` → `{ "status": "ok", "engine": "paddleocr", "version": "3.7.0", "model": "PP-OCRv6_medium" }`

`POST /ocr` (`multipart/form-data`, campo `imagen`) → `200`:

```json
{
  "engine": "paddleocr@3.7.0/PP-OCRv6_medium",
  "ancho": 3024,
  "alto": 4032,
  "tokens": [
    { "texto": "34146", "confianza": 0.91, "caja": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]] }
  ],
  "ms": 21840
}
```

- Coordenadas en píxeles de la imagen **tal como fue recibida**. Si el servicio corrige la orientación, devuelve las coordenadas ya transformadas.
- Errores: `400` si la imagen es inválida, `413` si es demasiado grande, `500` si falla el motor. El cuerpo es `{ "error": "<código>" }`, sin trazas.

### 4.3 Reglas de seguridad del servicio

- Escucha **solo en `127.0.0.1`**, nunca en `0.0.0.0`.
- Token compartido `OCR_SERVICE_TOKEN` en el header `Authorization: Bearer …`. Evita que otra página abierta en el navegador le haga pedidos al puerto local.
- Límite de tamaño (15 MB) y verificación de la firma del archivo (§5.2), también de este lado.
- No escribe archivos, no loguea texto reconocido y no usa telemetría. Los modelos se descargan una sola vez de los hosts oficiales de PaddlePaddle.

### 4.4 Instalación en Windows (lecciones del benchmark)

- Instalar en una **ruta corta** (por ejemplo `C:\ocr-historico\venv`). Con rutas largas, `pip install paddlepaddle` falla por el límite de 260 caracteres de Windows. En el benchmark se esquivó con `subst`; en la instalación real alcanza con usar una ruta corta.
- `set PYTHONIOENCODING=utf-8`: las barras de progreso de las descargas rompen la consola si no.
- Los modelos (unos 320 MB) se guardan en caché la primera vez y después funciona sin conexión.
- `start.ps1` activa el venv, define el token y levanta `uvicorn app:app --host 127.0.0.1 --port 8765`.

## 5. Cambios en la app (Next.js)

### 5.1 Configuración

- `shared/env.ts`: variables opcionales y solo de servidor `OCR_SERVICE_URL` y `OCR_SERVICE_TOKEN`. Se validan con zod: la URL tiene que ser `http://127.0.0.1:*` o `http://localhost:*`; cualquier otro host se rechaza al arrancar.
- `.env.example`: documentarlas comentadas.
- Visibilidad del botón "Leer foto": `puedeDigitalizar && ocrDisponible`, donde `ocrDisponible` significa que la variable está definida. Si el servicio no responde, se muestra "El servicio de lectura no está corriendo" y queda disponible la carga manual.

### 5.2 Server Action `leerFotoHistoricoAction` (frontera de confianza)

Ubicación: `modules/libro/ui/actions.ts`, sobre una query `libro.historico.leerFoto` en `modules/libro/application/leer-foto-historico.ts`. El reenvío al servicio va en `modules/libro/infrastructure/ocr-client.server.ts` (`import "server-only"`).

Orden deliberado de validaciones; cada paso corta antes de gastar recursos:

1. `authorize("libro.historico.digitalizar")`, vía `defineQuery`.
2. `instanceof File`.
3. `size === 0` → error.
4. `size > MAX_FOTO_BYTES` (15 MB), **antes** de `arrayBuffer()`.
5. `file.type` en `image/jpeg | image/png | image/webp`. Es solo un filtro rápido.
6. **Firma real del archivo**, que es el chequeo que vale:
   - JPEG: `FF D8 FF`.
   - PNG: `89 50 4E 47 0D 0A 1A 0A`.
   - WebP: `RIFF????WEBP`.

   El `Content-Type` lo pone el navegador a partir de la extensión, así que no alcanza.
7. Recién entonces se reenvía al servicio con timeout (60 s). La respuesta se valida con zod (`ocrRespuestaSchema`) antes de pasarla al parser.

Las fotos de iPhone en HEIC no se aceptan. La UI indica que hay que exportarlas o sacarlas en JPG. **[PROPUESTA TÉCNICA]**

La acción **no audita**, porque es una lectura sin efecto. Lo que se audita es la confirmación (§5.7).

### 5.3 Calibración de columnas en la UI **[PROPUESTA TÉCNICA]**

El benchmark mostró que sin columnas inclinadas por página la asignación de columnas no funciona. Fase 1, calibración manual asistida:

- Después de subir la foto, se muestra la imagen con **5 separadores** de columna (Número|Médico, Médico|Fecha, Fecha|Fórmula, Fórmula|Cantidades, Cantidades|Precio).
- Cada separador es un segmento con un **punto arriba y otro abajo** que se arrastran sobre las líneas azules del libro. Eso define la recta `x = a + b·y`.
- Se precargan con los últimos valores usados, guardados en `localStorage`. Si todas las fotos se sacan igual, casi no hay que moverlos.
- La calibración viaja al parser junto con los tokens y no se persiste en la base.

Fase 2 (opcional), detección automática: dos candidatos, a evaluar en el re-benchmark.

- Detectar las líneas verticales impresas con OpenCV (`HoughLinesP` sobre el canal azul).
- Activar `use_doc_unwarping=True` de PaddleOCR.

Si alguno funciona, los separadores llegan precargados y el usuario solo confirma.

### 5.4 Parser puro — `modules/libro/domain/lectura-historico.ts`

Función pura, sin dependencias de runtime:

```ts
interpretarPagina(entrada: {
  tokens: TokenOcr[];                    // salida validada del servicio
  columnas: SeparadorColumna[];          // 5 rectas x = a + b·y
  mes: number; anio: number;             // elegidos por el usuario: una sola fuente de verdad
  numerosExistentes: ReadonlySet<string>; // números ya cargados (tipoLibro elegido)
}): { asientos: AsientoLeido[]; advertencias: Advertencia[] }
```

Algoritmo:

1. **Normalizar tokens**: centro de la caja, altura, y texto sin espacios repetidos.
2. **Asignar columna** por el centro del token contra las rectas de separación, evaluadas a la altura de ese token.
3. **Separar día y fórmula unidos**: si un token empieza en la columna Fecha y su texto coincide con `^(\d{1,2})\s+(.+)$`, se divide en un token de día y otro de fórmula.
4. **Anclas**: cada token de la columna Número que coincide con `^\d{3,6}$` (después de corregir las confusiones típicas, ver 5) inicia un asiento. Un token pertenece al último ancla que cumple `ancla.cy <= token.cy + tolerancia`. La tolerancia es `0.6 × mediana de altura de los tokens`, derivada de la foto y no un número fijo, porque el número suele estar escrito un poco más abajo que su primera línea.
5. **Número de asiento**:
   - Corregir confusiones típicas del OCR solo dentro de esta columna: `O→0`, `I/l→1`, `Z→2`, `S→5`, `B→8`, `h/t→4` según la prueba (marcado como dudoso).
   - **Regla de secuencia**: los asientos de una página son consecutivos. Se toma como base el número de mayor confianza que sea coherente con su posición y se deduce el resto (`base + índice`).
   - Si la lectura y la deducción no coinciden, se propone la deducción y se marca **"número inferido"** para que el usuario lo confirme.
6. **Continuación**: las líneas antes del primer ancla se agrupan en una advertencia "Continuación del asiento de la página anterior — no se carga", con su texto visible. **DECISIÓN PENDIENTE (D2)**: ¿se permite anexarlas a un asiento ya cargado?
7. **Día**: entero entre 1 y 31 válido para mes/año, con `fechaAsiento = AAAA-MM-DD`. Si falta o no es válido, se hereda del asiento anterior de la misma página y se marca **"día inferido"**.
8. **Médico**: el texto de la columna, tal cual. Se detecta la forma matrícula (`/^mat\.?\s*n?[º°o]?\s*(\d+)/i`) para mostrarla normalizada como "Mat. Nº 9517".
9. **Líneas de fórmula**: cada línea visual de la columna Fórmula es una línea del asiento, emparejada con el token de Cantidades más cercano en `y` dentro de la misma fila del asiento (y con Precio si hay).
10. **Cantidades** (`parseCantidadAR`):
    - Entero o decimal con coma.
    - **Todo número de 2 o más dígitos en una línea de droga se marca "verificar decimales"**, porque la coma se pierde en la lectura.
11. **Líneas de presentación** (`csp`, `1 cap =`, `1 env =`, `c/s`, `½ dosis`): se reconocen por patrón y se conservan como texto sin cantidad. No se comparan contra el catálogo.
12. **Confianza por campo**: `alta` si la confianza del OCR es ≥ 0.9 y el valor pasó todas las reglas; `media` si fue corregido o inferido; `baja` si la confianza es < 0.6 o falló alguna regla.
13. **Duplicados**:
    - número repetido **dentro de la lectura** → error;
    - número presente en `numerosExistentes` → error "ya cargado", con la fila excluida por defecto.

Advertencias, todas visibles:

- continuación;
- tokens fuera de toda columna;
- número inferido o dudoso;
- día inferido;
- cantidad con posible decimal perdido;
- asiento sin líneas de fórmula;
- número duplicado.

### 5.5 Coincidencia con el catálogo de drogas **[PROPUESTA TÉCNICA]**

- Normalización: minúsculas, NFD sin tildes, espacios colapsados.
- Índice `Map<nombreNormalizado, droga>` con las drogas del tenant, **incluidas las dadas de baja**, porque un asiento histórico puede nombrar drogas que ya no se usan. Se obtiene con una query nueva `drogas.nombresParaCoincidencia`, con el mismo permiso que la acción de lectura.
- **Coincidencia exacta** → la línea queda "reconocida".
- **Sin coincidencia exacta**: se ofrecen hasta 3 sugerencias con distancia de Levenshtein ≤ 2. **Nunca se aplican solas**: el usuario elige una o deja el texto leído.
- El asiento histórico guarda `formulaTexto` como **texto libre** (el modelo no se cambia). La coincidencia solo sirve para corregir la ortografía de ese texto; no crea vínculos con `droga`.

### 5.6 Previsualización editable

Componente cliente `modules/libro/ui/lectura-historico-preview.tsx`:

- Tabla con una fila por asiento. Columnas: Incluir ☑ · Nº · Día · Médico · Fórmula (líneas editables, con su cantidad) · Precio · Estado.
- **Tachados**: el motor no los detecta, así que cada fila tiene la casilla **"Incluir"**. La UI muestra **junto a la tabla el recorte de la foto de esa fila**, para comparar sin cambiar de pantalla. Las filas excluidas no se envían.
- Los campos con confianza baja o media se resaltan. Las cantidades marcadas como "verificar decimales" muestran un aviso.
- **Confirmación de revisión**: el botón "Cargar N asientos" se habilita recién cuando el usuario marcó "Revisé todas las filas". **DECISIÓN PENDIENTE (D3)**: ¿alcanza una casilla global o se exige una por fila?
- Los duplicados (en la lectura o ya cargados) bloquean la carga hasta que se corrijan o se excluyan.
- Todo el estado vive en el cliente hasta la confirmación. Si se recarga la página se pierde, y eso es aceptable: la foto se puede volver a leer.

### 5.7 Comando de carga en lote

`modules/libro/application/crear-asientos-historicos-lote.ts`:

```ts
defineCommand({
  name: "libro.historico.crearLote",
  permiso: "libro.historico.digitalizar",
  input: z.object({
    tipoLibro: z.enum(TIPO_LIBRO_HISTORICO),
    asientos: z.array(asientoHistoricoItem).min(1).max(40),
  }),
  audit: { skip: true, reason: "One CREAR row per asiento via manual auditRecord, same shape as libro.historico.crear" },
  handler: ...
})
```

- `asientoHistoricoItem` reutiliza los campos de `crearAsientoHistoricoInput` (se extraen a un schema compartido en `modules/libro/domain/`), sin `tipoLibro`, que es uno por lote.
- **Todo o nada**: una sola transacción (`withTenantTransaction`). Si falla un asiento, no se guarda ninguno.
- Orden dentro de la transacción:
  1. Validar números repetidos **dentro del lote**: `DomainError` con la lista de números.
  2. Consultar los números ya existentes (`WHERE tipo_libro = $1 AND numero_asiento_fisico = ANY($2)`): `DomainError` con esa lista.
  3. Insertar uno por uno, **secuencialmente** y sin `Promise.all`, para no volver a provocar consultas concurrentes sobre la misma conexión de la transacción.
  4. `auditRecord` CREAR por asiento, con `valorNuevo` igual al del alta individual más `origen: "LECTURA_FOTO"`, y la versión del motor en `motivo`.
- El `UNIQUE (tenant_id, tipo_libro, numero_asiento_fisico)` de la migración 0035 sigue siendo la **garantía final** si hay una carrera. Un `P2002` se traduce al mismo mensaje que en el alta individual.
- Mapeo al modelo `AsientoHistorico`:

  | Campo | Valor |
  |---|---|
  | `numeroAsientoFisico` | canónico (`canonicalizarNumeroAsientoFisico`) |
  | `fechaAsiento` | `AAAA-MM-DD` |
  | `medicoTexto` | médico |
  | `pacienteTexto` | `null` (el libro no tiene esa columna) |
  | `formulaTexto` | líneas unidas con `\n`, cada una "nombre cantidad" |
  | `observaciones` | `"Precio: <valor>"` si hay precio (**DECISIÓN PENDIENTE D4**) |

- No hace falta ninguna migración nueva: el modelo actual alcanza.

### 5.8 Página

`app/(app)/libro/historico/page.tsx`: se agrega el bloque "Leer foto de una página", visible con `puedeDigitalizar && ocrDisponible`, arriba del formulario individual, que se mantiene. Los pasos se muestran en la misma página: foto + mes/año + tipo de libro → calibración → previsualización → resultado.

## 6. Tachados

- **Fase 1 [CONFIRMADO por el benchmark]**: sin detección automática. El usuario excluye los tachados en la previsualización, ayudado por el recorte de la foto de cada fila.
- **Fase 2 (opcional) [PROPUESTA TÉCNICA]**: heurística en el servicio. Para cada caja de texto, detectar un trazo horizontal largo que la cruce a media altura, con OpenCV (proyección horizontal de píxeles oscuros o `HoughLinesP` limitado a la caja). Devuelve `posibleTachado: true` y la fila llega **ya excluida**, pero con la casilla visible para volver a incluirla. Hay que medirla con páginas reales que tengan tachados antes de activarla.

## 7. Privacidad y seguridad

- La imagen no sale de la PC: el servicio escucha en 127.0.0.1 y Next.js corre local durante el relevamiento. No hay terceros.
- No se guarda ninguna imagen: ni en disco, ni en Supabase Storage, ni en logs.
- El servicio no está en producción: sin `OCR_SERVICE_URL`, la funcionalidad no existe en la interfaz.
- La autorización es la de siempre: `libro.historico.digitalizar` (DT) en la lectura y en la carga.
- Auditoría: un CREAR por asiento con `origen: "LECTURA_FOTO"`, que distingue lo leído por foto de lo cargado a mano.

## 8. Pruebas

- **Unitarias del parser** (`tests/unit/libro-lectura-historico.test.ts`), con fixtures de tokens **sintéticos**: se arman a partir de la geometría del benchmark pero con nombres de médicos ficticios, para no versionar datos reales. Casos:
  - continuación antes del primer ancla;
  - día unido a la fórmula;
  - número con un dígito mal → inferido por la regla de secuencia;
  - número duplicado en la lectura y ya existente;
  - cantidad "12" en una línea de droga → marcada "verificar decimales";
  - líneas `1 cap =` y `csp` como presentación;
  - página inclinada, donde las columnas fijas fallan y las inclinadas aciertan;
  - token fuera de toda columna → advertencia.
- **Unitarias de la frontera**:
  - firma de archivo: un `.exe` renombrado a `.jpg` se rechaza;
  - el tamaño se controla antes de `arrayBuffer()`;
  - la respuesta del servicio que no cumple el schema se rechaza.
- **Comando en lote**:
  - todo o nada: el tercer asiento duplicado revierte todo;
  - duplicados dentro del lote;
  - existentes;
  - auditoría: N filas CREAR con `origen`;
  - matriz de autorización.
  - El test de completitud de etiquetas (`FIELD_LABELS`) va a exigir etiquetas para los campos nuevos.
- **DB** (`tests/db/`): el `UNIQUE` sigue siendo la garantía final en una carrera, con dos transacciones cargando el mismo número.
- **Servicio Python**: `tools/ocr-historico/tests/` con pytest contra `/health` y `/ocr` (imagen sintética con texto impreso). Chequea el contrato y los rechazos 400/413. La exactitud la mide el benchmark, no los tests.
- **Re-benchmark** reproducible: `tools/ocr-historico/bench/` con el script de medición y la ground truth. Las fotos **no se versionan**: se pasan por ruta.

## 9. Fases y orden de trabajo

| Fase | Contenido | Sale cuando |
|---|---|---|
| 0 | Re-benchmark con fotos originales (y probar `use_doc_unwarping`) | Se cumplen los umbrales de §2.3, o se cambia el motor |
| 1 | Servicio Python + `ocr-client` + Server Action con validaciones | `/health` y `/ocr` responden; la frontera tiene tests |
| 2 | Parser puro + fixtures + tests | Tests del parser en verde |
| 3 | Calibración manual + previsualización + coincidencia con el catálogo | Flujo completo con una foto real en local |
| 4 | Comando en lote + auditoría + tests (unitarios y de DB) | Todo o nada, duplicados y auditoría verificados |
| 5 (opcional) | Calibración automática y heurística de tachados | Medidas en páginas reales antes de activarlas |

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Lectura insuficiente de números y decimales | Umbral de §2.3 antes de implementar; regla de secuencia; aviso "verificar decimales"; revisión obligatoria |
| Fotos inclinadas o curvadas | Calibración por página; pautas de captura en la UI (de frente, buena luz, página completa); probar `use_doc_unwarping` |
| 20–25 s por página en CPU | Aceptable para un relevamiento puntual; indicador de progreso; timeout de 60 s |
| Bug de oneDNN en paddle 3.3.1 | `enable_mkldnn=False` y versiones fijas en `requirements.txt` |
| Tachados cargados por error | Casilla "Incluir" más el recorte de la foto de cada fila; confirmación de revisión |
| Continuaciones entre páginas | Se muestran como advertencia y no se cargan (D2) |
| Otra página del navegador llamando al servicio local | Solo 127.0.0.1 + token compartido |

## 11. Alternativa si PaddleOCR no alcanza

El contrato del servicio (`tokens` con texto, confianza y caja) es independiente del motor. Opciones, en orden de preferencia:

1. **Azure AI Document Intelligence (Read)** o **Google Cloud Vision (`DOCUMENT_TEXT_DETECTION`)**: leen manuscritos en español y devuelven líneas con coordenadas. Se cambia solo el adaptador del servicio; parser, previsualización y comando quedan iguales. Contras: las imágenes salen a un tercero y hay costo por página (con nivel gratuito).
2. **Modelo con visión (Claude, API de Anthropic)**: devuelve los asientos ya estructurados y puede marcar tachados y lecturas dudosas. En ese caso la salida se valida con el mismo zod y pasa por las mismas reglas de §5.4 (duplicados, fechas, decimales), pero la asignación geométrica de columnas deja de hacer falta. Contras: igual que en la opción 1.

## 12. Decisiones pendientes

- **D1** — Tipo de libro por lote: ¿siempre RECETARIO, o se elige en cada carga (RECETARIO / PSICOTRÓPICO / ESTUPEFACIENTE)?
- **D2** — Continuaciones entre páginas: ¿solo advertencia, o se permite anexar esas líneas al último asiento cargado de la página anterior? Hoy los asientos históricos no se editan después de cargados.
- **D3** — Confirmación de revisión: ¿casilla global o una por fila?
- **D4** — Precio: ¿se guarda en `observaciones` o se descarta?
- **D5** — Tamaño máximo del lote: se propone 40 asientos, que alcanza para más de una página.

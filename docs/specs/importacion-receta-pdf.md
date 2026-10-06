# SPEC — Importación de receta digital desde PDF

> Fuente: decisiones del usuario (2026-09-29), sobre una receta real de la plataforma RCTA ("Tu Recetario Digital").
> Resuelve DP-23 y DP-29 (ver `docs/plan-implementacion.md` §21, DP-42).
> Las notas **[ACLARACIÓN]** son deducciones de consistencia; no agregan requisitos.

## Alcance

En `/recetas/nuevo`, el usuario sube el PDF de una receta digital. El sistema lo lee, **precarga el formulario** y muestra una vista previa con advertencias. Nada se guarda hasta que el usuario confirma. Al confirmar, en **una sola transacción**, se dan de alta el paciente y el médico que falten, se crea la receta y se guardan los alias de drogas que el usuario eligió recordar.

El PDF **no se almacena**: vive en memoria durante la lectura y se descarta.

Fuera de alcance: recetas escaneadas (sin capa de texto), `DIGITAL_FOTO`, obras sociales (DP-30), OCR y LLM.

## Arquitectura (4 piezas)

| Pieza | Ubicación sugerida | Naturaleza |
|---|---|---|
| 1. Extracción | `modules/recetas/infrastructure/receta-pdf.server.ts` | `import "server-only"` + `unpdf`: devuelve `TextItemLite[][]` (`str, x, y, width, height`) y los links del documento (anotaciones `Link` con URI). Nada más. |
| 2. Parser | `modules/recetas/domain/receta-pdf-parser.ts` | Función **pura**. Recibe los items y links; devuelve `{ borrador, advertencias }`. Se testea con datos sintéticos, sin PDFs binarios en el repo. |
| 3. Frontera de confianza | server action de lectura | Validaciones del archivo (ver abajo). |
| 4. Match | `modules/recetas/application/` | Vincula el borrador con paciente, médico, drogas y unidades existentes. |

## Pieza 3 — Frontera de confianza (orden obligatorio)

1. Permiso `recetas.crear`.
2. `instanceof File`.
3. `size === 0` → error.
4. `size > MAX_PDF_BYTES` (1 MB, igual al `bodySizeLimit` de Server Actions) → error, **antes** de `arrayBuffer()`.
5. `file.type === "application/pdf"`.
6. Firma `%PDF-` en los primeros 1024 bytes. Es el chequeo que realmente vale.

El PDF puede venir cifrado solo con contraseña de permisos (la muestra de RCTA usa AES-128 sin contraseña de apertura); debe leerse igual. Si pide contraseña de apertura → error "PDF protegido".

Datos personales (DP-24): el PDF y el borrador viajan solo por POST; nunca en URL ni en logs. La lectura **no** se audita (es una consulta); lo que se audita es la confirmación.

## Pieza 2 — Parser

### Renglones

Agrupar los items en renglones visuales por proximidad de `y`, con tolerancia `max(2, medianaAltura × 0.6)`. Dentro del renglón, ordenar por `x` y unir con espacio.

### Detección de emisor

El logo del emisor es una imagen: no se detecta por texto. Se detecta por el host del link de verificación o por el número de registro `RL-AAAA-NNNNNNNNN`.

| Emisor | Señal | Código |
|---|---|---|
| RCTA | link a `verumrp.com.ar/prescripcion/…` | `RCTA` |

Emisor desconocido → el parser responde "formato de receta no reconocido" y no precarga nada. Cada emisor nuevo es un parser nuevo (estrategia por emisor), con sus propios tests.

### Campos del encabezado (RCTA)

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

### Cuerpo `Rp./` (entre `Rp./` y `Diagnóstico:`)

Cada renglón se clasifica con la primera regla que matchee:

| Regla | Patrón (ilustrativo) | Resultado |
|---|---|---|
| Ignorado | empieza con `- ` inmediatamente después de `Rp./` | Se descarta en silencio (ej. `- Avellaneda 14 las Heras`; significado desconocido). |
| Componente | `^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(mg\|g\|mcg\|µg\|ml\|UI\|%)$` | Componente `POR_DOSIS`, cantidad en es-AR (coma decimal). Si es principio activo no se lee del PDF: lo define la clase de la droga elegida en el catálogo (`DROGA`), al guardar. |
| Presentación | `^(\d+)\s+(comprimidos?\|c[áa]psulas?\|…)$` | `cantidadUnidades` + `formaFarmaceutica` por léxico. |
| Fracción de dosis | contiene `media dosis` / `½ dosis` | `fraccionDosisPorUnidad = 0.5` (convención de `ficha-tecnica.md`, asiento 34147). |
| Posología | contiene `cada N horas` (u otra indicación de toma) | Renglón literal a `item.posologia`. |
| Duración | `tratamiento por N d[ií]as` | `item.duracionTratamientoDias = N`. |
| Otro | — | **Advertencia visible** con el texto del renglón. |

Reglas del ítem:

- La dosis indicada es la dosis completa: los componentes se cargan `POR_DOSIS`.
- Sin mención de fracción → `fraccionDosisPorUnidad = 1`.
- Un renglón puede ser a la vez fracción y posología (`Media dosis cada 12 horas`): aplica ambas.
- Un único ítem por receta en RCTA. Si aparecen señales de más de un ítem → advertencia.

**Control de consistencia (solo advertencia, nunca bloquea):** con `cantidadUnidades`, tomas por día (`24 / N horas`, una unidad por toma) y `duracionTratamientoDias`, si `cantidadUnidades / tomasPorDia ≠ duracion` → advertencia "Las unidades alcanzan para X días; la receta indica Y". [ACLARACIÓN] La muestra dispara esta advertencia (30 comprimidos, una toma cada 12 h = 15 días, receta dice 30).

### Separación de nombres

- 2 palabras → la última es el apellido.
- 3 o más → mejor esfuerzo (última palabra como apellido) y la vista previa **exige confirmación** del usuario.
- En las tablas y listados, los **pacientes** se muestran siempre como `nombre apellido`. Así, aunque la separación sea incorrecta, el nombre completo se lee igual.

## Pieza 4 — Match

Normalización: minúsculas, NFD, sin diacríticos, espacios colapsados, trim. Comparación **exacta** sobre el normalizado; sin fuzzy.

| Entidad | Orden de búsqueda | Si no hay match |
|---|---|---|
| Paciente | CUIL; si no, DNI. Incluye dados de baja. | Alta nueva al confirmar. Si el match está dado de baja → advertencia; el usuario decide (no se reactiva solo). |
| Médico | (`jurisdiccion`, `matricula`) entre vigentes. | Alta nueva al confirmar. |
| Droga | `droga_alias.aliasNormalizado`, luego `droga.nombre` normalizado. Solo vigentes. | El usuario elige la droga en la vista previa; opción "recordar esta equivalencia" crea el alias. |
| Unidad | `simbolo` / `codigo` normalizado (`mg` → MILIGRAMO). | Advertencia; el usuario elige. |

Paciente o médico **existente**: se completan solo los campos vacíos con datos del PDF; nunca se pisa un valor existente. Si hay diferencias (ej. otro teléfono) → advertencia informativa.

Receta ya importada (mismo `emisor` + `nroRecetaEmisor`, no ANULADA) → error "Esta receta ya fue cargada (receta interna N°…)" antes de mostrar la vista previa.

## Confirmación — comando `recetas.importar`

Una transacción, permiso `recetas.crear`:

1. Alta de paciente y/o médico nuevos, o completado de campos vacíos de los existentes.
2. Alta de la receta con `origen = DIGITAL_PDF`, `emisor`, `nroRecetaEmisor`, `urlVerificacion`, diagnóstico e ítems. Se aplican las mismas validaciones V1–V9 que en la carga manual.
3. Alta de los alias de drogas marcados para recordar.
4. Auditoría: una entrada por cada alta o modificación (paciente, médico, receta, alias), según INV-A01.

## Permisos

`recetas.crear` habilita el alta de pacientes y médicos **dentro del flujo de recetas**: tanto la importación como el alta rápida existente de los pickers. No habilita editar ni dar de baja (eso sigue en `pacientes.gestionar` / `medicos.gestionar`).

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

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid | |
| `droga_id` | uuid | FK compuesta con tenant. |
| `alias_normalizado` | text | UNIQUE `(tenant_id, alias_normalizado)`. |
| `creado_por_id` | uuid | |
| `creado_en` | timestamptz | default `now()`. |

**Dominio**: `validarOrigenHabilitado` habilita `DIGITAL_PDF`; `DIGITAL_FOTO` sigue rechazado. La carga manual también puede completar diagnóstico, posología y duración.

## Casos de prueba

- **P1 — Muestra RCTA (datos sintéticos equivalentes).** Emisor `RCTA`; nro receta y URL presentes; paciente 2 palabras (separación sin confirmación); médico `PROVINCIAL`; 6 componentes `POR_DOSIS` (incluye `0,3 mg` → 0.3 y `1,6 mg` → 1.6); `COMPRIMIDO` × 30; fracción 0.5; posología `Media dosis cada 12 horas`; duración 30; diagnóstico `E66.0`; renglón `- …` ignorado; advertencia de consistencia (15 vs 30 días).
- **P2** — PDF sin link ni registro reconocible → "formato no reconocido".
- **P3** — Renglón no clasificable en el cuerpo → advertencia con el texto literal.
- **P4** — Sin número de receta del emisor → no importable.
- **P5** — Paciente de 3+ palabras → requiere confirmación.
- **P6** — Receta ya importada → error con el número interno existente; si la anterior está ANULADA, se permite.
- **P7** — Droga con alias guardado matchea; sin alias y con acento distinto matchea por normalización; con error ortográfico no matchea.
- **P8** — Frontera: archivo vacío, > 1 MB, tipo incorrecto, `.exe` renombrado a `.pdf` (sin firma `%PDF-`).
- **P9** — Paciente existente con fecha de nacimiento vacía → se completa; teléfono distinto → no se pisa, advertencia.
- **P10** — Receta `DIGITAL_PDF` ENTREGADA no aparece como elegible para lote de archivo.

Los fixtures del parser se arman a mano con datos **ficticios**. El PDF real contiene datos personales de un paciente y **no** se versiona.

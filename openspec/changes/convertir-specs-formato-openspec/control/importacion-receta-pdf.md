# Control table: importacion-receta-pdf

Original: `git show b110c3a:openspec/specs/importacion-receta-pdf/spec.md`.

Spanish kept throughout; only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The title drops its
"SPEC — " prefix. The original has no rule IDs: requirements carry no number, except the "Pieza 1–3" names the
original uses. The test cases P1–P10 keep their IDs as scenario names (P6 has two scenarios: "Receta ya importada" and
"Anterior anulada"). The parsing tables (Detección de emisor, Campos del encabezado, Cuerpo `Rp./`, Match) stay verbatim
in reference sections after Requirements, named from the requirements that cite them; every row is covered by a
requirement. The sections the task marks as decisions or scope (Alcance, Lectura por RCTA, Domicilio del paciente,
Archivo físico) are kept verbatim too, as are Arquitectura and Cambios de esquema.

Numbers computed by the converter (all in **derived** scenarios): tolerance 6 = `max(2, 10 × 0.6)` (Renglones,
`medianaAltura` 10); consistency warning "10 días" = 30 unidades / (24 / 8 = 3 tomas por día), against 30 días. Every
other number comes from the original (P1, the sample, 300, 1 MB, 1024, AES-128, 0.5, 60).

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Fuente / [ACLARACIÓN] blockquote | `## Purpose` (verbatim) | — | One "what it is for" sentence added. |
| Alcance ¶1 | "Vista previa sin guardar", "Alta en una sola transacción al confirmar" | "Leer un PDF y no confirmar", "Confirmar con paciente y médico nuevos" (direct) | `## Alcance` kept verbatim. |
| Alcance ¶2 (PDF no se almacena) | "El PDF no se almacena" | "Después de la lectura" (direct) | — |
| Alcance ¶3 (QR, rótulo) | "Vista previa compartida con el QR y rótulo del origen" | "Rótulo del origen" (direct) | — |
| Alcance: Fuera de alcance | `## Alcance` (verbatim) | — | `DIGITAL_FOTO` also in "Origen DIGITAL_PDF habilitado". |
| Lectura por RCTA: decisión | "Datos de la receta desde RCTA" | "PDF y QR de la misma receta" (direct) | `## Lectura por RCTA` kept verbatim. |
| Lectura por RCTA: step 1 | `## Lectura por RCTA` | — | "sin cambios": Pieza 1 and 3 requirements apply. |
| Lectura por RCTA: step 2 | "Hash del link del PDF" | "PDF con el link de RCTA" (direct) | — |
| Lectura por RCTA: step 3 | "Consulta a RCTA con el hash del PDF" | "Consulta durante la lectura" (direct) | — |
| Lectura por RCTA: step 4 + "el parser queda como está" | "Solo el nombre del paciente sale del texto del PDF" | two (direct) | "y sus tests siguen cubriendo el formato del PDF" stays in the verbatim section. |
| Lectura por RCTA: step 5 | "Error sin RCTA" | "PDF sin link de RCTA", "RCTA no responde" (direct) | — |
| Lectura por RCTA: válida desde | "Válida desde no anterior a la prescripción" | "Válida desde anterior" (direct) | — |
| Arquitectura: Pieza 1 | "Pieza 1 — Extracción" | "Extraer un PDF" (direct) | Table kept verbatim. |
| Arquitectura: Pieza 2 + closing fixtures sentence | "Pieza 2 — Parser puro" | P1 (direct, every element) | — |
| Pieza 3 steps 1–6 | "Pieza 3 — Orden obligatorio de la frontera de confianza" | P8 (direct); "Archivo de más de 1 MB" (direct) | Numbered list written inline, same order. |
| Pieza 3: PDF cifrado | "PDF cifrado" | two (direct) | — |
| Pieza 3: DP-24, lectura no se audita | "Datos personales de la lectura (DP-24)" | "Leer sin confirmar" (direct) | — |
| Renglones | "Renglones visuales" | "Dos items a la misma altura" (**derived**, computed 6) | — |
| Detección de emisor ¶ + table | "Detección de emisor" + `## Detección de emisor` (table) | "Link de RCTA" (direct) | "no se detecta por texto" applies to the logo: "el logo SHALL NOT detectarse por texto". |
| Emisor desconocido | "Emisor desconocido" | P2 (direct) | See conflicts. |
| Campos del encabezado table | "Campos del encabezado (RCTA)" + reference table | "Encabezado completo" (**derived**: example dates), "Link de verificación ausente" (direct) | — |
| Row: número del código de barras | "Número de receta del emisor obligatorio" | P4 (direct) | — |
| Row: N° Credencial (cobertura y plan) | "Cobertura y plan ignorados" | "Credencial con cobertura" (direct) | — |
| Rows: médico, especialidad, matrícula, pie | "Datos del médico del encabezado" | "Matrícula provincial", "Matrícula nacional" (**derived**: example number) | Name rows → "Separación de nombres". |
| Row: diagnóstico | "Diagnóstico del encabezado" | "Diagnóstico de la muestra" (direct, E66.0 from P1) | — |
| Row: primer renglón `- ` | "Domicilio en el cuerpo Rp./" | — | — |
| Cuerpo `Rp./` intro (first matching rule) | "Clasificación de los renglones del cuerpo Rp./" | "Renglón que matchea dos reglas" (**derived**) | Table kept verbatim in `## Cuerpo Rp./`. |
| Cuerpo row: Domicilio | "Domicilio en el cuerpo Rp./" | "Primer renglón con guion" (direct, the original example), "Renglón con guion más abajo" (direct) | — |
| Cuerpo row: Componente | "Renglón componente" | "Cantidad con coma decimal" (direct, from P1) | Pattern in inline code, unescaped pipes. |
| Cuerpo row: Presentación | "Renglón presentación" | "Orden inverso" (direct) | — |
| Cuerpo row: Fracción | "Renglón fracción de dosis" | "Media dosis" (direct) | — |
| Cuerpo row: Posología | "Renglón posología" | "Cada 8 horas" (**derived**: example line) | — |
| Cuerpo row: Duración | "Renglón duración" | "Duración con texto a continuación" (direct) | — |
| Cuerpo row: Otro | "Renglón no clasificable" | P3 (direct) | — |
| Reglas del ítem bullets 1–2 | "Dosis completa y fracción por defecto" | "Sin fracción" (direct) | — |
| Reglas del ítem: Unidades a elaborar | "Unidades a elaborar" | "30 comprimidos a media dosis" (direct) | — |
| Reglas del ítem: fracción y posología | "Renglón de fracción y posología" | (direct) | — |
| Reglas del ítem: un ítem por receta | "Un ítem por receta RCTA" | "Señales de dos ítems" (direct) | — |
| Control de consistencia | "Control de consistencia" | "La muestra no la dispara" (direct); "Unidades que no alcanzan" (**derived**, computed 10) | — |
| Domicilio del paciente: decisión + bullet 1 | "Domicilio del paciente por receta" | "Match con domicilio distinto" (**derived**) | Section kept verbatim. |
| Domicilio bullet 2 | "Formato del domicilio del paciente" | "Domicilio de más de 300 caracteres" (direct) | — |
| Domicilio bullet 3 (forms, display) | "Domicilio del paciente en los formularios" | "Borrar el domicilio precargado" (**derived**) | — |
| Domicilio bullet 3 (excepción E4) | "Excepción al registrar un envío" | "Envío de una receta PREPARADA sin domicilio" (direct) | Stale, see below. |
| Domicilio bullet 4 (QR) | "Domicilio desde el QR" | "Primer renglón sin guion" (direct, example from the QR spec) | — |
| Separación de nombres bullets 1–2 | "Separación de nombres" | "Dos palabras" (**derived**: example name); P5 (direct) | — |
| Separación de nombres bullet 3 | "Pacientes como nombre apellido en los listados" | "Separación incorrecta" (**derived**: example name) | — |
| Match: normalización | "Normalización del match" | P7 (direct); "Puntuación final" (direct) | — |
| Match table rows | "Match de paciente", "Match de médico", "Match de droga", "Droga sin match", "Match de unidad" + `## Match` (table) | one each (direct) | — |
| Paciente o médico existente | "Paciente o médico existente" | P9 (direct) | The warning is shown in the vista previa; filling the empty field happens on confirm. |
| Paciente nuevo (teléfono) | "Teléfono del paciente nuevo" | "Paciente nuevo" (direct) | — |
| Receta ya importada | "Receta ya importada" | P6 ×2 (direct) | — |
| Confirmación steps 1–3 | "Confirmación — comando recetas.importar" | "Ítem inválido" (**derived**) | — |
| Confirmación step 4 (auditoría, contexto) | "Auditoría de la confirmación" | "Confirmar con paciente nuevo" (**derived**) | — |
| Confirmación step 4 (`fuente` sin valor de autorización) | "fuente sin valor de autorización" | "fuente alterada" (**derived**) | — |
| Permisos | "Permisos de alta dentro del flujo de recetas" | "Usuario solo con recetas.crear" (**derived**) | — |
| Archivo físico: decisión | "Sin atributo de receta física recibida" | "Alta de una receta" (**derived**) | Section kept verbatim. |
| Archivo físico: DIGITAL_PDF excluded | "Recetas DIGITAL_PDF fuera del archivo físico" | P10 (direct) | — |
| Esquema `receta` table + CHECK bullet | "Columnas de la receta importada" | "Emisor sin número" (direct); "Código no CIE-10" (**derived**: `E660` against the regex) | `## Cambios de esquema` kept verbatim. |
| Esquema: `receta_adjunto_digital_check` | "Adjunto de una receta digital" | (**derived**) | — |
| Esquema: índice único parcial | "Unicidad de la receta importada" | "Reimportar una receta anulada" (direct) | — |
| Esquema `item_receta` + Dominio sentence 2 | "Posología y duración del ítem" | "Duración cero" (direct) | — |
| Esquema `medico` | "Jurisdicción de la matrícula del médico" | "Misma matrícula en dos jurisdicciones" (**derived**) | — |
| Esquema `droga_alias` | `## Cambios de esquema` (verbatim) | — | Historical design of 0049, superseded by `sinonimos-droga` (the original says so); no requirement. |
| Dominio sentence 1 | "Origen DIGITAL_PDF habilitado" | "Origen DIGITAL_FOTO" (direct) | — |
| Migración 0070 | "Migración 0070 — domicilio de la receta" | "Edición del domicilio" (**derived**) | Rollback stays in the verbatim section. |
| Casos de prueba P1–P10 + fixtures sentence | scenarios P1–P10; fixtures in "Pieza 2 — Parser puro" | — | No separate test-case section (precedent: reglas-precio). |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. 65 requirements, 77
scenarios, 20 derived.

## Conflicts and stale points (kept as written)

- **Excepción E4 (Domicilio del paciente, bullet 3)** says `registrarEntrega` saves the domicilio del paciente on an
  envío. Since 0099 (`domicilios` D6) the envío modal writes `receta.domicilio_entrega` and never touches
  `domicilio_paciente`; code agrees with D6 (`actualizarDomicilioReceta` in
  `modules/entregas/infrastructure/entrega-repository.ts` writes `domicilioEntrega`).
- **Lectura por RCTA vs the parser rules.** Since 2026-10-23 the PDF's data comes from RCTA; the parser only gives
  the patient name. So the header/body parsing rules, P1, P2 and the "Domicilio en el cuerpo Rp./" rule describe the
  parser (still tested), not what the vista previa shows. A PDF without an RCTA link fails with
  `MENSAJES_LECTURA_PDF.SIN_LINK` (`modules/recetas/application/leer-receta-pdf.ts:167`), not "formato de receta no
  reconocido"; the domicilio comes from the RCTA JSON with the QR rule (with or without guion).
- The PDF path also applies `acotarAvisos` (`leer-receta-pdf.ts:176`); recorded in the `importacion-receta-qr` control
  table, whose text says the cap runs only on the QR path.

`openspec validate importacion-receta-pdf --type spec --strict`: valid (CLI 1.14.1); CLI text check: OK.

## Review (2026-10-26)

Independent review: APPROVE with fixes. Fixed: "Detección de emisor" said the emisor is not detected by text (contradicting the table); it now says the logo is not. P9's WHEN is now the reading (the warning belongs to the vista previa) and the completion happens on confirm. Counts unchanged: 65 requirements, 77 scenarios, 20 derived.

Pre-existing, kept as written: `importacion-receta-qr` › Límites de los avisos says "el tope solo corre en el camino del QR", contradicting `modules/recetas/application/leer-receta-pdf.ts:176` (`acotarAvisos` on the PDF path too).

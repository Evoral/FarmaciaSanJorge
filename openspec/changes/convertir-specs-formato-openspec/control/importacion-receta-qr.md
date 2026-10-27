# Control table: importacion-receta-qr

Original: `git show b110c3a:openspec/specs/importacion-receta-qr/spec.md`.

Spanish kept throughout; only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The title drops its
"SPEC — " prefix. The original has no rule IDs except P17 (host restriction) and P44 (renglones iniciales), which keep
them (P44 split in two). Every test case keeps its ID or range as a scenario name (P11–P14 … P73; P62 (a)–(d) as four
extra scenarios); P46–P51 has one summary scenario plus one per item. Rules over 500 characters or holding several
behaviors were split into named requirements without a number. The `## Casos de prueba` section is kept verbatim after
Requirements because it records which cases are automated (and in which test file) and which are manual; that is
non-normative.

Numbers computed by the converter (all in **derived** scenarios): 2049 characters (2048 + 1); a 300-character renglón
cut to its first 200 + "…"; 60 + 1 = 61 avisos → 49 chosen + `AVISOS_OMITIDOS` = 50 shown.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Header blockquote (continúa PDF, numbering from P11; reuses preview and command) | `## Purpose` (verbatim) | — | One "what it is for" sentence added. |
| Alcance ¶1 | "Panel Importar con QR", "Nada se guarda hasta confirmar" | "Escanear con el lector USB" (direct); P52–P53 (direct) | `## Alcance` kept verbatim. |
| Alcance ¶2 | "Una sola importación activa" | "Leer otra receta", P54 (direct) | — |
| Alcance ¶3 (cámara, otros emisores) | `## Alcance` (verbatim) | — | Cámara covered by the camera requirements. |
| Flujo 1 | "Flujo — permiso antes de la consulta" | "Sin permiso no se consulta" (direct) | — |
| Flujo 2 | "Flujo — extracción antes de la consulta" | "Código inválido no se consulta" (direct) | — |
| Flujo 3–4 | "Flujo — consulta fuera de toda transacción" | "Ninguna transacción abierta" (direct) | — |
| Flujo 5 | "Flujo — match y duplicado después de la consulta" | "Receta ya cargada", "Anterior anulada", P46–P51 (direct) | — |
| Flujo 6 | "Flujo — confirmación igual que el PDF" | P73, "Receta vencida" (direct) | — |
| Flujo: solo POST | "Texto escaneado solo por POST" | "Leer un código" (direct) | — |
| Extracción ¶ (64 hex, case-insensitive, same hash) | "Forma del hash" | "Bloq Mayús invertido" (direct) | — |
| Extracción ¶ (decrypter distinguishes case, canonical) | "Forma canónica en MAYÚSCULAS" | P11–P14 (direct) | — |
| Extracción ¶ (adapter, link) | "Adaptador y link en MAYÚSCULAS" | "Hash en minúsculas al adaptador" (direct) | — |
| Extracción ¶ (text forms) | "Formas del texto escaneado" | "Link deformado" (direct) | — |
| Bullet: invalid texts | "Texto sin un hash válido" | P15–P16 (direct) | — |
| Bullet: P17 | "Restricción de host (P17)" | P17 ×2 (direct) | — |
| Bullet: 2048 | "Largo máximo del texto" | "Texto de más de 2048 caracteres" (**derived**, computed 2049) | — |
| Consulta ¶ (endpoint, GET, 8 s, 64 KiB) | "Endpoint constante de RCTA" | "Consulta" (direct) | — |
| Consulta ¶ (no logs) | "Nada de la consulta en logs" | P64–P66 (direct) | — |
| Response table, 4 rows | "Respuesta válida", "QR no válido según la respuesta", "RCTA no disponible", "Formato inesperado" + `## Respuestas de RCTA` (verbatim) | one each (direct); P18–P26 | — |
| ¶ 404 without body = outage | "Por qué un 404 sin cuerpo es una caída" | "403 por bloqueo" (direct) | — |
| ¶ Recipe does not exists only with JSON content-type | "Recipe does not exists solo con content-type JSON" | P18–P26 (direct, every element); "Mismo texto como HTML" (direct) | — |
| ¶ Schema | "Esquema del JSON de RCTA" | "numeroReceta numérico" (direct) | — |
| Mapeo: Identificación y fechas | "Identificación y fechas" | "Fechas" (direct) | — |
| Mapeo: Paciente | "Datos del paciente" + "El nombre del paciente nunca se lee" | three (direct) | Split. |
| Mapeo: Médico | "Datos del médico" + `## Datos del JSON de RCTA` (verbatim) | two (direct) | "Nombre y apellido vienen separados (sin confirmación)" describes the RCTA JSON: kept verbatim in the reference section, not a requirement. |
| Mapeo: Diagnóstico | "Diagnóstico" | three (direct); P27–P39 (direct) | — |
| Mapeo: Ítems | "Ítems" | "Dos elementos" (direct) | — |
| Mapeo: Datos no importados | "Datos no importados" | "Notas con texto", "Dato ausente" (direct) | — |
| Renglones: guion | "Guion inicial de lista" | "Renglón con guion" (**derived**: example line) | — |
| Renglones: Domicilio | "Domicilio del paciente desde el primer renglón", "Domicilio — deduplicación y otros renglones iniciales", "Domicilio — sin exigir el guion" | "Sin guion", "Con guion" (direct, original examples); "Otro ítem repite el domicilio" (direct); P40–P45 (direct) | Split in three. |
| Renglones: P44 | P44 "Renglones iniciales" + P44 "Renglón con unidad de dosis" | "Dirección del consultorio" (direct); "Renglón inicial con MG" (**derived**: uppercase example); "Renglón posterior" (direct) | Split. |
| Renglones: sufijo (ítem N) | "Sufijo (ítem N)" | "Aviso del segundo ítem" (**derived**: instance "(ítem 2)"); "Un solo ítem" (direct) | — |
| Límites intro | "Tope de avisos sobre la lista final" + `## Límites de los avisos` (verbatim) | "Muchas drogas sin match" (direct, from P45b) | Requirement text shortens the parentheses; the full paragraph is verbatim. Stale, see below. |
| Límites: Largo del texto citado | "Largo del texto citado" + "Corte por caracteres Unicode" | "Renglón de 300 caracteres" (**derived**, computed); "Tope aplicado dos veces", "Fragmento de 200 caracteres" (direct) | Split. |
| Límites: Tope de seguridad | "Tope de seguridad del mensaje" | "Mensaje todavía largo" (direct) | — |
| Límites: Cantidad | "Cantidad máxima de avisos" + "Aviso AVISOS_OMITIDOS" | "60 renglones … dado de baja" (**derived**, computed 50); "50 avisos" (direct); P45b (direct) | Split. |
| Panel: intro "Comportamiento del panel (verificación manual, ver P55–P57)" | `## Panel y lector USB` | — | Verbatim plus a pointer to the requirements, added by the converter. |
| Panel bullet 1 | "Lectura sin botón" | "Pegar un link", P55–P57 (direct) | — |
| Panel bullet 2 | "Foco del campo QR" + "Foco después de un error" | "Después de una lectura con éxito", "Error tardío" (direct) | Split. |
| Panel bullet 3 | "Un segundo Enter no inicia otra lectura" | "Lector que envía Enter dos veces" (direct) | — |
| Panel bullet 4 | "Región de estado del panel" + "Error como alerta" | three (direct) | Split. |
| Panel bullet 5 | "Reinicio del otro panel" | "QR después de un error del PDF" (direct) | — |
| Configuración del lector (sufijo Tab, prefijos) | `## Panel y lector USB` (verbatim) | — | Operational advice for the reader; the behavior it explains is already the hash rule. No requirement. |
| Cámara ¶ (mismo camino) | "Cámara por el mismo camino" | "QR leído con la cámara" (direct) | — |
| Cámara: HTTPS | "Cámara solo con HTTPS" + `## Cámara en desarrollo y CSP` (verbatim bullet) | P60–P61 (direct) | Tunnel advice and "en producción no hay problema" stay verbatim. |
| Cámara: lector según el navegador | "Lector según el navegador", "Fallo del lector", "Preferencias de la cámara" | P58–P59; "Detector nativo que lanza errores", "Sin contexto 2D", "Notebook sin cámara trasera" (direct) | Split in three. |
| Cámara: qué se acepta | "Qué QR se acepta" + "QR repetido" | "QR de otra cosa", "QR ajeno a la vista" (direct) | Split. |
| Cámara: permisos y errores | "Permisos y errores de la cámara" + "Reintentar y recargar" | "Permiso denegado", "Cámara en uso", "Página insegura" (direct) | Split. |
| Cámara: apagado | "Apagado de la cámara", "Cámara pausada y desconectada", "Una lectura cierra el escáner", "Foco y accesibilidad de la cámara" | P62, P62 (a)–(d) (direct) | Split in four. |
| Cámara: política de permisos | "Política de permisos de la cámara", "Navegación completa a /recetas/nuevo", "Prueba de navegación completa", "Llegada por navegación suave" | P63, "Botón Nueva receta" (direct); "Link agregado por error" (**derived**); "Llegada sin carga completa" (direct) | Split in four; the "no hace falta nada más" explanation is verbatim in `## Cámara en desarrollo y CSP`. |
| Cámara: CSP | `## Cámara en desarrollo y CSP` (verbatim) | — | Design note (no change needed in `proxy.ts`). |
| Origen y auditoría | "Origen y rótulo", "Fuente en la auditoría" | P68–P70, "Confirmar una importación por QR" (direct) | — |
| Operación: hash al portador, logging | "Sin logs de las URL ni de los argumentos" | "Leer un QR en desarrollo" (direct) | "No habilitar" written "MUST NOT habilitarse"; section kept verbatim. |
| Operación: verificaciones de despliegue (M.2) | "Verificación de despliegue (M.2)" | P67 (direct) | — |
| Operación: API no documentada, evitar códigos reales, Pendientes | `## Operación y riesgos` (verbatim) | — | Pendientes are gaps, not requirements. |
| Casos de prueba | scenarios (see above) + `## Casos de prueba` (verbatim) | P71–P72 → "Regresión del PDF" (direct) | — |
| Fixtures sentence | "Fixtures ficticios" | "Fixture de respuesta" (direct) | Also verbatim at the end of `## Casos de prueba`. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. 75 requirements, 97
scenarios, 7 derived.

## Conflicts and stale points (kept as written)

- **"La importación por PDF no cambia … el tope solo corre en el camino del QR"** (Límites de los avisos) is stale:
  since the PDF reads via RCTA (2026-10-23), `modules/recetas/application/leer-receta-pdf.ts:176` also applies
  `acotarAvisos` ("Same bound as the QR import").
- **P71–P72 "el flujo y las pruebas del PDF no cambian"** predates the same decision: the PDF flow now goes through
  RCTA (`importacion-receta-pdf` › Lectura por RCTA).
- The response table lists "200 vacío o `null`" but P18–P26 also has `{}`; code treats `{}` as "QR no válido"
  (`modules/recetas/domain/receta-rcta-json.ts:281`). Both kept as written; no code conflict.

`openspec validate importacion-receta-qr --type spec --strict`: valid (CLI 1.14.1); CLI text check: OK.

## Review (2026-10-26)

Independent review: APPROVE with fixes. Fixed: "Nombre y apellido del médico SHALL venir separados" described the RCTA JSON, not the system; moved verbatim to `## Datos del JSON de RCTA`. Counts unchanged: 75 requirements, 97 scenarios, 7 derived.

Pre-existing, kept as written: `importacion-receta-qr` › Límites de los avisos says "el tope solo corre en el camino del QR", contradicting `modules/recetas/application/leer-receta-pdf.ts:176` (`acotarAvisos` on the PDF path too).

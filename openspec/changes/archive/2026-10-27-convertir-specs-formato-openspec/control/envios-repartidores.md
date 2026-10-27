# Control table: envios-repartidores

Original: `git show b110c3a:openspec/specs/envios-repartidores/spec.md`.

Spanish kept throughout; only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The title drops its "SPEC — " prefix. Rules E1–E11 keep their IDs. Rule E4 exceeded the character limit and contained multiple distinct behaviors; it was split into three self-contained requirements carrying the same ID ("E4 — Exigencia de domicilio al registrar envío", "E4 — Carga de domicilio en receta sin domicilio previo", and "E4 — Protección de domicilio existente y rechazo en retiro presencial"), each naming its antecedent. Rules without an ID (Modelo, Permisos, Auditoría, Pantallas, PDF, Casos borde) became requirements without a number. No numbers were computed.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Estado blockquote (0093, rollbacks) + Decisiones del usuario (2026-10-20, actualizada 2026-10-23) | `## Purpose` + `## Estado` (verbatim) | — | Dated user decisions and capability purpose in `## Purpose`; blockquote kept verbatim in `## Estado`. |
| Alcance ¶1 (items 1-4) | Summary in `## Purpose` and `## Alcance` | — | Non-normative. |
| Alcance: Fuera de alcance | `## Alcance` (verbatim) | — | Non-normative reference section. |
| Modelo: fsj.repartidor (columnas, tipos, check, activo, no DELETE) | "Catálogo y atributos de repartidores" | "Alta de repartidor con datos válidos", "Desactivación de repartidor sin borrado físico" (direct) | Table kept verbatim in `## Modelo`. |
| Modelo: fsj.entrega.repartidor_id (CHECK retiro, INV-ENT-005 trigger) | "Restricciones de base de datos para repartidor en entregas" | "Cumplimiento de CHECK en retiro presencial", "Cumplimiento de INV-ENT-005 en envío nuevo" (direct) | — |
| Modelo: fsj.entrega_anulada.repartidor_id | covered under E6 | — | — |
| Modelo: Domicilio | covered under E4 | — | — |
| E1 (envío se registra con un repartidor) | E1 — Asignación obligatoria de un repartidor en envíos | "Registro exitoso de envío con repartidor", "Rechazo de envío sin repartidor" (direct) | — |
| E2 (retiro no lleva repartidor) | E2 — Prohibición de repartidor en retiros presenciales | "Registro de retiro presencial sin repartidor", "Rechazo de retiro presencial que envía repartidor" (direct) | — |
| E3 (repartidor activo del mismo tenant, desactivar no saca de existentes) | E3 — Requisito de repartidor activo del mismo tenant | "Asignación de repartidor activo del tenant" (direct); "Rechazo de repartidor inactivo para nueva asignación", "Rechazo de repartidor de otro tenant" (**derived**) | — |
| E4 ¶1 (exigencia de domicilio no vacío, no deshabilitar opción Envío) | E4 — Exigencia de domicilio al registrar envío | "Modal de entrega permite elegir Envío sin domicilio previo" (**derived**); "Envío confirmado con domicilio presente" (direct) | Split. |
| E4 ¶2 (receta sin domicilio: campo obligatorio, guardado en receta antes de entrega) | E4 — Carga de domicilio en receta sin domicilio previo | "Carga exitosa de domicilio al confirmar envío", "Rechazo por omisión de domicilio en receta sin domicilio" (direct) | Split. |
| E4 ¶3 (receta con domicilio: solo lectura, rechazo si envía domicilio, retiro rechaza) | E4 — Protección de domicilio existente y rechazo en retiro presencial | "Domicilio existente mostrado como solo lectura", "Rechazo si se envía domicilio para receta que ya lo posee" (direct); "Rechazo si se envía domicilio en retiro presencial" (**derived**) | Split. |
| E5 (cambiar repartidor solo ENVIADA_PEND_FIRMA, cumple E3, no quitar) | E5 — Cambio de repartidor en envío pendiente de firma | "Cambio exitoso de repartidor en envío pendiente de firma" (direct); "Rechazo de cambio de repartidor en receta en otro estado", "Rechazo de selección del mismo repartidor actual" (**derived**) | — |
| E6 (repartidor en entrega_anulada, re-elección al volver a entregar) | E6 — Repartidor en anulación de entrega | "Preservación de repartidor al anular entrega" (direct); "Nueva selección de repartidor tras anulación" (**derived**) | — |
| E7 (envíos anteriores sin repartidor válidos, modal, no en PDF) | E7 — Envíos históricos sin repartidor | "Visualización y asignación en envío histórico" (direct) | — |
| E8 (PDF incluye solo envíos del repartidor en ENVIADA_PEND_FIRMA) | E8 — Envíos incluidos en la hoja PDF | "Inclusión exclusiva de recetas enviadas pendientes de firma" (direct); "Exclusión de recetas con firma ya confirmada" (**derived**) | — |
| E9 (filtro fecha de envío, hoy por defecto, vacía = todos pendientes) | E9 — Filtro de fecha de envío en la hoja PDF | "Filtro por defecto en la jornada actual", "Exportación con filtro de fecha vacío" (direct) | — |
| E10 (importe en PDF solo con cotizaciones.ver) | E10 — Visualización del importe condicionado al permiso | "Emisión de PDF por usuario con permiso cotizaciones.ver" (direct); "Emisión de PDF por usuario sin permiso cotizaciones.ver" (**derived**) | — |
| E11 (URL del PDF solo repartidorId y fecha, sin datos paciente) | E11 — Parámetros en la URL del PDF | "Parámetros autorizados en la URL de descarga" (direct) | — |
| Permisos: ABM repartidores (repartidores.gestionar) | "Permiso para gestionar repartidores" | "Gestión autorizada de repartidores" (direct); "Rechazo por carecer de repartidores.gestionar" (**derived**) | Table kept verbatim in `## Permisos`. |
| Permisos: registrar y cambiar (entregas.registrar, conOperador) | "Permiso y operador para registrar o cambiar repartidor" | "Cambio de repartidor con permiso entregas.registrar" (direct); "Identificación de operador en cuenta de sector" (**derived**) | — |
| Permisos: exportar envíos PDF (entregas.registrar + cotizaciones.ver) | "Permiso para exportar hoja de envíos" | "Exportación por usuario autorizado en entregas" (direct); "Rechazo de exportación sin permiso entregas.registrar" (**derived**) | — |
| Permisos: autocompletes (entregas.registrar o repartidores.gestionar) | "Permisos para búsqueda de repartidores" | "Búsqueda autorizada para entregas", "Búsqueda autorizada para administración" (direct) | — |
| Auditoría: repartidores (CREAR/MODIFICAR) | "Auditoría en el catálogo de repartidores" | "Registro de auditoría al crear repartidor", "Registro de auditoría al cambiar estado activo" (direct) | Table kept verbatim in `## Auditoría`. |
| Auditoría: registrar envío (CAMBIAR_ESTADO suma repartidorId, MODIFICAR receta) | "Auditoría al registrar envío" | "Auditoría de entrega con repartidor", "Auditoría de nuevo domicilio en receta al enviar" (direct) | — |
| Auditoría: cambiar repartidor (MODIFICAR entrega) | "Auditoría al cambiar repartidor" | "Registro de auditoría por cambio de repartidor" (direct) | — |
| Auditoría: exportar envíos (no se audita) | `## Auditoría` (verbatim) | — | Non-normative design decision note. |
| Pantallas: Catálogos → Repartidores | "Pantalla del catálogo de repartidores" | "Visualización del listado y formulario compartido" (direct) | Section kept verbatim in `## Pantallas`. |
| Pantallas: Modal entrega (Registrar envío, Combobox, aviso sin repartidores) | "Selección de repartidor en el modal de entrega" | "Selector de repartidores activos disponible", "Aviso ante ausencia de repartidores activos", "Botón registrar deshabilitado sin domicilio", "Conservación de datos ante error de formulario" (direct) | — |
| Pantallas: Modal entrega (Pendiente de firma, cambiar/asignar) | "Visualización y cambio de repartidor en envíos pendientes" | "Detalle de envío pendiente con repartidor", "Detalle de envío pendiente histórico" (direct) | — |
| Pantallas: Listado entregas (Exportar envíos diálogo) | "Diálogo de exportación de envíos en entregas" | "Diálogo de exportación con repartidores y fecha" (direct) | — |
| PDF: formato A4 y encabezado | "Formato y encabezado de la hoja de envíos en PDF" | "Generación del encabezado en PDF" (direct) | Section kept verbatim in `## PDF "Hoja de envíos"`. |
| PDF: tabla de envíos (columnas, pago impaga destacado, importe, firma) | "Filas y columnas de la hoja de envíos en PDF" | "Formato de filas con receta impaga destacada", "Orden de los envíos en la tabla" (direct) | — |
| PDF: sin resultados y nombre archivo | "Hoja de envíos sin resultados y nombre de archivo" | "Repartidor sin envíos para la fecha", "Nombre del archivo descargado" (direct) | — |
| Casos borde: repartidor desactivado con pendientes | "Repartidor desactivado con envíos pendientes" | "Exportación de hoja de repartidor desactivado" (direct) | Section kept verbatim in `## Casos borde`. |
| Casos borde: lock concurrente | "Concurrencia en registro y cambio de repartidor" | "Intentos concurrentes de modificación de entrega" (direct) | — |
| Casos borde: datos vigentes sin congelamiento | "Datos vigentes en la generación del PDF" | "Emisión tras actualización de teléfono de repartidor" (direct) | — |
| Plan de implementación & Código que lo implementa | same-named sections (verbatim) | — | Non-normative reference sections. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. 32 requirements, 59 scenarios, 12 derived.

## Conflicts and stale points (kept as written)

- Domicilio destination: Migration 0099 (`openspec/specs/domicilios/spec.md`) updated the shipping address to `receta.domicilio_entrega` (fallback `receta.domicilio_paciente`). The text here refers to `receta.domicilio_paciente` as originally authored, with the 2026-10-23 note preserved in the header.
- Export PDF auditing: Generation of the PDF is explicitly not audited to avoid PIN operator lookup failures with `entregas.registrar` on sector accounts during GET requests.

`openspec validate envios-repartidores --type spec --strict`: valid (CLI 1.14.1); CLI text check: OK.

## Review (2026-10-26)

Independent review: APPROVE with fixes.
Fixed:
- E4: restored every element of the original ("(solo esa columna)", normalization "trim, máx. 300, vacío = no cargado", message "Ingrese el domicilio de entrega." and `ValidationError` on `domicilio`, keeping column name `domicilio_paciente` as written); deleted scenario statement "la entrega se registra vinculada a dicho domicilio" as entrega has no domicilio link.
- Modal registrar deshabilitado: restored condition "or the domicilio field is empty (receta sin domicilio)" and form preservation "se conserva el texto/selección ante error" with scenarios.
- DB scenario: corrected modalidad from `RETIRO` to `RETIRO_PRESENCIAL`.
- PDF scenario: removed "en negrita" and quoted original literal "IMPAGA — cobrar" destacado.

Pre-existing, kept as written:
- E4 address column: Migration 0099 (2026-10-23, `openspec/specs/domicilios/spec.md`) and the code write `domicilio_entrega` (audit `domicilioEntrega`), while E4 text states `receta.domicilio_paciente` (kept as written).
- PDF column Pago: original states "Pagada" o "IMPAGA — cobrar", destacado; in code (`modules/entregas/infrastructure/envios-pdf.ts`), it renders an "Impaga" badge plus "Cobrar al entregar". Now 32 requirements, 59 scenarios, 12 derived.

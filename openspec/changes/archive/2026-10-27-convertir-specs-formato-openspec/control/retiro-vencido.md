# Control table: retiro-vencido

Original: `git show b110c3a:openspec/specs/retiro-vencido/spec.md`.

Spanish kept throughout; only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The title drops its "SPEC — " prefix. Rules RV1–RV10 keep their IDs. Rules without an ID (Modelo, Alcance, Permisos, Pantallas, Casos borde) became requirements without a number. Computed numbers: RV1 day arithmetic based on tenant calendar days (prepared on 2026-10-01 with `dias_retiro_vencido` = 30 expires in the first run on 2026-10-31; 2026-10-30 does not expire).

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Estado blockquote (status, 0094-0095, rollbacks) + Decisiones del usuario (2026-10-20) | `## Purpose` + `## Estado` (verbatim) | — | Dated user decision and capability purpose in `## Purpose`; blockquote kept in `## Estado`. |
| Alcance ¶1 (items 1-5) | Summary in `## Purpose` and non-normative `## Alcance` | — | Non-normative. |
| Alcance: Fuera de alcance (stock, avisos, pagos, ENVIADA_PEND_FIRMA, vigencia) | "Fuera de alcance para envíos pendientes de firma" | "Receta en ENVIADA_PEND_FIRMA no vence por retiro" (**derived**); "Sin movimientos de stock al pasar a retiro vencido" (direct) | Non-normative notes kept in `## Alcance` verbatim. |
| Modelo: Estado nuevo (tabla transiciones, no terminal, no en curso) | "Estado RETIRO_VENCIDO y contadores de recetas en curso" + "Transiciones del estado RETIRO_VENCIDO" | "Exclusión de contadores de recetas en curso" (direct); "Inclusión tras filtrado explícito", "Transición no autorizada rechazada" (**derived**); "Transiciones autorizadas según lista blanca de INV-R08" (direct) | Table kept verbatim in `## Modelo`. |
| Modelo: fsj.receta.preparada_en (trigger al entrar a PREPARADA, backfill) | "Columna preparada_en y reinicio del reloj" | "Actualización de preparada_en al entrar a PREPARADA" (direct); "Reinicio del reloj por reactivación o anulación de entrega" (**derived**) | — |
| Modelo: Parámetro dias_retiro_vencido (0..365, default 30, 0 desactivado, seed, fallback) | "Parámetro días para el retiro" | "Parámetro dentro del rango permitido" (direct); "Desactivación con valor cero", "Fallback por parámetro inexistente" (**derived**) | — |
| RV1 (pasa a RETIRO_VENCIDO tras N jornadas desde preparada_en, N=0 desactivado) | RV1 — Vencimiento tras N días de jornada | "Receta que cumple el plazo de N jornadas" (direct); "Receta que aún no cumplió el plazo", "Tenant con parámetro en 0 (desactivado)" (**derived**) | Date arithmetic verified (2026-10-01 + 30 = 2026-10-31). |
| RV2 (job diario, multi-tenant, aísla error, idempotente) | RV2 — Ejecución periódica e idempotencia del job | "Ejecución idempotente en la misma jornada", "Aislamiento de fallos entre tenants" (direct) | — |
| RV3 (auditoría CAMBIAR_ESTADO, SISTEMA, diasRetiroVencido, preparada_en) | RV3 — Auditoría del pase a retiro vencido por el job | "Registro de auditoría CAMBIAR_ESTADO por el job" (direct) | — |
| RV4 (reactivar solo RETIRO_VENCIDO no archivada, a PREPARADA, reinicia reloj, auditoría) | RV4 — Condiciones de reactivación | "Reactivación exitosa de receta sin archivar", "Rechazo de reactivación en receta archivada" (direct); "Rechazo de reactivación en receta que no está en retiro vencido" (**derived**) | — |
| RV5 (preparado vencido exige co-firma DT vigente, sin fecha no vencido) | RV5 — Co-firma del DT por preparado vencido | "Reactivación con preparado vencido y co-firma válida", "Rechazo por co-firma con contraseña inválida" (direct); "Preparado sin fecha de vencimiento no exige co-firma", "Preparado que vence en la jornada actual no se considera vencido" (**derived**) | — |
| RV6 (auditoría co-firma, DT, vencimientos, intento fallido DT) | RV6 — Auditoría de co-firma e intentos fallidos | "Auditoría de reactivación con co-firma aprobada", "Registro de intento fallido del DT" (direct) | — |
| RV7 (archivar en lote, archivada no reactiva) | RV7 — Archivo de recetas en retiro vencido | "Inclusión de receta en retiro vencido dentro de un lote de archivo", "Bloqueo permanente de reactivación tras el archivo" (direct) | — |
| RV8 (anulación asiento libro anula receta sola, no terminal) | RV8 — Anulación automática por el libro recetario | "Anulación automática al anular asiento del libro" (direct); "Anulación manual directa de receta en retiro vencido" (**derived**) | — |
| RV9 (pago no cambia, entrega posterior exige pago) | RV9 — Preservación de la marca de pago | "Conservación de marca de pago tras vencer y reactivar", "Exigencia de pago al entregar receta reactivada" (direct) | — |
| RV10 (cambio de parámetro no retroactivo, próxima corrida, subir no reactiva) | RV10 — Aplicación diferida de cambios al parámetro | "Reducción del parámetro evaluada en la siguiente corrida", "Incremento del parámetro no reactiva recetas vencidas" (direct) | — |
| Permisos: editar parámetro (config.editar, ADMINISTRADOR) | "Permiso para editar parámetro de retiro" | "Modificación del parámetro por un usuario con permiso" (direct); "Rechazo a usuarios sin permiso config.editar" (**derived**) | Table kept verbatim in `## Permisos`. |
| Permisos: reactivar (entregas.registrar, conOperador) | "Permiso y operador para reactivar" | "Reactivación por usuario con permiso entregas.registrar" (direct); "Solicitud de operador en cuenta de sector", "Rechazo a usuarios sin permiso entregas.registrar" (**derived**) | — |
| Permisos: co-firma (DT vigente) | "Condición de DT vigente para co-firma" | "Co-firma realizada por Director Técnico vigente" (direct); "Rechazo si el usuario seleccionado no es DT vigente" (**derived**) | — |
| Permisos: job diario (CRON_SECRET, usuario SISTEMA) | "Autenticación del job diario" | "Ejecución autorizada del job con CRON_SECRET" (direct); "Rechazo de ejecución sin secreto válido" (**derived**) | — |
| Auditoría table | `## Auditoría` (verbatim) | covered under RV3, RV6, and general parameter editing | Reference section kept verbatim. |
| Pantallas: estado en toda la app (etiqueta y badge warn) | "Etiqueta y tono visual del estado" | "Presentación visual del estado y badge warn" (direct) | — |
| Pantallas: /entregas y /recetas filtros | "Filtro de estado en el listado de entregas" | "Listado por defecto sin recetas con retiro vencido", "Filtrado explícito por estado Retiro vencido" (direct) | — |
| Pantallas: modal de entrega (texto, Reactivar, aviso rojo, archivada, revalidación) | "Modal de entrega para receta en retiro vencido" | "Modal de entrega con receta sin preparados vencidos", "Modal de entrega con preparado vencido y co-firma obligatoria", "Modal de entrega con receta archivada", "Modal tras reactivación exitosa" (direct) | — |
| Pantallas: detalle de receta (panel Retiro vencido, acceso Reactivar) | "Acceso a reactivar desde el detalle de la receta" | "Panel Retiro vencido con acceso a reactivar" (direct); "Ocultamiento de la acción cuando la receta está archivada" (**derived**) | — |
| Casos borde: varios preparados con vencimientos distintos | "Múltiples preparados y vencimientos dispares" | "Receta con ítems vigentes y un ítem vencido" (direct) | Section kept verbatim in `## Casos borde`. |
| Casos borde: operador es DT vigente | "Co-firma obligatoria cuando el operador es DT vigente" | "Operador que a la vez es Director Técnico vigente" (direct) | — |
| Casos borde: job falla un día | "Recuperación ante omisión de corrida del job" | "Corrida posterior a fallo o suspensión del job" (direct) | — |
| Plan de implementación & Código que lo implementa | same-named sections (verbatim) | — | Reference implementation notes kept verbatim. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. 26 requirements, 51 scenarios, 18 derived.

## Conflicts and stale points (kept as written)

None found in the text. Verified against `modules/entregas/domain/retiro-vencido.ts`: `instanteCorteRetiroVencido` and `sumarDiasAJornada` match RV1 day-boundary math exactly. `preparadosVencidos` confirms that a prepared medication expiring today (`fechaVencimiento === jornadaActual`) is still valid today.

`openspec validate retiro-vencido --type spec --strict`: valid (CLI 1.14.1); CLI text check: OK.

## Review (2026-10-26)

Independent review: APPROVE with fixes.
Fixed:
- RV10: restored exact original meaning ("Cambiar el parámetro no SHALL recalcular nada en el momento... Bajar el valor puede vencer de golpe varias recetas en esa corrida; subirlo no SHALL reactivar las recetas que ya vencieron"); scenario "30 a 15" now states the consequence that recetas can expire in batch in that run.
- RV6: restated original wording without widening it; fixed scenario by dropping "en la auditoría del DT".
- RV3 scenario: corrected audit key name to camelCase `preparadaEn`.

Pre-existing, kept as written:
- RV6 original wording ("un intento fallido cuenta como intento fallido del DT") is loose: the codebase increments `intentos_fallidos` on the DT user record only on bad password for an active DT, while the audit record itself is emitted under the acting operator's identity as `co_firma_dt`. Now 26 requirements, 51 scenarios, 18 derived.

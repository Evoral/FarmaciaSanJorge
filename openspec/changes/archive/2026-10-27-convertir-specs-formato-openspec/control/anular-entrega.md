# Control table: anular-entrega

Original: `git show b110c3a:openspec/specs/anular-entrega/spec.md`.

Spanish kept throughout; only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The title drops its "SPEC — " prefix. Rules A1–A10 keep their IDs. Rule A9 was split into two requirements carrying the same ID ("A9 — Acción de anulación en el panel de entrega" and "A9 — Visualización del panel de anulación de receta"), each naming its antecedent. No numbers were computed.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Decisión del usuario (2026-10-17) | `## Purpose` | — | Dated user decision and capability purpose. |
| Fuera de alcance (devolución del paciente) | `## Alcance` (verbatim) | — | Non-normative note. |
| A1 (desde qué estado, vuelve a PREPARADA, aparece en /entregas) | A1 — Desde qué estado | "Anular entrega de receta ENTREGADA", "Anular entrega de receta ENVIADA_PEND_FIRMA" (direct); "Rechazo en otro estado" (**derived**) | — |
| A2 (quién, permiso entregas.registrar, conOperador, motivo obligatorio, sin re-auth/co-firma) | A2 — Permiso, operador y motivo | "Anulación exitosa con motivo" (direct); "Anulación sin motivo", "Anulación en cuenta de sector", "Usuario sin permiso" (**derived**) | — |
| A3 (cuándo se rechaza: lote archivo, ítems sin efecto) | A3 — Casos de rechazo | "Receta archivada", "Todos los ítems sin efecto en el libro" (direct) | — |
| A4 (copia a entrega_anulada, borrado de entrega, INV-ENT-004) | A4 — Preservación de la entrega y borrado condicional | "Copia a entrega anulada y borrado de la entrega vigente", "INV-ENT-004 garantía de copia previa" (direct) | — |
| A5 (orden en la transacción, lock, INV-R14) | A5 — Orden de operaciones en la transacción | "Secuencia transaccional de anulación" (direct) | — |
| A6 (pago, switch Pagada, auditoría origen, P6 pago-receta) | A6 — Ajuste del pago al anular | "Desmarcar pago al anular" (direct); "Mantener receta pagada al anular", "Receta impaga no permite marcar pagada" (**derived**) | — |
| A7 (qué no toca: libro, stock, etiquetas) | A7 — Componentes no afectados | "Invariabilidad de libro, stock y etiquetas" (direct) | — |
| A8 (auditoría ANULAR sobre entrega) | A8 — Auditoría de anulación | "Registro de auditoría ANULAR" (direct) | — |
| A9 (panel Entrega, botón anular, permisos) | A9 — Acción de anulación en el panel de entrega | "Visualización de la acción de anular entrega", "Ocultamiento ante receta archivada" (direct) | Split. |
| A9 (panel Anulación oculto y reaparición en PREPARADA) | A9 — Visualización del panel de anulación de receta | "Ocultamiento del panel de anulación con entrega vigente", "Reaparición del panel de anulación al volver a PREPARADA" (direct) | Split. |
| A10 (repartidor_id en entrega_anulada, nueva entrega, retiros) | A10 — Preservación del repartidor en entrega anulada | "Anulación de envío con repartidor asignado" (direct); "Anulación de retiro o envío histórico", "Nueva entrega tras la anulación" (**derived**) | — |
| Reglas table (Dónde) | `## Reglas` (verbatim) | — | Non-normative reference table. |
| Rollback line | `## Reversión` (verbatim) | — | Non-normative. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. 11 requirements, 24 scenarios, 8 derived.

## Conflicts and stale points (kept as written)

None found in the text. Verified against `modules/entregas/application/anular-entrega.ts`: matches `entregas.registrar`, `lockRecetaParaAccion`, and `fsj.receta_validar_transicion_estado` (0086).

`openspec validate anular-entrega --type spec --strict`: valid (CLI 1.14.1); CLI text check: OK.

## Review (2026-10-26)

Independent review: APPROVE with fixes.
Fixed:
- A8: dropped "en el contexto" to match original wording; in code `motivo` is its own audit column/field and the remaining details go in `valorAnterior`/`valorNuevo`.
- A2 scenario: removed the inferred "con PIN configurado" constraint, keeping "una sesión en una cuenta de sector" matching the rule verbatim (**derived**).

Pre-existing, kept as written: none. Now 11 requirements, 24 scenarios, 8 derived.

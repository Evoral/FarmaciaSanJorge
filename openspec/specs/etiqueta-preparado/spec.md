# Etiqueta del preparado

The printed label of a CONFIRMADA preparación is a copy of the farmacia's real
label (reference provided by the farmacia on 2026-10-19). Earlier rules
(DP-28, `openspec/specs/vencimiento-preparado/spec.md` R7, the Rp/ columns) still apply.

| # | Rule | Code |
|---|---|---|
| R1 | Layout: rounded border; top band with the tenant's own logo (`openspec/specs/logo-farmacia/spec.md` R6; none -> no logo) and, across a vertical rule, the director técnico, the domicilio and the two phones (☎ fijo, WhatsApp celular); "Rp/" with the fórmula on the left; on the right the paciente, "Receta N:", "Dosis:", the quantity as a large green number with its forma / vía / fracción de dosis, "Vence:" and the storage note in red; the médico in the footer. | `modules/preparaciones/infrastructure/etiqueta-pdf.ts` |
| R2 | Every field has a fixed place. A missing field leaves its place blank and never moves another one; a long text shrinks to fit its place (the dosis wraps up to 4 lines in its column). | same |
| R3 | The phones are the farmacia's `tenant.telefono_fijo` / `telefono_celular` (migration 0089), edited in Configuración → Farmacia. | `modules/farmacia` |
| R4 | "Dosis:" is the units to take per day, as the paciente reads it: "Media dosis cada 12 horas" with ½-dose cápsulas prints "2 cáp/día". Units per toma = doses per toma ("media dosis" = 0.5, else 1) / `fraccion_dosis_por_unidad`, times the tomas per day ("cada N horas" → 24 / N, "N veces al día" → N; `tomasPorDiaDePosologia`). When the form is not counted in units or the posología states no frequency, the posología prints as written (`dosisEtiqueta`). The fracción ("1/2 Dosis") comes from `fraccion_dosis_por_unidad` < 1, only for forms counted in units (cápsulas, comprimidos, óvulos, supositorios). | `modules/preparaciones/domain/etiqueta.ts` (`fraccionDosisEtiqueta`) |
| R5 | The paciente is printed ("Paciente:" + the asiento's paciente text). | `MOSTRAR_PACIENTE_EN_ETIQUETA` |
| R6 | The médico prints as "Médico: Nombre Apellido  -  MAT:número", without the MP/MN prefix (as on the real label). | `formatearMedicoEtiqueta` |
| R8 | The director técnico is ALWAYS the TITULAR, with the matrícula of his designación -- never a suplente (2026-10-19: the titular is in charge of everything). The titular vigente on the confirmation day; if there was none that day, the current titular. | `getDtTitularParaEtiqueta` (preparacion-repository) |
| R7 | The new fields are part of the persisted `etiqueta.contenido` snapshot (optional lines `Teléfono fijo`, `Celular`, `Dosis:`, `Por unidad:`, and `Paciente`). A snapshot stored before this change still parses: it simply prints without them. | `formatearContenidoEtiqueta`, `parsearContenidoEtiqueta` |
| R9 | A psicotrópico in "Rp/" is marked next to its name: "Clonazepam (ps) 0,3 mg" (user decision, 2026-10-22). It follows the droga's current `tipo_control` = PSICOTROPICO when the etiqueta is generated (estupefacientes are not marked); it is part of the stored `contenido`, so an etiqueta generated before keeps printing without it. | `formatearLineaRp` (`domain/etiqueta.ts`), `getPreparacionParaEtiqueta` |

Placement on the printed page (the PDF is the sheet, the label goes in a chosen cell): `openspec/specs/hoja-etiquetas/spec.md`. This spec only governs what the label says and how it is laid out.

Rollback: `docs/rollbacks/etiqueta-preparado.md`.

# Control table: pacientes-recurrentes

Original: `git show b9c8838:openspec/specs/pacientes-recurrentes/spec.md`.

The original rules have no IDs, so the requirements have none (design §1).

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status line + Rollback line | `## Status` | — | Verbatim; approval date also in `## Purpose`. |
| Goal: visibility + one-click reminder | `## Purpose` | — | Verbatim. |
| Goal: the system never sends, a person reviews and sends | "The system never sends" | "Clicking the WhatsApp button" (direct) | — |
| Routes: Todos / Recurrentes tabs, `section-tabs.tsx` `exact` | "Todos and Recurrentes tabs" | "On the Recurrentes tab" (**derived** from "exact match") | Stale, see below. |
| Routes: guard `pacientes.gestionar` | "Guard pacientes.gestionar" | "Session without pacientes.gestionar" (**derived**) | — |
| Routes: non-identifying URL params | "Nothing identifying in our URLs" | "Filtering the window" (direct) | — |
| Routes: row links to Trayectoria | "Link to the Trayectoria" | "Opening a patient's journey" (direct) | Stale, see below. |
| Detection heading (derived, no manual marking) + unit and signature | "Fórmula signature" | "Same componentes in another order", "Different cantidad" (direct) | — |
| Source rows (non-ANULADA, 12 months, vigente pacientes) | "Source rows" | "Anulada receta", "Paciente dado de baja" (direct) | — |
| Recurrente: 2+ distinct recetas (constant) | "Recurrente" | "Two recetas in the window", "One receta" (direct) | — |
| Intervalo típico (median; 2 occurrences + `duracionTratamientoDias`) | "Intervalo típico" | three scenarios (**derived**: example values chosen for the scenario) | — |
| Próxima fecha estimada | "Próxima fecha estimada" | "Monthly patient" (**derived**: example values) | — |
| Estado (ATRASADO / ESTA_SEMANA / MAS_ADELANTE) | "Estado" | "Seven days ahead", "Passed" (direct), "Eight days ahead" (**derived**) | — |
| Default filter, "todos" | "Default filter" | "Opening the view", "Todos" (direct) | — |
| Drop rule, exact formula, monthly example | "Stopped patients dropped" | "Monthly patient who stopped" (direct, the original's example) | — |
| Order, two formulas → two rows | "Order and one row per fórmula" | "Two formulas" (direct) | — |
| View columns | "View columns" | "Item with a descripcion" (direct) | — |
| WhatsApp link, new tab | "WhatsApp link" | "Opening the link" (direct) | — |
| Phone normalization (pure function, `549` + 10 digits) | "Phone normalization" | "Number with trunk and 15" (**derived**: example number) | — |
| Not normalizable → no link, "Teléfono inválido" + Datos link | "Phone that cannot be normalized" | "Phone without area code" (**derived**: the input is an "invalid on purpose" example from Implementation notes) | — |
| Message text | "Message" | "Building the message" (**derived**: example values) | — |
| Button only with consent AND valid phone; reasons | "Button only with consent and a valid phone" | "No consent", "No phone" (direct) | — |
| Consent: new column, default `false` | "Consent column" | "Patient created before the column" (direct) | — |
| Consent: editable in the form, crear/editar, audited, version check | "Consent in the paciente form" | "Recording the consent" (direct), "Stale form" (**derived**) | — |
| Consent: migration 0055, rollback | `## Database` | — | Verbatim. |
| Technical design, Implementation notes, Out of scope | same-named sections | — | Verbatim. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

## Stale rules (kept as written)

Commit 1fafdc7 (2026-10-23) renamed the section: `/pacientes/recurrentes` is now `/clientes/seguimiento`, the tabs
are "Todos | Seguimiento" (`app/(app)/clientes/clientes-tabs.tsx`, not `pacientes/pacientes-tabs.tsx`), and each
row links to `/clientes/[id]/historial` (`modules/pacientes/ui/recurrentes-tabla.tsx`). Old URLs redirect
(`next.config.ts`). The Implementation notes › UI / routing paragraph has the same stale paths.

`openspec validate pacientes-recurrentes --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-26)

Independent review (separate agent): APPROVE. All 11 derived scenarios checked against
`modules/pacientes/domain/recurrentes.ts`: every example value (median 30, duración vs gap, 2026-10-31,
ESTA_SEMANA / MAS_ADELANTE boundary, phone normalization, "Teléfono inválido", reminder text, the 91st-day drop)
matches the code; no invented threshold or message. The `/clientes/seguimiento` rename is confirmed.

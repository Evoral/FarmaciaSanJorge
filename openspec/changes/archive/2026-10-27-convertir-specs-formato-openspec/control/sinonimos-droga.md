# Control table: sinonimos-droga

Original: `git show b9c8838:openspec/specs/sinonimos-droga/spec.md`.

R1–R10 keep their IDs. The other rules have none, so their requirements have none (design §1). The original's
numbered Scenarios 1–14 became the scenarios of the rule each one illustrates.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status line (implemented 2026-10-07, 0067/0069, rollback) | `## Status` | — | Verbatim. |
| Goal + "Out of scope" | `## Purpose` | — | Verbatim. |
| R1 text / enforced in | R1 / `## Enforcement` | Scenario 2 (direct) | "Enforced in" column kept verbatim in `## Enforcement`. |
| R2 | R2 / `## Enforcement` | Scenario 4 (direct) | — |
| R3 | R3 / `## Enforcement` | "Synonym already held by another droga" (**derived**: the original has no scenario) | — |
| R4 | R4 / `## Enforcement` | Scenarios 3 and 5 (direct) | "cannot take" written "MUST NOT take". |
| R5 | R5 / `## Enforcement` | Scenario 6 (direct) | — |
| R6 | R6 / `## Enforcement` | Scenario 7 (direct) | — |
| R7 | R7 / `## Enforcement` | "Editing a droga de baja" (**derived**, from its Enforced-in text) | — |
| R8 | R8 / `## Enforcement` | "Name now held by a synonym" (**derived**) | — |
| R9 | R9 / `## Enforcement` | Scenario 1 (direct) | — |
| R10 | R10 / `## Enforcement` | Scenarios 11 and 13 (direct) | — |
| Messages list + DB codes / `ConflictError` paragraph | "Readable messages" + `## Messages` (list verbatim) | "Race past the app checks" (**derived**) | — |
| Data table | `## Data` | — | Verbatim. |
| Use cases: no own use cases, `drogas.ver`, R2 + R4 checks | "Synonyms are part of the droga form" | "Reading a droga" (**derived**) | — |
| Use cases: `crearDroga` `sinonimos` | "Synonyms on alta" | Scenario 10 split in two (direct) | — |
| Use cases: `editarDroga` (first half) | "Synonyms on edición" | "Removing a loaded synonym" (direct) | Split in two (500-character limit). |
| Use cases: `editarDroga` (second half) | "Concurrent synonyms and renaming to a synonym" | "Synonym added meanwhile", "Renaming to its own synonym" (direct) | — |
| Droga form: same form, same rows | "Same form on alta and edición" | "Opening the edición" (**derived**) | — |
| Droga form: live duplicate check | "Live duplicate check" | Scenario 9 split in two (direct) | — |
| Droga form: Otros nombres rows | "Otros nombres rows" | "Other name equal to the new name" (direct) | — |
| Imports: "recordar esta equivalencia" | "Imports remember equivalences" | Scenario 8 (direct) | — |
| Imports: lookups see vigente only | "Import lookups see vigente synonyms only" | "Synonym of a droga de baja" (**derived**) | — |
| Audit entity `droga_alias` | "Synonym audit" | "Synonym created" (direct) | — |
| Search: one rule, LIKE escaped | "One search rule" | "Query with a wildcard" (**derived**) | — |
| Search: matched synonym returned; pickers table | "Matched synonym and pickers" + `## Search pickers` (table verbatim) | "Match by synonym only" (**derived**) | — |
| Visual hint | "Visual hint" | "Name matched" (**derived**) | — |
| Nombre elegido al cargar (whole section) | `## Nombre elegido al cargar` (verbatim, cited by R9 and R10) | — | Kept whole because R9/R10 cite it by name. |
| Nombre elegido: data-entry display, drop on change | "Chosen synonym in data-entry forms" | "Clearing the field" (**derived**) | Component file names stay in the verbatim section. |
| Stored synonym: that droga, FK backstop | "Stored synonym belongs to that droga" | "Changing the droga but not the synonym" (**derived**) | — |
| Stored synonym: vigente or already stored; audit | "Stored synonym vigente or already stored" | Scenario 12 (direct) | — |
| PDF/QR import: prefill, recordar | "PDF/QR import prefill and recordar" | Scenario 14 (direct) | Details (positions sent by the client, audit order, picker wins, own-name text) stay in the verbatim section the requirement cites. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

No conflicts found. Not checked against the code beyond the format.

`openspec validate sinonimos-droga --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-26)

Independent review (separate agent): APPROVE. R1-R10 keep their meaning; all 14 original scenarios are carried
over (9 and 10 split in two). Seven scenarios re-marked as derived. Fixed: in the "Receta picked through a
synonym" scenario (original scenario 11) the field showed the synonym only after saving; it now shows it right
after the pick, as the original says.

Pre-existing, kept as written: the Search pickers row "Proveedor Trayectoria droga filter" uses the old name of
what the UI now calls Historial.

# Control table: cuit-farmacia

Original: `git show 729ec2a:openspec/specs/cuit-farmacia/spec.md`.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Intro: user decision (2026-10-24), why the CUIT is editable | `## Purpose` | — | Same text; the "User decision" mention moved to the end. |
| R1 edited from Configuración › Farmacia, same form, permiso `config.editar` | R1 | "ADM sets the CUIT during setup" (**derived**: "stored with the rest" reads "same form"); "User without the permiso" (**derived**) | "with the permiso" read as "only with"; code confirms (`permiso: "config.editar"` in `editarDatosTenantCommand`). |
| R2 only while no signed cierre diario; reason (live CUIT in the cierre PDF) | R2 | "No cierre signed yet" (direct); "A cierre is already signed" (from Enforcement › App); "Direct database update after the first cierre" (from Enforcement › DB) | Reason kept in the requirement text. Review fixes: `INV-PL-005` is the key of the invariant message (`mensajeParaInvariante`), not the literal text; the trigger fires only when the CUIT actually changes (`IS DISTINCT FROM`). |
| R3 field hidden, read-only in "Datos no editables" with the reason | R3 | "Opening the form after the first cierre" (direct) | — |
| R4 audited as `tenant` / `MODIFICAR`; `cuit` only when changed | R4 | "The CUIT changed" (direct); "The CUIT did not change" (direct) | — |
| R5 unique across tenants, refused | R5 | "CUIT of another tenant" (direct) | The original does not say which layer refuses (DB UNIQUE); the scenario does not either. |
| Enforcement (app check, migration 0105 grant + trigger, accepted race) | `## Enforcement` | — | Verbatim. |
| Code map | `## Code` | — | Verbatim. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

`openspec validate cuit-farmacia --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-25)

Independent review (separate agent): APPROVE. It checked every derived and
Enforcement-based scenario against the code (R1 permiso, R2 app + trigger, R3
form/aside, R4 audit, R5 `@unique` + `P2002` → `ConflictError`) and found two
imprecise scenarios (R2), both fixed. `## Enforcement` keeps the original
wording ("message `INV-PL-005`").

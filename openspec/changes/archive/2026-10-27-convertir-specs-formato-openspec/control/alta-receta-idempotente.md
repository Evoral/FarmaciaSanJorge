# Control table: alta-receta-idempotente

Original: `git show 22ee3f1:openspec/specs/alta-receta-idempotente/spec.md`.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status: implemented (migration 0102) | `## Status` | — | Verbatim, with the Rollback line. |
| Origin: security audit, finding P3-09 | `## Purpose` | — | Moved into Purpose. |
| Problem: lost response → duplicate receta | `## Purpose` | — | Verbatim, plus one sentence naming the capability (Purpose needs to say what it is for). |
| R1 `envioId` once per form instance, kept on error, renewed after success | R1 | "Retry after an error", "After a success" (direct) | — |
| R2 lookup by `envioId`; writes nothing, `RecetaYaRegistradaError`, success message, redirect, completes fichas | R2 | "Response lost, user saves again" (direct) | — |
| R3 partial unique index `uq_receta_envio` per tenant; concurrent submits can not both commit | R3 | "Two concurrent submits" (direct) | — |
| R4 edit never sends nor changes `envio_id`; imports NULL, dedupe by `emisor` + `nro_receta_emisor` | R4 | "Editing a receta", "Imported receta" (direct) | — |
| R5 existencia inicial needs no key; repeated lote rejected by constraints | R5 | "Repeated lote" (direct) | "needs no key" written as "MUST NOT need an idempotency key" (CLI keyword). |
| Rollback line | `## Status` | — | Verbatim. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

`openspec validate alta-receta-idempotente --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-25)

Independent review (separate agent): APPROVE. Code confirms R1-R4. Fixed: the R3
scenario said "only one of them commits" (exactly one); the original says "can not both commit" (at most
one), now restated as such.

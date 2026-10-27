# Control table: logo-farmacia

Original: `git show 22ee3f1:openspec/specs/logo-farmacia/spec.md`.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Intro: user decision 2026-10-22, revision 2026-10-23, login/favicon generic | `## Purpose` | — | Verbatim. |
| R1 upload from Configuración › Farmacia, permiso `config.editar`, replace or remove | R1 | "Upload a logo", "Replace or remove" (direct); "User without the permiso" (**derived**) | "with the permiso" read as "only with". |
| R2 generic logo without one; `nombre_fantasia` or `razon_social` under the app name | R2 | "Tenant without a logo", "Tenant name" (direct) | — |
| R3 PNG/JPEG/WebP ≤ 512 KiB; type from signature; SVG refused | R3 | "SVG upload", "File too large" (direct); "Misleading extension" (**derived**: "never from the extension" read as "a non-image named .png is refused") | — |
| R4 own tenant's logo only, `GET /api/farmacia/logo`, `Cache-Control: private` | R4 | "Two tenants" (direct) | — |
| R5 audited `tenant` / `MODIFICAR` with type, size, timestamp, never bytes | R5 | "Upload audited" (direct) | — |
| R6 etiqueta and hoja de envíos print tenant logo; PNG/JPEG only; fallbacks; no fixed file | R6 | "PNG or JPEG logo", "No logo or WebP logo" (direct) | — |
| R7 XLSX banner, footer, author = tenant name; banner logo tenant's, 56 x 56; none/WebP without it | R7 | two scenarios (direct) | — |
| Storage | `## Storage` | — | Verbatim. |
| Code + Rollback | `## Code` | — | Verbatim. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

`openspec validate logo-farmacia --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-25)

Independent review (separate agent): APPROVE. Code confirms the derived R1 and R3 scenarios.
Fixed: the R5 scenario covered removal too; `quitarLogoTenant` audits the previous type and timestamp
but no size, so the scenario now covers the upload only.

Pre-existing gap, kept as written: R5's text says a removal is audited "with type, size and timestamp";
the code records no size on removal.

# Logo de la farmacia (per tenant)

User decision (2026-10-22): when the app serves more than one farmacia, the logo at the top of the navigation
bar is each farmacia's own. Revised 2026-10-23 (security audit, part 4): `public/logo-etiqueta.png` and the XLSX
banner carried San Jorge's brand, so another farmacia would print it on its own documents. Printed documents and
exports now carry each farmacia's own logo and name (R6, R7). Login and favicon stay the generic app asset.

## Rules

- **R1** Each tenant may upload one logo from **Administración › Configuración › Farmacia** (panel "Logo"),
  with the permiso `config.editar` (same as the rest of the farmacia's data). It can be replaced or removed.
- **R2** Without a logo the navbar shows the generic `public/logo.png`. Next to the logo, the navbar shows the
  tenant's `nombre_fantasia` (or `razon_social` when there is none) under the app name.
- **R3** Accepted: PNG, JPEG, WebP, up to 512 KiB. The type is detected from the file signature, never from the
  client's type or extension. SVG is refused (it can carry script).
- **R4** Every signed-in usuario sees their own tenant's logo and never another tenant's: the image is served by
  `GET /api/farmacia/logo` for the session's tenant only, with `Cache-Control: private`.
- **R5** Uploading or removing the logo is audited (`tenant`, `MODIFICAR`) with type, size and timestamp, never the
  bytes.
- **R6** The etiqueta and the hoja de envíos print the tenant's own logo (`shared/pdf/logo.ts#logoParaPdf`, fitted
  in the same box keeping its proportion). PDFKit draws PNG and JPEG only: with no logo or a WebP one the etiqueta
  prints without it and the hoja de envíos prints the farmacia's name. No document falls back to a fixed file.
- **R7** Every XLSX export's banner, footer and file author are the tenant's name (`getMarcaTenant().nombre`,
  `XlsxReportOptions.farmacia`), and its banner logo is the tenant's own (`XlsxReportOptions.logo`, PNG or JPEG fitted
  in 56 x 56 keeping its proportion; none or WebP draws the banner without it), never a fixed brand.

## Storage

`fsj.tenant.logo` (bytea), `logo_tipo`, `logo_actualizado_en` (migration 0098). The three are all NULL or all set
(CHECK); size and type are CHECKs too. `logo_actualizado_en` versions the URL (`/api/farmacia/logo?v=<ms>`), so the
browser caches each version for good and a new logo is a new URL.

## Code

- `modules/farmacia/domain/logo.ts`: trust boundary (`validarArchivoLogo`, `detectarTipoLogo`).
- `modules/farmacia/application/`: `cambiar-logo-tenant.ts`, `quitar-logo-tenant.ts`, `get-marca-tenant.ts`
  (`getMarcaTenant` for the navbar, `getLogoTenant` for the bytes; both `auth.login`, held by every role).
- `modules/farmacia/infrastructure/tenant-repository.ts`: `getMarcaTenant`, `getLogoTenant`, `updateLogoTenant`.
- `modules/farmacia/ui/logo-tenant-form.tsx`, `modules/farmacia/ui/actions.ts`.
- `app/api/farmacia/logo/route.ts`, `app/(app)/layout.tsx`, `app/(app)/sidebar-nav.tsx` (`Brand`),
  `app/(app)/admin/configuracion/farmacia/page.tsx`.

Rollback: `docs/rollbacks/logo-farmacia.md`.

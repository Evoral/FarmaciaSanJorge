# Logo de la farmacia (per tenant)

User decision (2026-10-22): when the app serves more than one farmacia, the logo at the top of the navigation
bar is each farmacia's own. It is the ONLY per-tenant logo: every other one (login, PDFs, Excel exports, favicon)
is the generic app asset (`public/logo.png`, `public/logo-etiqueta.png`) and stays as it is.

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

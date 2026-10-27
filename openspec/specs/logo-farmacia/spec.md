# Logo de la farmacia (per tenant)

## Purpose

User decision (2026-10-22): when the app serves more than one farmacia, the logo at the top of the navigation
bar is each farmacia's own. Revised 2026-10-23 (security audit, part 4): `public/logo-etiqueta.png` and the XLSX
banner carried San Jorge's brand, so another farmacia would print it on its own documents. Printed documents and
exports now carry each farmacia's own logo and name (R6, R7). Login and favicon stay the generic app asset.

## Requirements

### Requirement: R1 — Upload, replace or remove

Each tenant SHALL be able to upload one logo from **Administración › Configuración › Farmacia** (panel "Logo"),
with the permiso `config.editar` (same as the rest of the farmacia's data). It can be replaced or removed.

#### Scenario: Upload a logo

- **GIVEN** a user with the permiso `config.editar`
- **WHEN** the user uploads a logo in the "Logo" panel
- **THEN** it becomes the tenant's logo

#### Scenario: Replace or remove

- **GIVEN** a tenant with a logo
- **WHEN** a user with `config.editar` uploads another one, or removes it
- **THEN** the new logo replaces the old one, or the tenant has no logo

#### Scenario: User without the permiso

- **GIVEN** a user without the permiso `config.editar`
- **WHEN** the user tries to upload or remove the logo
- **THEN** the change is refused

### Requirement: R2 — Navbar brand

Without a logo the navbar SHALL show the generic `public/logo.png`. The logo is shown large and centered (56px box) and, below it,
the tenant's `nombre_fantasia` (or `razon_social` when there is none). There is no app name ("Lab. Magistral" was
removed, user decision 2026-10-26).

#### Scenario: Tenant without a logo

- **GIVEN** a tenant with no logo
- **WHEN** a usuario opens the app
- **THEN** the navbar shows `public/logo.png`

#### Scenario: Tenant name

- **GIVEN** a tenant with no `nombre_fantasia`
- **WHEN** a usuario opens the app
- **THEN** the navbar shows the `razon_social` under the logo

### Requirement: R3 — Accepted files

The logo MUST be PNG, JPEG or WebP, up to 512 KiB. The type is detected from the file signature, never from the
client's type or extension. SVG is refused (it can carry script).

#### Scenario: SVG upload

- **WHEN** the user uploads an SVG
- **THEN** it is refused

#### Scenario: File too large

- **WHEN** the user uploads a PNG larger than 512 KiB
- **THEN** it is refused

#### Scenario: Misleading extension

- **GIVEN** a file named `logo.png` whose content is not PNG, JPEG or WebP
- **WHEN** the user uploads it
- **THEN** it is refused, because the type comes from the file signature

### Requirement: R4 — Each tenant sees only its own logo

Every signed-in usuario SHALL see their own tenant's logo and never another tenant's: the image is served by
`GET /api/farmacia/logo` for the session's tenant only, with `Cache-Control: private`.

#### Scenario: Two tenants

- **GIVEN** tenants A and B, each with its own logo
- **WHEN** a usuario of tenant A requests `GET /api/farmacia/logo`
- **THEN** the response is tenant A's logo with `Cache-Control: private`

### Requirement: R5 — Audited without the bytes

Uploading or removing the logo SHALL be audited (`tenant`, `MODIFICAR`) with type, size and timestamp, never the
bytes.

#### Scenario: Upload audited

- **WHEN** a logo is uploaded
- **THEN** a `tenant` / `MODIFICAR` audit record stores type, size and timestamp
- **AND** the record does not contain the image bytes

### Requirement: R6 — Printed documents carry the tenant's logo

The etiqueta and the hoja de envíos SHALL print the tenant's own logo (`shared/pdf/logo.ts#logoParaPdf`, fitted in
the same box keeping its proportion). PDFKit draws PNG and JPEG only: with no logo or a WebP one the etiqueta prints
without it and the hoja de envíos prints the farmacia's name. No document falls back to a fixed file.

#### Scenario: PNG or JPEG logo

- **GIVEN** a tenant with a PNG or JPEG logo
- **WHEN** an etiqueta or a hoja de envíos is printed
- **THEN** it carries that logo, fitted in its box keeping its proportion

#### Scenario: No logo or WebP logo

- **GIVEN** a tenant with no logo, or a WebP one
- **WHEN** an etiqueta and a hoja de envíos are printed
- **THEN** the etiqueta prints without a logo and the hoja de envíos prints the farmacia's name
- **AND** neither uses a fixed logo file

### Requirement: R7 — XLSX exports carry the tenant's brand

Every XLSX export's banner, footer and file author SHALL be the tenant's name (`getMarcaTenant().nombre`,
`XlsxReportOptions.farmacia`), and its banner logo the tenant's own (`XlsxReportOptions.logo`, PNG or JPEG fitted
in 56 x 56 keeping its proportion; none or WebP draws the banner without it), never a fixed brand.

#### Scenario: Export of a tenant with a PNG logo

- **GIVEN** a tenant with a PNG logo
- **WHEN** a usuario exports any XLSX report
- **THEN** the banner shows the tenant's logo fitted in 56 x 56 and the tenant's name
- **AND** the footer and the file author are the tenant's name

#### Scenario: Export of a tenant with no logo or a WebP logo

- **GIVEN** a tenant with no logo, or a WebP one
- **WHEN** a usuario exports any XLSX report
- **THEN** the banner is drawn without a logo, never with a fixed brand

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

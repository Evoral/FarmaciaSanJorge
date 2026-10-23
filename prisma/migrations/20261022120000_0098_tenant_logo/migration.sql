-- 0098_tenant_logo
--
-- Per-tenant logo for the navigation bar (docs/specs/logo-farmacia.md). Each farmacia uploads its own logo from
-- /admin/configuracion/farmacia; without one the app shows the generic public/logo.png. Every other logo (login,
-- PDFs, Excel exports) stays the generic app asset.
--
--   - fsj.tenant.logo: the image bytes (PNG, JPEG or WebP; SVG is refused because it can carry script).
--   - fsj.tenant.logo_tipo: its media type, detected server-side from the file signature, never from the client.
--   - fsj.tenant.logo_actualizado_en: when it was last set; the navbar uses it as the cache-busting version of the
--     image URL.
--
-- The three columns are all NULL or all set. Same column-level GRANT discipline as 0020/0089; the 0020 cross-tenant
-- trigger already guards every UPDATE of the row. fsj_app's SELECT on fsj.tenant is table-wide (0001).
--
-- Additive: old code ignores the columns.
-- Rollback: prisma/rollbacks/0098_tenant_logo.down.sql (as a NEW forward migration), docs/rollbacks/logo-farmacia.md.

ALTER TABLE fsj.tenant
  ADD COLUMN logo bytea,
  ADD COLUMN logo_tipo varchar(20),
  ADD COLUMN logo_actualizado_en timestamptz(6);

ALTER TABLE fsj.tenant
  ADD CONSTRAINT tenant_logo_completo CHECK (
    (logo IS NULL) = (logo_tipo IS NULL) AND (logo IS NULL) = (logo_actualizado_en IS NULL)
  ),
  ADD CONSTRAINT tenant_logo_tipo CHECK (logo_tipo IN ('image/png', 'image/jpeg', 'image/webp')),
  -- 512 KiB, the same limit as modules/farmacia/domain/logo.ts#MAX_LOGO_BYTES.
  ADD CONSTRAINT tenant_logo_tamano CHECK (octet_length(logo) BETWEEN 1 AND 524288);

COMMENT ON COLUMN fsj.tenant.logo IS
  'Farmacia logo shown in the navigation bar. NULL shows the generic app logo.';
COMMENT ON COLUMN fsj.tenant.logo_tipo IS
  'Media type of logo (image/png, image/jpeg or image/webp), detected from the file signature.';
COMMENT ON COLUMN fsj.tenant.logo_actualizado_en IS
  'When logo was last set: the cache-busting version of the logo URL.';

GRANT UPDATE (logo, logo_tipo, logo_actualizado_en) ON fsj.tenant TO fsj_app;

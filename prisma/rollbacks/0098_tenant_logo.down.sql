-- Rollback of 0098_tenant_logo (apply as a NEW forward migration).
-- Drops the per-tenant logo: every farmacia goes back to the generic public/logo.png in the navbar. The uploaded
-- images are lost (they live only in these columns). The code must be reverted too (docs/rollbacks/logo-farmacia.md).

REVOKE UPDATE (logo, logo_tipo, logo_actualizado_en) ON fsj.tenant FROM fsj_app;

ALTER TABLE fsj.tenant
  DROP CONSTRAINT IF EXISTS tenant_logo_completo,
  DROP CONSTRAINT IF EXISTS tenant_logo_tipo,
  DROP CONSTRAINT IF EXISTS tenant_logo_tamano;

ALTER TABLE fsj.tenant
  DROP COLUMN IF EXISTS logo,
  DROP COLUMN IF EXISTS logo_tipo,
  DROP COLUMN IF EXISTS logo_actualizado_en;

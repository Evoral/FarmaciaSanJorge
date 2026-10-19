-- Rollback of 0089_tenant_telefonos (apply as a NEW forward migration).
-- Drops the farmacia phone columns. Etiquetas already generated keep the phones in their persisted
-- etiqueta.contenido text. The code must be reverted too (farmacia form/use case, etiqueta phones).

REVOKE UPDATE (telefono_fijo, telefono_celular) ON fsj.tenant FROM fsj_app;

ALTER TABLE fsj.tenant
  DROP COLUMN IF EXISTS telefono_fijo,
  DROP COLUMN IF EXISTS telefono_celular;

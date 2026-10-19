-- 0089 -- Farmacia phone numbers on the etiqueta (docs/specs/etiqueta-preparado.md).
--
-- The printed etiqueta shows the farmacia's landline and mobile (WhatsApp)
-- numbers under the domicilio. Two nullable free-text columns on fsj.tenant,
-- editable from /admin/configuracion/farmacia like the domicilio (same
-- column-level GRANT discipline as 0020; the 0020 cross-tenant trigger
-- already guards every UPDATE of the row).
--
-- Additive: old code ignores the columns.
-- Rollback: prisma/rollbacks/0089_tenant_telefonos.down.sql (as a NEW forward migration).

ALTER TABLE fsj.tenant
  ADD COLUMN telefono_fijo varchar(40),
  ADD COLUMN telefono_celular varchar(40);

COMMENT ON COLUMN fsj.tenant.telefono_fijo IS
  'Landline printed on the etiqueta ("Teléfono fijo"). NULL leaves its line blank.';
COMMENT ON COLUMN fsj.tenant.telefono_celular IS
  'Mobile / WhatsApp number printed on the etiqueta ("Celular"). NULL leaves its line blank.';

GRANT UPDATE (telefono_fijo, telefono_celular) ON fsj.tenant TO fsj_app;

-- Rollback of 0125_tenant_estado_y_alta (apply as a NEW forward migration). Roll back 0126 first, and revert the
-- stage-2 code FIRST (docs/rollbacks/plataforma-superadmin.md): scripts/create-tenant.ts back to its own inserts,
-- modules/auth no longer reading tenant.estado, permisos.ts with the three tenants.* codes again.
-- Loses every pharmacy's estado (all become usable again: a SUSPENDIDO pharmacy is reactivated) and contacto.

DROP FUNCTION IF EXISTS fsj.plataforma_auditoria_tenant(text, uuid, integer);
DROP FUNCTION IF EXISTS fsj.plataforma_ver_tenant(text, uuid);
DROP FUNCTION IF EXISTS fsj.plataforma_listar_tenants(text, text, integer, integer);
DROP FUNCTION IF EXISTS fsj.plataforma_editar_contacto_tenant(text, uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS fsj.plataforma_cambiar_estado_tenant(text, uuid, fsj.estado_tenant, text, text, text);
DROP FUNCTION IF EXISTS fsj.plataforma_crear_tenant(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text);
DROP FUNCTION IF EXISTS fsj.crear_tenant_interno(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric);

ALTER TABLE fsj.tenant
  DROP COLUMN IF EXISTS contacto_telefono,
  DROP COLUMN IF EXISTS contacto_email,
  DROP COLUMN IF EXISTS contacto_nombre,
  DROP COLUMN IF EXISTS estado;

DROP TYPE IF EXISTS fsj.estado_tenant;

INSERT INTO fsj.permiso (codigo, categoria, descripcion)
VALUES
  ('tenants.crear',  'sistema', 'Crear farmacias (operador de plataforma, fuera de una farmacia)'),
  ('tenants.editar', 'sistema', 'Editar farmacias (operador de plataforma, fuera de una farmacia)'),
  ('tenants.baja',   'sistema', 'Dar de baja farmacias (operador de plataforma, fuera de una farmacia)')
ON CONFLICT (codigo) DO NOTHING;

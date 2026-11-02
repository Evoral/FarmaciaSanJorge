-- 0114_parametro_lector_qr_receta
--
-- User decision (2026-11-02, openspec/changes/lector-qr-configurable): the "Importar con QR" panel of
-- /recetas/nuevo has a modo del lector, CAMARA (the camera button, as before) or LECTOR (a USB scanner: no camera
-- button). The farmacia sets its default in Parámetros (`lector_qr_receta`); each equipo can override it in the
-- browser. Data only, no schema change: one parametro row per existing tenant, TEXTO, 'CAMARA' (today's behavior).
-- The row is needed because fsj_app may only UPDATE fsj.parametro (migration 0001); scripts/create-tenant.ts seeds
-- it for new tenants.
--
-- Rollback: prisma/rollbacks/0114_parametro_lector_qr_receta.down.sql.

INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT
  t.id,
  'lector_qr_receta',
  'TEXTO',
  'CAMARA',
  'Modo del lector del panel Importar con QR: CAMARA (boton de camara) o LECTOR (lector USB); cada equipo puede cambiarlo -- openspec/specs/importacion-receta-qr/spec.md'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;

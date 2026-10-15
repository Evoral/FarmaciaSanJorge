-- Rollback of 0079_costos_proveedor. Apply as a NEW forward migration,
-- AFTER deploying the code that no longer reads fsj.costo_proveedor /
-- fsj.lista_precio_proveedor (docs/rollbacks/costos-proveedor.md).
--
-- Every costo de proveedor version and every imported list header is lost
-- with the tables. Export them first (see the rollback doc). Nothing else
-- depends on them in the database: the feature never wrote to fsj.partida,
-- fsj.movimiento_stock or fsj.cotizacion (R34), and cotizacion.detalle keeps
-- its `fuente` / `costoProveedor` keys as plain JSON.

-- 3. The permiso and every role assignment of it (the role editor can have
--    granted it to custom roles of any farmacia).
DELETE FROM fsj.rol_permiso rp
USING fsj.permiso p
WHERE rp.permiso_id = p.id
  AND p.codigo = 'costos.proveedor.gestionar';

DELETE FROM fsj.permiso WHERE codigo = 'costos.proveedor.gestionar';

-- 2. costo_proveedor first (it references lista_precio_proveedor). Dropping the
--    table drops its triggers, indexes and constraints; the trigger function
--    is standalone.
DROP TABLE IF EXISTS fsj.costo_proveedor;
DROP FUNCTION IF EXISTS fsj.costo_proveedor_validar_update();

-- 1. lista_precio_proveedor.
DROP TABLE IF EXISTS fsj.lista_precio_proveedor;

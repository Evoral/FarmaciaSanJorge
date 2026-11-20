-- New permission cotizaciones.costo.ver (category 'consulta'): see the costo de insumos next to the presupuesto.
-- Not added to any predefined role: granted from the role editor
-- (ADMINISTRADOR gets it automatically, as it is not operativo -- PERMISOS_DE_ADMINISTRADOR).
--
-- Rollback: prisma/rollbacks/20261120120000_0131_permiso_costo_receta.down.sql
INSERT INTO fsj.permiso (codigo, categoria, descripcion)
VALUES ('cotizaciones.costo.ver', 'consulta', 'Ver el costo de insumos de una receta junto a su presupuesto.')
ON CONFLICT (codigo) DO NOTHING;

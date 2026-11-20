DELETE FROM fsj.rol_permiso WHERE permiso_id IN (SELECT id FROM fsj.permiso WHERE codigo = 'cotizaciones.costo.ver');
DELETE FROM fsj.permiso WHERE codigo = 'cotizaciones.costo.ver';

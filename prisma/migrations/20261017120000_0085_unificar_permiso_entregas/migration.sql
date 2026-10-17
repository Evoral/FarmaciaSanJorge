-- 0085_unificar_permiso_entregas
--
-- User decision (2026-10-17): /entregas has ONE permiso, entregas.registrar, for every step (registrar la entrega o
-- el envío, confirmar la firma recibida, marcar pagada en esos actos). entregas.firma.confirmar is removed: a role
-- holding only it could not even open /entregas (the section requires entregas.registrar).
--
-- Same approach as 0084 (libro.historico.digitalizar):
--   - every role that had entregas.firma.confirmar but not entregas.registrar GETS entregas.registrar first, so no
--     user loses the ability to confirm a firma;
--   - then the permiso goes from fsj.accion_con_pin (0077), fsj.rol_permiso and fsj.permiso;
--   - fsj.plantilla_rol_permisos() (latest definition: 0084) is redefined without the code, so a new tenant's
--     fsj.seed_roles_tenant does not fail on a code missing from the catalog.
-- Mirrored in modules/auth/domain/permisos.ts. Rollback: prisma/rollbacks/0085_unificar_permiso_entregas.down.sql.

-- ============================================================================
-- 1. Default role template without the permiso (0084's body minus entregas.firma.confirmar).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.plantilla_rol_permisos()
RETURNS TABLE (rol_codigo text, permiso_codigo text)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT m.rol_codigo, c.permiso_codigo
  FROM (VALUES
    ('DIRECTOR_TECNICO', ARRAY[
      'archivo.destruccion.gestionar', 'archivo.lotes.gestionar', 'auditoria.ver',
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cierres.firmar', 'cierres.folio.corregir', 'cierres.imprimir', 'cierres.reporte', 'cierres.ver',
      'cotizaciones.calcular', 'cotizaciones.ver',
      'drogas.baja', 'drogas.crear', 'drogas.editar', 'drogas.reactivar',
      'entregas.registrar',
      'etiquetas.generar', 'etiquetas.imprimir',
      'fichas.generar', 'fichas.imprimir',
      'libro.anulacion.autorizar', 'libro.anulacion.solicitar', 'libro.exportar', 'libro.ver',
      'libros.cerrar', 'libros.crear',
      'medicos.gestionar', 'pacientes.gestionar', 'precios.reglas.editar',
      'preparaciones.confirmar', 'preparaciones.descartar', 'preparaciones.iniciar',
      'proveedores.gestionar',
      'recetas.anular', 'recetas.crear', 'recetas.editar',
      'reportes.ver',
      'stock.ajuste.autorizar', 'stock.ajuste.registrar', 'stock.partida.costo.corregir', 'stock.partida.ingresar',
      'stock.valorizado.ver', 'stock.ver',
      'usuarios.auditoria.ver'
    ]),
    ('FARMACEUTICO', ARRAY[
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cierres.imprimir', 'cierres.reporte', 'cierres.ver',
      'cotizaciones.calcular', 'cotizaciones.ver',
      'drogas.baja', 'drogas.crear', 'drogas.editar', 'drogas.reactivar',
      'entregas.registrar',
      'etiquetas.generar', 'etiquetas.imprimir',
      'fichas.generar', 'fichas.imprimir',
      'libro.anulacion.solicitar', 'libro.exportar', 'libro.ver',
      'medicos.gestionar', 'pacientes.gestionar',
      'preparaciones.confirmar', 'preparaciones.descartar', 'preparaciones.iniciar',
      'proveedores.gestionar',
      'recetas.anular', 'recetas.crear', 'recetas.editar',
      'reportes.ver',
      'stock.ajuste.registrar', 'stock.partida.ingresar', 'stock.valorizado.ver', 'stock.ver'
    ]),
    ('LABORATORIO', ARRAY[
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cotizaciones.ver',
      'drogas.crear', 'drogas.editar',
      'etiquetas.generar', 'etiquetas.imprimir',
      'fichas.generar', 'fichas.imprimir',
      'preparaciones.confirmar', 'preparaciones.descartar', 'preparaciones.iniciar',
      'recetas.crear', 'recetas.editar',
      'stock.ajuste.registrar', 'stock.partida.ingresar', 'stock.ver'
    ]),
    ('ATENCION_PUBLICO', ARRAY[
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cotizaciones.calcular', 'cotizaciones.ver',
      'entregas.registrar',
      'medicos.gestionar', 'pacientes.gestionar',
      'recetas.crear', 'recetas.editar',
      'stock.ver'
    ]),
    ('SOLO_CONSULTA', ARRAY[
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cierres.reporte', 'cierres.ver',
      'libro.exportar', 'libro.ver',
      'reportes.ver',
      'stock.ver'
    ])
  ) AS m(rol_codigo, permisos)
  CROSS JOIN LATERAL unnest(m.permisos) AS c(permiso_codigo)
$$;

COMMENT ON FUNCTION fsj.plantilla_rol_permisos() IS
  'DP-03 (migration 0054; LABORATORIO added by 0077; libro.historico.digitalizar removed by 0084; entregas.firma.confirmar removed by 0085): the default (rol codigo, permiso codigo) pairs of a new tenant -- only the editable default roles; ADMINISTRADOR (es_administrador) and SISTEMA have none. Read by fsj.seed_roles_tenant and by tests/db/auth-permisos.test.ts.';

-- ============================================================================
-- 2. Keep access: entregas.registrar for every role that only had the firma permiso.
-- ============================================================================
INSERT INTO fsj.rol_permiso (tenant_id, rol_id, permiso_id)
SELECT rp.tenant_id, rp.rol_id, reg.id
FROM fsj.rol_permiso rp
JOIN fsj.permiso fir ON fir.id = rp.permiso_id AND fir.codigo = 'entregas.firma.confirmar'
JOIN fsj.permiso reg ON reg.codigo = 'entregas.registrar'
WHERE NOT EXISTS (
  SELECT 1 FROM fsj.rol_permiso x WHERE x.tenant_id = rp.tenant_id AND x.rol_id = rp.rol_id AND x.permiso_id = reg.id
);

-- ============================================================================
-- 3. The permiso.
-- ============================================================================
DELETE FROM fsj.accion_con_pin acp
USING fsj.permiso p
WHERE acp.permiso_id = p.id AND p.codigo = 'entregas.firma.confirmar';

DELETE FROM fsj.rol_permiso rp
USING fsj.permiso p
WHERE rp.permiso_id = p.id AND p.codigo = 'entregas.firma.confirmar';

DELETE FROM fsj.permiso WHERE codigo = 'entregas.firma.confirmar';

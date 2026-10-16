-- 0084_quitar_asiento_historico
--
-- User decision (2026-10-16): the asientos históricos (DP-17, migration 0014: entries digitized from the PHYSICAL
-- libro, for reference only) are removed from the system. Only dev data exists, so the table is dropped with its
-- rows. Same approach as 0051 (drop receta física): every object that references it is removed explicitly.
--
-- What referenced it (grep of every migration):
--   - 0014: fsj.asiento_historico itself, its RLS (fsj.setup_tenant_table), REVOKEs and
--     trg_asiento_historico_forbid_update_delete (the function fsj.forbid_update_delete is generic: kept).
--   - 0023: trg_asiento_historico_zz_inv_u07_insert (fsj.assert_actor_activo is generic: kept).
--   - 0035: CHECK asiento_historico_numero_fisico_canonico_check and UNIQUE asiento_historico_fisico_unico.
--   - 0017: a one-off DO block listing it among the legal tables (already ran; nothing to undo).
--   Everything above goes with DROP TABLE (no other table, view or function references it).
--   - Permiso libro.historico.digitalizar: fsj.permiso (0002/0054), fsj.rol_permiso of every tenant,
--     fsj.accion_con_pin (0077, only if an administrator switched it on) and the default role template
--     fsj.plantilla_rol_permisos() (latest definition: 0077) -> deleted / redefined below, so a new tenant's
--     fsj.seed_roles_tenant does not fail on a code missing from the catalog.
-- Mirrored in modules/auth/domain/permisos.ts and tests/db/auth-permisos.test.ts.

-- ============================================================================
-- 1. Default role template without the permiso (0077's body minus one code).
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
      'entregas.firma.confirmar', 'entregas.registrar',
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
      'entregas.firma.confirmar', 'entregas.registrar',
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
      'entregas.firma.confirmar', 'entregas.registrar',
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
  'DP-03 (migration 0054; LABORATORIO added by 0077; libro.historico.digitalizar removed by 0084): the default (rol codigo, permiso codigo) pairs of a new tenant -- only the editable default roles; ADMINISTRADOR (es_administrador) and SISTEMA have none. Read by fsj.seed_roles_tenant and by tests/db/auth-permisos.test.ts.';

-- ============================================================================
-- 2. The permiso.
-- ============================================================================
DELETE FROM fsj.accion_con_pin acp
USING fsj.permiso p
WHERE acp.permiso_id = p.id AND p.codigo = 'libro.historico.digitalizar';

DELETE FROM fsj.rol_permiso rp
USING fsj.permiso p
WHERE rp.permiso_id = p.id AND p.codigo = 'libro.historico.digitalizar';

DELETE FROM fsj.permiso WHERE codigo = 'libro.historico.digitalizar';

-- ============================================================================
-- 3. The table (its triggers, constraints and policies go with it).
-- ============================================================================
DROP TABLE fsj.asiento_historico;

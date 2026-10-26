-- Rollback of 0106_roles_por_defecto_minimos (apply as a NEW forward migration).
-- Restores 0085's fsj.plantilla_rol_permisos() and 0077's fsj.seed_roles_tenant, so a new tenant again starts with
-- the six default roles (plus SISTEMA). Tenants created while 0106 was live are not backfilled: add their missing
-- roles by hand, or with an INSERT like 0077's LABORATORIO backfill.

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

CREATE OR REPLACE FUNCTION fsj.seed_roles_tenant(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_desconocidos text;
BEGIN
  INSERT INTO fsj.rol (tenant_id, codigo, nombre, descripcion, es_administrador) VALUES
    (p_tenant_id, 'ADMINISTRADOR',    'Administrador',      'Gestiona la farmacia: tiene todos los permisos de consulta y gestión, incluidos los futuros. No ejerce actos operativos.', true),
    (p_tenant_id, 'DIRECTOR_TECNICO', 'Director Técnico',   'Firma cierres, autoriza ajustes y anulaciones, gestiona libros rubricados, archivo y destrucción.', false),
    (p_tenant_id, 'FARMACEUTICO',     'Farmacéutico',       'Recetas, fichas técnicas, preparaciones, stock, drogas y partidas.', false),
    (p_tenant_id, 'LABORATORIO',      'Laboratorio',        'Fichas técnicas, preparaciones, etiquetas, stock, ajustes y drogas. Pensado para el sector de elaboración.', false),
    (p_tenant_id, 'ATENCION_PUBLICO', 'Atención al público', 'Alta de recetas, pacientes, médicos, presupuestos y entregas.', false),
    (p_tenant_id, 'SOLO_CONSULTA',    'Solo consulta',      'Lectura de listados y reportes (inspector, auditor interno).', false),
    (p_tenant_id, 'SISTEMA',          'Usuario técnico del sistema', 'Rol interno del usuario técnico de la farmacia. No asignable y sin permisos propios.', false)
  ON CONFLICT (tenant_id, codigo) DO NOTHING;

  -- A template code missing from the catalog would otherwise be dropped
  -- silently by the JOIN below (e.g. after a later migration deletes a
  -- permiso without redefining fsj.plantilla_rol_permisos).
  SELECT string_agg(DISTINCT t.permiso_codigo, ', ') INTO v_desconocidos
  FROM fsj.plantilla_rol_permisos() t
  WHERE NOT EXISTS (SELECT 1 FROM fsj.permiso p WHERE p.codigo = t.permiso_codigo);
  IF v_desconocidos IS NOT NULL THEN
    RAISE EXCEPTION 'fsj.seed_roles_tenant: template references permisos missing from fsj.permiso: %', v_desconocidos;
  END IF;

  INSERT INTO fsj.rol_permiso (tenant_id, rol_id, permiso_id)
  SELECT p_tenant_id, r.id, p.id
  FROM fsj.plantilla_rol_permisos() t
  JOIN fsj.rol r ON r.tenant_id = p_tenant_id AND r.codigo = t.rol_codigo
  JOIN fsj.permiso p ON p.codigo = t.permiso_codigo
  ON CONFLICT DO NOTHING;
END;
$$;
COMMENT ON FUNCTION fsj.seed_roles_tenant(uuid) IS
  'DP-03 (migration 0054; LABORATORIO added by 0077): seeds THE default role template of a new tenant (ADMINISTRADOR locked with es_administrador, DIRECTOR_TECNICO, FARMACEUTICO, LABORATORIO, ATENCION_PUBLICO, SOLO_CONSULTA, SISTEMA). Called by trg_tenant_seed_roles (AFTER INSERT ON fsj.tenant) and by scripts/create-tenant.ts. Operator-only (EXECUTE revoked from PUBLIC).';

REVOKE EXECUTE ON FUNCTION fsj.seed_roles_tenant(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fsj.seed_roles_tenant(uuid) FROM fsj_app;

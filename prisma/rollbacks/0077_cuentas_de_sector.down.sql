-- Rollback of 0077_cuentas_de_sector. Apply as a NEW forward migration,
-- AFTER deploying the code that no longer reads usuario.es_sector nor
-- fsj.accion_con_pin (docs/rollbacks/cuentas-de-sector.md).
--
-- What is lost: which usuarios were cuentas de sector, and each farmacia's
-- "pide PIN" configuration. What is NOT lost: every act already attributed
-- to an empleado keeps its author (domain columns and registro_auditoria,
-- including contexto.terminal); PINs are untouched (migration 0037).
--
-- BEFORE applying: suspend the cuentas de sector from /admin/accesos/usuarios.
-- Once es_sector is gone they are ordinary usuarios, and anything done from
-- their sessions would be attributed to the shared account with no PIN.
-- This script refuses to run while an ACTIVO one exists.
--
-- The LABORATORIO roles stay: they are ordinary, editable roles by now
-- (possibly assigned -- INV-ROL-004). Delete them from the role editor if
-- unwanted. Only the TEMPLATE for new tenants goes back to migration 0054's.

DO $do$
DECLARE
  v_activas integer;
BEGIN
  SELECT count(*) INTO v_activas FROM fsj.usuario WHERE es_sector AND estado = 'ACTIVO';
  IF v_activas > 0 THEN
    RAISE EXCEPTION 'rollback 0077: % cuenta(s) de sector still ACTIVO -- suspend them first (docs/rollbacks/cuentas-de-sector.md)', v_activas;
  END IF;
END
$do$;

DROP TRIGGER IF EXISTS trg_tenant_seed_acciones_con_pin ON fsj.tenant;
DROP FUNCTION IF EXISTS fsj.tenant_seed_acciones_con_pin();
DROP FUNCTION IF EXISTS fsj.seed_acciones_con_pin(uuid);
DROP TABLE IF EXISTS fsj.accion_con_pin;

DROP TRIGGER IF EXISTS trg_usuario_rol_validar_sector ON fsj.usuario_rol;
DROP FUNCTION IF EXISTS fsj.usuario_rol_validar_sector();

DROP TRIGGER IF EXISTS trg_usuario_validar_es_sector ON fsj.usuario;
DROP FUNCTION IF EXISTS fsj.usuario_validar_es_sector();

ALTER TABLE fsj.usuario DROP CONSTRAINT IF EXISTS usuario_sector_no_tecnico;
ALTER TABLE fsj.usuario DROP COLUMN IF EXISTS es_sector;

-- The default role template of a NEW tenant, back to migration 0054's body.
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
      'libro.anulacion.autorizar', 'libro.anulacion.solicitar', 'libro.exportar', 'libro.historico.digitalizar', 'libro.ver',
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
  'DP-03 (migration 0054): the default (rol codigo, permiso codigo) pairs of a new tenant -- only the editable default roles; ADMINISTRADOR (es_administrador) and SISTEMA have none. Read by fsj.seed_roles_tenant and by tests/db/auth-permisos.test.ts.';

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
    (p_tenant_id, 'ATENCION_PUBLICO', 'Atención al público', 'Alta de recetas, pacientes, médicos, presupuestos y entregas.', false),
    (p_tenant_id, 'SOLO_CONSULTA',    'Solo consulta',      'Lectura de listados y reportes (inspector, auditor interno).', false),
    (p_tenant_id, 'SISTEMA',          'Usuario técnico del sistema', 'Rol interno del usuario técnico de la farmacia. No asignable y sin permisos propios.', false)
  ON CONFLICT (tenant_id, codigo) DO NOTHING;

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
  'DP-03 (migration 0054): seeds THE default role template of a new tenant (ADMINISTRADOR locked with es_administrador, DIRECTOR_TECNICO, FARMACEUTICO, ATENCION_PUBLICO, SOLO_CONSULTA, SISTEMA). Called by migration 0054''s backfill, by trg_tenant_seed_roles (AFTER INSERT ON fsj.tenant) and by scripts/create-tenant.ts. Operator-only (EXECUTE revoked from PUBLIC).';

REVOKE EXECUTE ON FUNCTION fsj.seed_roles_tenant(uuid) FROM PUBLIC;

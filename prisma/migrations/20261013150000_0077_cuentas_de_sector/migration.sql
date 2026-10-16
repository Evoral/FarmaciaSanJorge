-- 0077_cuentas_de_sector
--
-- docs/specs/cuentas-de-sector.md (user decision 2026-10-13). Several
-- empleados share ONE computer per work area (mostrador, laboratorio). Each
-- area gets a "cuenta de sector": an ordinary usuario whose session is
-- shared. For the acciones the farmacia chooses, the empleado performing the
-- act types their own PIN (the 6-digit "clave rápida" of migration 0037) and
-- the act is attributed to THEM -- domain columns and registro_auditoria --
-- instead of the shared account. The Director Técnico and every empleado
-- keep their individual accounts and sessions, unchanged.
--
-- ADDITIVE:
--   * fsj.usuario.es_sector -- marks a cuenta de sector. Set at creation,
--     immutable afterwards (INV-SEC-002; fsj_app has no UPDATE grant on the
--     column either). Never together with es_tecnico.
--   * INV-SEC-001 -- a cuenta de sector never holds ADMINISTRADOR nor
--     DIRECTOR_TECNICO. That also keeps it from ever being designated DT:
--     INV-DT-001 requires the DIRECTOR_TECNICO role at designation time.
--     (The app additionally subtracts the DT-exclusive and administration
--     permisos from its effective set, whatever its roles say --
--     modules/auth/domain/permisos.ts#PERMISOS_VEDADOS_A_SECTOR.)
--   * fsj.accion_con_pin (tenant_id, permiso_id) -- a row means "in a cuenta
--     de sector, this acción asks for the empleado's PIN". Configured per
--     farmacia from /admin/configuracion/pin (modules/operadores); read with
--     the session of a cuenta de sector. Tenant-scoped: RLS forced
--     (fsj.setup_tenant_table). fsj_app: SELECT/INSERT (default privileges,
--     migration 0000) + DELETE -- the set is replaced by delete + insert, a
--     pair has nothing to update.
--   * fsj.seed_acciones_con_pin(tenant) -- THE default set (laboratorio /
--     stock / drogas ask for the PIN; recetas, presupuestos and entregas do
--     not). Used by this backfill, by trg_tenant_seed_acciones_con_pin
--     (AFTER INSERT ON fsj.tenant) and by scripts/create-tenant.ts. Mirrors
--     modules/auth/domain/permisos.ts#PERMISOS_CON_PIN_POR_DEFECTO.
--   * New default role LABORATORIO (editable and deletable like FARMACEUTICO):
--     added to fsj.plantilla_rol_permisos / fsj.seed_roles_tenant for new
--     tenants, and backfilled into existing tenants that have no role with
--     that codigo or nombre yet. The mostrador reuses ATENCION_PUBLICO.
--     `recetas.crear` / `recetas.editar` are in it because the toma workspace
--     reads and edits the receta it prepares (its queries are guarded on
--     `recetas.crear`).
--
-- No new permiso, no new tipo_accion. registro_auditoria is untouched: the
-- shared terminal an empleado acted from goes in its `contexto` JSON.
--
-- Backfills run as the migration owner (bypasses RLS), like 0042/0054/0057.
--
-- Numbering: 0076 (20261013120000_0076_receta_entregada_pagada) is the
-- highest at the time of writing -- re-check before applying.
--
-- *** APPLY 0077 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0077_cuentas_de_sector.down.sql (as a NEW
-- forward migration) -- docs/rollbacks/cuentas-de-sector.md.
--
-- Error convention: RAISE EXCEPTION 'INV-XXX: message' USING ERRCODE = 'P0001'.

-- ============================================================================
-- 1. fsj.usuario.es_sector
-- ============================================================================
ALTER TABLE fsj.usuario ADD COLUMN IF NOT EXISTS es_sector boolean NOT NULL DEFAULT false;

ALTER TABLE fsj.usuario DROP CONSTRAINT IF EXISTS usuario_sector_no_tecnico;
ALTER TABLE fsj.usuario ADD CONSTRAINT usuario_sector_no_tecnico CHECK (NOT (es_sector AND es_tecnico));

COMMENT ON COLUMN fsj.usuario.es_sector IS
  '0077 (docs/specs/cuentas-de-sector.md). A cuenta de sector: one shared session per work area. Set at creation, immutable (INV-SEC-002). Never ADMINISTRADOR / DIRECTOR_TECNICO (INV-SEC-001). The acciones listed in fsj.accion_con_pin are attributed to the empleado who types their PIN, not to this account.';

CREATE OR REPLACE FUNCTION fsj.usuario_validar_es_sector()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.es_sector IS DISTINCT FROM OLD.es_sector THEN
    RAISE EXCEPTION 'INV-SEC-002: usuario.es_sector is immutable (usuario %)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.usuario_validar_es_sector() IS
  '0077: INV-SEC-002 -- a usuario is created as a cuenta de sector or as a person, and never changes kind (its history would otherwise change meaning).';

DROP TRIGGER IF EXISTS trg_usuario_validar_es_sector ON fsj.usuario;
CREATE TRIGGER trg_usuario_validar_es_sector
  BEFORE UPDATE OF es_sector ON fsj.usuario
  FOR EACH ROW EXECUTE FUNCTION fsj.usuario_validar_es_sector();

-- ============================================================================
-- 2. INV-SEC-001: a cuenta de sector never holds ADMINISTRADOR nor
--    DIRECTOR_TECNICO. Checked on INSERT and on any UPDATE of the
--    role/usuario columns, like INV-ROL-005 (migration 0054).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.usuario_rol_validar_sector()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fsj.usuario u
    WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.usuario_id AND u.es_sector
  ) AND EXISTS (
    SELECT 1 FROM fsj.rol r
    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.rol_id
      AND (r.es_administrador OR r.codigo = 'DIRECTOR_TECNICO')
  ) THEN
    RAISE EXCEPTION 'INV-SEC-001: a cuenta de sector cannot hold the ADMINISTRADOR or DIRECTOR_TECNICO role (usuario %)', NEW.usuario_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.usuario_rol_validar_sector() IS
  '0077: INV-SEC-001 -- a cuenta de sector (usuario.es_sector) is a shared session: it never administers the farmacia nor acts as Director Técnico.';

DROP TRIGGER IF EXISTS trg_usuario_rol_validar_sector ON fsj.usuario_rol;
CREATE TRIGGER trg_usuario_rol_validar_sector
  BEFORE INSERT OR UPDATE OF rol_id, usuario_id ON fsj.usuario_rol
  FOR EACH ROW EXECUTE FUNCTION fsj.usuario_rol_validar_sector();

-- ============================================================================
-- 3. fsj.accion_con_pin + its default set.
--    The backfill runs BEFORE RLS is switched on (step 3c), as in 0054.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.accion_con_pin (
  tenant_id  uuid NOT NULL REFERENCES fsj.tenant (id),
  permiso_id uuid NOT NULL REFERENCES fsj.permiso (id),
  PRIMARY KEY (tenant_id, permiso_id)
);

COMMENT ON TABLE fsj.accion_con_pin IS
  '0077 (docs/specs/cuentas-de-sector.md). A row = in a cuenta de sector, this acción (permiso) asks for the PIN of the empleado performing it, and is attributed to them. Per tenant; only permisos of modules/auth/domain/permisos.ts#PERMISOS_CON_PIN_CONFIGURABLES (validated by the app). Seeded by fsj.seed_acciones_con_pin. fsj_app: SELECT/INSERT/DELETE, no UPDATE.';

-- 3a. The default set.
CREATE OR REPLACE FUNCTION fsj.seed_acciones_con_pin(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_codigos text[] := ARRAY[
    'drogas.crear', 'drogas.editar', 'drogas.baja', 'drogas.reactivar',
    'stock.partida.ingresar', 'stock.ajuste.registrar',
    'fichas.generar',
    'preparaciones.iniciar', 'preparaciones.descartar', 'preparaciones.confirmar',
    'etiquetas.generar'
  ];
  v_desconocidos text;
BEGIN
  -- A code missing from the catalog would otherwise be dropped silently by the JOIN below.
  SELECT string_agg(c.codigo, ', ') INTO v_desconocidos
  FROM unnest(v_codigos) AS c(codigo)
  WHERE NOT EXISTS (SELECT 1 FROM fsj.permiso p WHERE p.codigo = c.codigo);
  IF v_desconocidos IS NOT NULL THEN
    RAISE EXCEPTION 'fsj.seed_acciones_con_pin: default set references permisos missing from fsj.permiso: %', v_desconocidos;
  END IF;

  INSERT INTO fsj.accion_con_pin (tenant_id, permiso_id)
  SELECT p_tenant_id, p.id
  FROM fsj.permiso p
  WHERE p.codigo = ANY (v_codigos)
  ON CONFLICT DO NOTHING;
END;
$$;

COMMENT ON FUNCTION fsj.seed_acciones_con_pin(uuid) IS
  '0077: seeds THE default acciones that ask an empleado''s PIN in a cuenta de sector (laboratorio / stock / drogas). Called by migration 0077''s backfill, by trg_tenant_seed_acciones_con_pin and by scripts/create-tenant.ts. Mirrors PERMISOS_CON_PIN_POR_DEFECTO (modules/auth/domain/permisos.ts). Operator-only (EXECUTE revoked from PUBLIC): re-running it would switch back on what an administrator switched off.';

REVOKE EXECUTE ON FUNCTION fsj.seed_acciones_con_pin(uuid) FROM PUBLIC;

-- 3b. Backfill: every existing tenant starts with the default set.
SELECT fsj.seed_acciones_con_pin(t.id) FROM fsj.tenant t;

-- 3c. RLS (INV-T01/INV-T03) + grants.
SELECT fsj.setup_tenant_table('fsj.accion_con_pin');

GRANT DELETE ON fsj.accion_con_pin TO fsj_app;
REVOKE UPDATE ON fsj.accion_con_pin FROM fsj_app;

-- 3d. Every NEW tenant gets the default set in the transaction that creates it.
CREATE OR REPLACE FUNCTION fsj.tenant_seed_acciones_con_pin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.seed_acciones_con_pin(NEW.id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.tenant_seed_acciones_con_pin() IS
  '0077: AFTER INSERT ON fsj.tenant -- seeds the default acciones con PIN (fsj.seed_acciones_con_pin) of the new tenant.';

DROP TRIGGER IF EXISTS trg_tenant_seed_acciones_con_pin ON fsj.tenant;
CREATE TRIGGER trg_tenant_seed_acciones_con_pin
  AFTER INSERT ON fsj.tenant
  FOR EACH ROW EXECUTE FUNCTION fsj.tenant_seed_acciones_con_pin();

-- ============================================================================
-- 4. Default role LABORATORIO.
--    fsj.plantilla_rol_permisos / fsj.seed_roles_tenant are redefined with
--    the SAME matrix as migration 0054 plus this one role (new tenants).
--    tests/db/auth-permisos.test.ts (EXPECTED_ROL_PERMISOS) mirrors it.
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
  'DP-03 (migration 0054; LABORATORIO added by 0077): the default (rol codigo, permiso codigo) pairs of a new tenant -- only the editable default roles; ADMINISTRADOR (es_administrador) and SISTEMA have none. Read by fsj.seed_roles_tenant and by tests/db/auth-permisos.test.ts.';

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

-- Backfill: existing tenants get ONLY the new role (never fsj.seed_roles_tenant:
-- it would re-create a default role an administrator deleted), and only when
-- no role of theirs already uses that codigo or that nombre. The permisos go
-- to the rows inserted HERE, never to a pre-existing role.
WITH nuevos AS (
  INSERT INTO fsj.rol (tenant_id, codigo, nombre, descripcion, es_administrador)
  SELECT t.id, 'LABORATORIO', 'Laboratorio',
         'Fichas técnicas, preparaciones, etiquetas, stock, ajustes y drogas. Pensado para el sector de elaboración.', false
  FROM fsj.tenant t
  WHERE NOT EXISTS (
    SELECT 1 FROM fsj.rol r
    WHERE r.tenant_id = t.id AND (r.codigo = 'LABORATORIO' OR lower(r.nombre) = 'laboratorio')
  )
  RETURNING tenant_id, id
)
INSERT INTO fsj.rol_permiso (tenant_id, rol_id, permiso_id)
SELECT n.tenant_id, n.id, p.id
FROM nuevos n
JOIN fsj.plantilla_rol_permisos() t ON t.rol_codigo = 'LABORATORIO'
JOIN fsj.permiso p ON p.codigo = t.permiso_codigo;

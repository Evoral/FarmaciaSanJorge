-- 0002_usuarios_roles_permisos
--
-- FASE 1, point 1.2: global role/permission catalogs (rol, permiso,
-- rol_permiso), the tenant-scoped `usuario` table + its state machine,
-- `usuario_rol` (with the deferred "at least one role" constraint trigger,
-- INV-U02) and `usuario_estado_historial`.
--
-- Depends on 0001 (fsj.tenant, fsj.setup_tenant_table, fsj.forbid_delete).

-- ============================================================================
-- Global enum: estado_usuario (DP-01 RESUELTA)
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.estado_usuario AS ENUM (
  'PENDIENTE_ACTIVACION',
  'ACTIVO',
  'SUSPENDIDO',
  'BAJA'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================================
-- rol / permiso / rol_permiso -- GLOBAL catalogs (no tenant_id), read-only
-- for fsj_app
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.rol (
  id           uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  codigo       text NOT NULL,
  nombre       text NOT NULL,
  descripcion  text,
  CONSTRAINT rol_codigo_key UNIQUE (codigo)
);

CREATE TABLE IF NOT EXISTS fsj.permiso (
  id           uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  codigo       text NOT NULL,
  descripcion  text,
  CONSTRAINT permiso_codigo_key UNIQUE (codigo)
);

CREATE TABLE IF NOT EXISTS fsj.rol_permiso (
  rol_id      uuid NOT NULL REFERENCES fsj.rol (id),
  permiso_id  uuid NOT NULL REFERENCES fsj.permiso (id),
  PRIMARY KEY (rol_id, permiso_id)
);

COMMENT ON TABLE fsj.rol IS 'Global catalog (M03, plan §6): the 5 fixed roles. Seeded below. Editable only if DP-03 resolves to "editable" -- fixed for now.';
COMMENT ON TABLE fsj.permiso IS 'Global catalog (M03, plan §7): permission codes. Seeded below from the permission matrix.';
COMMENT ON TABLE fsj.rol_permiso IS 'Global catalog (M03): role -> permission matrix. Seeded below, fixed (DP-03 pending).';

-- Global catalogs: fsj_app reads only. ALTER DEFAULT PRIVILEGES (Phase 0)
-- grants SELECT + INSERT to every new table by default; revoke the INSERT.
REVOKE INSERT ON fsj.rol, fsj.permiso, fsj.rol_permiso FROM fsj_app;

-- ---------------------------------------------------------------------------
-- Seed: the 5 assignable roles (plan §6) + 1 internal, non-assignable role.
--
-- [DEVIATION from plan §6, documented]: the plan describes `SISTEMA` as
-- "no es rol asignable" (not pickable in the usuarios.roles.modificar UI)
-- and models it purely via `usuario.es_tecnico`. But INV-U02 [BD]
-- unconditionally requires every usuario row to have >= 1 fsj.usuario_rol
-- row -- including the per-tenant SISTEMA user itself, which must exist
-- (self-created, see fsj.usuario comment) before any human user can be
-- created. Special-casing the INV-U02 trigger to skip es_tecnico users
-- would weaken a [BD] invariant for a UI-level concern. Instead, `SISTEMA`
-- gets a real (but permission-less) `rol` row here, satisfying INV-U02
-- structurally; the application layer (FASE 2/3, usuarios.roles.modificar)
-- is responsible for never offering it as a selectable option for human
-- users -- that's the actual meaning of "no asignable".
-- ---------------------------------------------------------------------------
INSERT INTO fsj.rol (codigo, nombre, descripcion) VALUES
  ('ADMINISTRADOR',    'Administrador',      'Gestiona usuarios, roles, designaciones DT, parametros, unidades de medida, reglas de precio.'),
  ('DIRECTOR_TECNICO', 'Director Tecnico',   'Firma cierres, autoriza ajustes y anulaciones, gestiona libros rubricados (tentativo), archivo y destruccion.'),
  ('FARMACEUTICO',     'Farmaceutico',       'Recetas, fichas, preparaciones, stock, drogas, partidas.'),
  ('ATENCION_PUBLICO', 'Atencion al publico', 'Alta de recetas, pacientes, medicos, cotizacion, entrega.'),
  ('SOLO_CONSULTA',    'Solo consulta',      'Lectura de listados y reportes (inspector, auditor interno).'),
  ('SISTEMA',          'Usuario tecnico del sistema', 'Rol interno, NO asignable via UI (plan §6) -- existe solo para satisfacer INV-U02 en el usuario tecnico por tenant (usuario.es_tecnico = true). Sin permisos propios: los procesos automaticos no pasan por authorize().')
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: permission catalog (plan §7 -- the modules that exist so far, plus
-- the rest of the matrix since "it's fine to seed the whole catalog").
-- Permissions granted by ownership rather than role (auth.activar: the
-- credential holder; tenants.*: the platform operator, outside any tenant)
-- are seeded here but intentionally get NO rol_permiso row below.
-- ---------------------------------------------------------------------------
INSERT INTO fsj.permiso (codigo, descripcion) VALUES
  ('auth.login',                    'Iniciar sesion'),
  ('auth.logout',                   'Cerrar sesion'),
  ('auth.password.cambiar',         'Cambiar la propia contrasena'),
  ('auth.activar',                  'Activar cuenta con credencial de un uso (por titular de la credencial, no por rol)'),
  ('usuarios.listar',               'Listar usuarios'),
  ('usuarios.ver',                  'Ver detalle de usuario'),
  ('usuarios.crear',                'Crear usuario'),
  ('usuarios.editar',               'Editar datos personales de usuario'),
  ('usuarios.roles.modificar',      'Asignar/quitar roles de usuario'),
  ('usuarios.suspender',            'Suspender usuario'),
  ('usuarios.reactivar',            'Reactivar usuario'),
  ('usuarios.baja',                 'Dar de baja usuario'),
  ('usuarios.credencial.restablecer', 'Restablecer credencial de activacion'),
  ('usuarios.auditoria.ver',        'Ver auditoria de usuarios'),
  ('dt.designar',                   'Designar Director Tecnico'),
  ('dt.cesar',                      'Cesar designacion de Director Tecnico'),
  ('roles.ver',                     'Ver catalogo de roles y permisos'),
  ('config.ver',                    'Ver datos institucionales del tenant'),
  ('config.editar',                 'Editar datos institucionales y parametros del tenant'),
  ('unidades.crear',                'Crear unidad de medida'),
  ('unidades.editar',               'Editar unidad de medida'),
  ('unidades.baja',                 'Dar de baja unidad de medida'),
  ('drogas.crear',                  'Crear droga'),
  ('drogas.editar',                 'Editar droga'),
  ('drogas.baja',                   'Dar de baja droga'),
  ('drogas.reactivar',              'Reactivar droga'),
  ('proveedores.gestionar',         'Gestionar proveedores'),
  ('medicos.gestionar',             'Gestionar medicos'),
  ('pacientes.gestionar',           'Gestionar pacientes'),
  ('precios.reglas.editar',         'Editar reglas de precio'),
  ('stock.ver',                     'Ver stock'),
  ('stock.partida.ingresar',        'Ingresar partida de stock'),
  ('stock.partida.costo.corregir',  'Corregir costo de partida'),
  ('stock.ajuste.registrar',        'Registrar ajuste de stock'),
  ('stock.ajuste.autorizar',        'Autorizar ajuste de stock'),
  ('recetas.crear',                 'Crear receta'),
  ('recetas.editar',                'Editar receta'),
  ('recetas.anular',                'Anular receta'),
  ('recetas.fisica.registrar',      'Registrar recepcion de receta fisica'),
  ('fichas.generar',                'Generar ficha tecnica'),
  ('fichas.imprimir',               'Imprimir ficha tecnica'),
  ('cotizaciones.calcular',         'Calcular cotizacion'),
  ('cotizaciones.ver',              'Ver cotizacion'),
  ('preparaciones.iniciar',         'Iniciar preparacion'),
  ('preparaciones.descartar',       'Descartar preparacion'),
  ('preparaciones.confirmar',       'Confirmar preparacion'),
  ('etiquetas.generar',             'Generar etiqueta'),
  ('etiquetas.imprimir',            'Imprimir etiqueta'),
  ('libro.ver',                     'Ver libro recetario'),
  ('libro.exportar',                'Exportar libro recetario'),
  ('libro.anulacion.solicitar',     'Solicitar anulacion de asiento'),
  ('libro.anulacion.autorizar',     'Autorizar anulacion de asiento'),
  ('libro.historico.digitalizar',   'Digitalizar libro historico'),
  ('cierres.ver',                   'Ver cierres diarios'),
  ('cierres.reporte',               'Ver reporte de cumplimiento de cierres'),
  ('cierres.firmar',                'Firmar cierre diario'),
  ('cierres.imprimir',              'Imprimir comprobante de cierre'),
  ('cierres.folio.corregir',        'Corregir folio de cierre'),
  ('libros.crear',                  'Crear libro rubricado'),
  ('libros.cerrar',                 'Cerrar libro rubricado'),
  ('tenants.crear',                 'Crear tenant (operador de plataforma, fuera de tenant)'),
  ('tenants.editar',                'Editar tenant (operador de plataforma, fuera de tenant)'),
  ('tenants.baja',                  'Dar de baja tenant (operador de plataforma, fuera de tenant)'),
  ('entregas.registrar',            'Registrar entrega'),
  ('entregas.firma.confirmar',      'Confirmar firma de entrega'),
  ('regularizacion.ver',            'Ver listado de regularizacion'),
  ('archivo.lotes.gestionar',       'Gestionar lotes de archivo'),
  ('archivo.destruccion.gestionar', 'Gestionar tramites de destruccion'),
  ('reportes.ver',                  'Ver reportes operativos'),
  ('reportes.usuarios',             'Ver reportes de usuarios'),
  ('reportes.auditoria',            'Ver reportes de auditoria'),
  ('auditoria.ver',                 'Ver registro de auditoria')
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: rol_permiso matrix (plan §7)
-- ---------------------------------------------------------------------------
INSERT INTO fsj.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM (VALUES
  ('ADMINISTRADOR', 'auth.login'), ('DIRECTOR_TECNICO', 'auth.login'), ('FARMACEUTICO', 'auth.login'), ('ATENCION_PUBLICO', 'auth.login'), ('SOLO_CONSULTA', 'auth.login'),
  ('ADMINISTRADOR', 'auth.logout'), ('DIRECTOR_TECNICO', 'auth.logout'), ('FARMACEUTICO', 'auth.logout'), ('ATENCION_PUBLICO', 'auth.logout'), ('SOLO_CONSULTA', 'auth.logout'),
  ('ADMINISTRADOR', 'auth.password.cambiar'), ('DIRECTOR_TECNICO', 'auth.password.cambiar'), ('FARMACEUTICO', 'auth.password.cambiar'), ('ATENCION_PUBLICO', 'auth.password.cambiar'), ('SOLO_CONSULTA', 'auth.password.cambiar'),
  ('ADMINISTRADOR', 'usuarios.listar'), ('ADMINISTRADOR', 'usuarios.ver'), ('ADMINISTRADOR', 'usuarios.crear'),
  ('ADMINISTRADOR', 'usuarios.editar'), ('ADMINISTRADOR', 'usuarios.roles.modificar'),
  ('ADMINISTRADOR', 'usuarios.suspender'), ('ADMINISTRADOR', 'usuarios.reactivar'), ('ADMINISTRADOR', 'usuarios.baja'),
  ('ADMINISTRADOR', 'usuarios.credencial.restablecer'),
  ('ADMINISTRADOR', 'usuarios.auditoria.ver'), ('DIRECTOR_TECNICO', 'usuarios.auditoria.ver'),
  ('ADMINISTRADOR', 'dt.designar'), ('ADMINISTRADOR', 'dt.cesar'),
  ('ADMINISTRADOR', 'roles.ver'),
  ('ADMINISTRADOR', 'config.ver'), ('DIRECTOR_TECNICO', 'config.ver'), ('FARMACEUTICO', 'config.ver'), ('ATENCION_PUBLICO', 'config.ver'), ('SOLO_CONSULTA', 'config.ver'),
  ('ADMINISTRADOR', 'config.editar'),
  ('ADMINISTRADOR', 'unidades.crear'), ('ADMINISTRADOR', 'unidades.editar'), ('ADMINISTRADOR', 'unidades.baja'),
  ('FARMACEUTICO', 'drogas.crear'), ('DIRECTOR_TECNICO', 'drogas.crear'), ('ADMINISTRADOR', 'drogas.crear'),
  ('FARMACEUTICO', 'drogas.editar'), ('DIRECTOR_TECNICO', 'drogas.editar'), ('ADMINISTRADOR', 'drogas.editar'),
  ('FARMACEUTICO', 'drogas.baja'), ('DIRECTOR_TECNICO', 'drogas.baja'), ('ADMINISTRADOR', 'drogas.baja'),
  ('FARMACEUTICO', 'drogas.reactivar'), ('DIRECTOR_TECNICO', 'drogas.reactivar'), ('ADMINISTRADOR', 'drogas.reactivar'),
  ('FARMACEUTICO', 'proveedores.gestionar'), ('DIRECTOR_TECNICO', 'proveedores.gestionar'), ('ADMINISTRADOR', 'proveedores.gestionar'),
  ('ATENCION_PUBLICO', 'medicos.gestionar'), ('FARMACEUTICO', 'medicos.gestionar'), ('DIRECTOR_TECNICO', 'medicos.gestionar'),
  ('ATENCION_PUBLICO', 'pacientes.gestionar'), ('FARMACEUTICO', 'pacientes.gestionar'), ('DIRECTOR_TECNICO', 'pacientes.gestionar'),
  ('ADMINISTRADOR', 'precios.reglas.editar'), ('DIRECTOR_TECNICO', 'precios.reglas.editar'),
  ('ADMINISTRADOR', 'stock.ver'), ('DIRECTOR_TECNICO', 'stock.ver'), ('FARMACEUTICO', 'stock.ver'), ('ATENCION_PUBLICO', 'stock.ver'), ('SOLO_CONSULTA', 'stock.ver'),
  ('FARMACEUTICO', 'stock.partida.ingresar'), ('DIRECTOR_TECNICO', 'stock.partida.ingresar'),
  ('DIRECTOR_TECNICO', 'stock.partida.costo.corregir'), ('ADMINISTRADOR', 'stock.partida.costo.corregir'),
  ('FARMACEUTICO', 'stock.ajuste.registrar'), ('DIRECTOR_TECNICO', 'stock.ajuste.registrar'),
  ('DIRECTOR_TECNICO', 'stock.ajuste.autorizar'),
  ('ATENCION_PUBLICO', 'recetas.crear'), ('FARMACEUTICO', 'recetas.crear'), ('DIRECTOR_TECNICO', 'recetas.crear'),
  ('ATENCION_PUBLICO', 'recetas.editar'), ('FARMACEUTICO', 'recetas.editar'), ('DIRECTOR_TECNICO', 'recetas.editar'),
  ('FARMACEUTICO', 'recetas.anular'), ('DIRECTOR_TECNICO', 'recetas.anular'),
  ('ATENCION_PUBLICO', 'recetas.fisica.registrar'), ('FARMACEUTICO', 'recetas.fisica.registrar'), ('DIRECTOR_TECNICO', 'recetas.fisica.registrar'),
  ('FARMACEUTICO', 'fichas.generar'), ('DIRECTOR_TECNICO', 'fichas.generar'),
  ('FARMACEUTICO', 'fichas.imprimir'), ('DIRECTOR_TECNICO', 'fichas.imprimir'),
  ('ATENCION_PUBLICO', 'cotizaciones.calcular'), ('FARMACEUTICO', 'cotizaciones.calcular'), ('DIRECTOR_TECNICO', 'cotizaciones.calcular'),
  ('ATENCION_PUBLICO', 'cotizaciones.ver'), ('FARMACEUTICO', 'cotizaciones.ver'), ('DIRECTOR_TECNICO', 'cotizaciones.ver'),
  ('FARMACEUTICO', 'preparaciones.iniciar'), ('DIRECTOR_TECNICO', 'preparaciones.iniciar'),
  ('FARMACEUTICO', 'preparaciones.descartar'), ('DIRECTOR_TECNICO', 'preparaciones.descartar'),
  ('FARMACEUTICO', 'preparaciones.confirmar'), ('DIRECTOR_TECNICO', 'preparaciones.confirmar'),
  ('FARMACEUTICO', 'etiquetas.generar'), ('DIRECTOR_TECNICO', 'etiquetas.generar'),
  ('FARMACEUTICO', 'etiquetas.imprimir'), ('DIRECTOR_TECNICO', 'etiquetas.imprimir'),
  ('FARMACEUTICO', 'libro.ver'), ('DIRECTOR_TECNICO', 'libro.ver'), ('SOLO_CONSULTA', 'libro.ver'),
  ('FARMACEUTICO', 'libro.exportar'), ('DIRECTOR_TECNICO', 'libro.exportar'), ('SOLO_CONSULTA', 'libro.exportar'),
  ('FARMACEUTICO', 'libro.anulacion.solicitar'), ('DIRECTOR_TECNICO', 'libro.anulacion.solicitar'),
  ('DIRECTOR_TECNICO', 'libro.anulacion.autorizar'),
  ('DIRECTOR_TECNICO', 'libro.historico.digitalizar'),
  ('DIRECTOR_TECNICO', 'cierres.ver'), ('FARMACEUTICO', 'cierres.ver'), ('SOLO_CONSULTA', 'cierres.ver'),
  ('DIRECTOR_TECNICO', 'cierres.reporte'), ('FARMACEUTICO', 'cierres.reporte'), ('SOLO_CONSULTA', 'cierres.reporte'),
  ('DIRECTOR_TECNICO', 'cierres.firmar'),
  ('DIRECTOR_TECNICO', 'cierres.imprimir'), ('FARMACEUTICO', 'cierres.imprimir'),
  ('DIRECTOR_TECNICO', 'cierres.folio.corregir'),
  ('DIRECTOR_TECNICO', 'libros.crear'), ('DIRECTOR_TECNICO', 'libros.cerrar'),
  ('ATENCION_PUBLICO', 'entregas.registrar'), ('FARMACEUTICO', 'entregas.registrar'), ('DIRECTOR_TECNICO', 'entregas.registrar'),
  ('ATENCION_PUBLICO', 'entregas.firma.confirmar'), ('FARMACEUTICO', 'entregas.firma.confirmar'), ('DIRECTOR_TECNICO', 'entregas.firma.confirmar'),
  ('ATENCION_PUBLICO', 'regularizacion.ver'), ('FARMACEUTICO', 'regularizacion.ver'), ('DIRECTOR_TECNICO', 'regularizacion.ver'),
  ('DIRECTOR_TECNICO', 'archivo.lotes.gestionar'), ('DIRECTOR_TECNICO', 'archivo.destruccion.gestionar'),
  ('DIRECTOR_TECNICO', 'reportes.ver'), ('FARMACEUTICO', 'reportes.ver'), ('SOLO_CONSULTA', 'reportes.ver'),
  ('ADMINISTRADOR', 'reportes.usuarios'), ('ADMINISTRADOR', 'reportes.auditoria'),
  ('ADMINISTRADOR', 'auditoria.ver'), ('DIRECTOR_TECNICO', 'auditoria.ver')
) AS m(rol_codigo, permiso_codigo)
JOIN fsj.rol r ON r.codigo = m.rol_codigo
JOIN fsj.permiso p ON p.codigo = m.permiso_codigo
ON CONFLICT DO NOTHING;

-- ============================================================================
-- usuario (M03) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.usuario (
  id                 uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES fsj.tenant (id),
  email              extensions.citext NOT NULL,
  nombre             text NOT NULL,
  apellido           text NOT NULL,
  dni                text NOT NULL,
  estado             fsj.estado_usuario NOT NULL DEFAULT 'PENDIENTE_ACTIVACION',
  password_hash      text,
  es_tecnico         boolean NOT NULL DEFAULT false,
  intentos_fallidos  integer NOT NULL DEFAULT 0,
  bloqueado_hasta    timestamptz,
  creado_por_id      uuid NOT NULL,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  ultimo_acceso      timestamptz,
  numero_matricula   text,
  fecha_baja         timestamptz,
  motivo_baja        text,
  PRIMARY KEY (id),
  CONSTRAINT usuario_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT usuario_tenant_dni_key UNIQUE (tenant_id, dni),
  -- DP-40 RESUELTA: email is GLOBALLY unique (not per tenant); login is
  -- email + password with no tenant selection.
  CONSTRAINT usuario_email_key UNIQUE (email),
  -- INV-U01 [BD]: creado_por_id is NOT NULL (see column above). The
  -- "must have role ADMINISTRADOR" half of INV-U01 is [APP] -- enforced by
  -- authorize() in FASE 2/3, not here (this table only guarantees the
  -- referenced user exists in the SAME tenant -- DP-41, one tenant per
  -- user -- via the composite FK below).
  CONSTRAINT usuario_creado_por_fkey FOREIGN KEY (tenant_id, creado_por_id) REFERENCES fsj.usuario (tenant_id, id)
);

COMMENT ON TABLE fsj.usuario IS
  'M03. DP-41: a user belongs to exactly one tenant (enforced structurally -- tenant_id is part of the PK-referencing composite key, never a many-to-many). DP-04: the first ADMINISTRADOR of a tenant is created by the platform operator (scripts/create-tenant.ts) with creado_por_id pointing at that tenant''s SISTEMA user (es_tecnico = true), which is self-created (creado_por_id = its own id).';
COMMENT ON COLUMN fsj.usuario.email IS 'citext (case-insensitive), globally unique across ALL tenants -- DP-40.';

SELECT fsj.setup_tenant_table('fsj.usuario');

GRANT UPDATE (
  email, nombre, apellido, dni, numero_matricula,
  estado, password_hash, intentos_fallidos, bloqueado_hasta,
  ultimo_acceso, fecha_baja, motivo_baja
) ON fsj.usuario TO fsj_app;

-- INV-U03: usuario rows are never deleted, even though they remain editable
-- (state transitions, corrections). No DELETE grant exists by default
-- (ALTER DEFAULT PRIVILEGES only grants SELECT/INSERT) -- this trigger is
-- the hard backstop even for a role that somehow gets DELETE later.
CREATE TRIGGER trg_usuario_forbid_delete
  BEFORE DELETE ON fsj.usuario
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- ---------------------------------------------------------------------------
-- INV-USR-006: valid state transitions only.
-- DP-02 is unresolved (is BAJA reversible?) -- BAJA is therefore treated as
-- TERMINAL for now (no BAJA -> anything transition is allowed). Revisit
-- this function once DP-02 resolves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fsj.usuario_validar_transicion_estado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = OLD.estado THEN
    RETURN NEW;
  END IF;

  IF OLD.estado = 'BAJA' THEN
    RAISE EXCEPTION 'INV-USR-006: invalid user state transition BAJA -> % (BAJA is terminal for now -- DP-02 pending)', NEW.estado
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    (OLD.estado = 'PENDIENTE_ACTIVACION' AND NEW.estado IN ('ACTIVO', 'BAJA'))
    OR (OLD.estado = 'ACTIVO' AND NEW.estado IN ('SUSPENDIDO', 'PENDIENTE_ACTIVACION', 'BAJA'))
    OR (OLD.estado = 'SUSPENDIDO' AND NEW.estado IN ('ACTIVO', 'PENDIENTE_ACTIVACION', 'BAJA'))
  ) THEN
    RAISE EXCEPTION 'INV-USR-006: invalid user state transition % -> %', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.usuario_validar_transicion_estado() IS
  'M03 state machine (plan §9 M03). BAJA is terminal until DP-02 resolves.';

CREATE TRIGGER trg_usuario_validar_transicion_estado
  BEFORE UPDATE OF estado ON fsj.usuario
  FOR EACH ROW EXECUTE FUNCTION fsj.usuario_validar_transicion_estado();

-- ============================================================================
-- usuario_rol (M03) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.usuario_rol (
  id               uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  usuario_id       uuid NOT NULL,
  rol_id           uuid NOT NULL REFERENCES fsj.rol (id),
  asignado_por_id  uuid NOT NULL,
  asignado_en      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuario_rol_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT usuario_rol_unico UNIQUE (tenant_id, usuario_id, rol_id),
  CONSTRAINT usuario_rol_usuario_fkey FOREIGN KEY (tenant_id, usuario_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT usuario_rol_asignado_por_fkey FOREIGN KEY (tenant_id, asignado_por_id) REFERENCES fsj.usuario (tenant_id, id)
);

SELECT fsj.setup_tenant_table('fsj.usuario_rol');

-- Role assignment/removal is a legitimate M03 use case (historia 4) --
-- distinct from access revocation, which uses suspend/baja instead of
-- stripping roles (plan §9 M03 "NO HACER"). DELETE is therefore granted;
-- INV-U02 below is what keeps "at least one role" true at commit time.
GRANT DELETE ON fsj.usuario_rol TO fsj_app;

-- ---------------------------------------------------------------------------
-- INV-U02: every user has >= 1 role, checked at COMMIT (DEFERRABLE).
-- Two constraint triggers are needed to cover both directions:
--   1. On usuario_rol (INSERT/UPDATE/DELETE): catches removing the last role.
--   2. On usuario (INSERT): catches creating a user and never assigning a
--      role at all in the same transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fsj.usuario_validar_al_menos_un_rol(p_tenant_id uuid, p_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fsj.usuario_rol
    WHERE tenant_id = p_tenant_id AND usuario_id = p_usuario_id
  ) THEN
    RAISE EXCEPTION 'INV-U02: user % must have at least one role', p_usuario_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.trg_usuario_rol_check_al_menos_un_rol()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM fsj.usuario_validar_al_menos_un_rol(OLD.tenant_id, OLD.usuario_id);
    RETURN OLD;
  ELSE
    PERFORM fsj.usuario_validar_al_menos_un_rol(NEW.tenant_id, NEW.usuario_id);
    RETURN NEW;
  END IF;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_usuario_rol_al_menos_un_rol
  AFTER INSERT OR UPDATE OR DELETE ON fsj.usuario_rol
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_usuario_rol_check_al_menos_un_rol();

CREATE OR REPLACE FUNCTION fsj.trg_usuario_check_al_menos_un_rol()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.usuario_validar_al_menos_un_rol(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_usuario_al_menos_un_rol
  AFTER INSERT ON fsj.usuario
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_usuario_check_al_menos_un_rol();

-- ============================================================================
-- usuario_estado_historial (M03) -- tenant-scoped, append-only
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.usuario_estado_historial (
  id                uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  usuario_id        uuid NOT NULL,
  estado_anterior   fsj.estado_usuario,
  estado_nuevo      fsj.estado_usuario NOT NULL,
  motivo            text,
  cambiado_por_id   uuid NOT NULL,
  cambiado_en       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuario_estado_historial_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT usuario_estado_historial_usuario_fkey FOREIGN KEY (tenant_id, usuario_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT usuario_estado_historial_cambiado_por_fkey FOREIGN KEY (tenant_id, cambiado_por_id) REFERENCES fsj.usuario (tenant_id, id)
);

COMMENT ON TABLE fsj.usuario_estado_historial IS
  'M03: append-only record of usuario.estado changes, for fast per-user history queries (in addition to registro_auditoria, M01).';

SELECT fsj.setup_tenant_table('fsj.usuario_estado_historial');

CREATE TRIGGER trg_usuario_estado_historial_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.usuario_estado_historial
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

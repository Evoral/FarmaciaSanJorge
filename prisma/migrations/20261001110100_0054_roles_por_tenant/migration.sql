-- 0054_roles_por_tenant
--
-- DP-03 RESUELTA (user decision 2026-10-01): option (b), "editable per
-- tenant + audited, ADMINISTRADOR locked". See
-- docs/specs/roles-personalizables.md for the full rules.
--
-- What changes
-- ------------
--   * fsj.rol and fsj.rol_permiso stop being GLOBAL catalogs: both get a
--     tenant_id, forced RLS (fsj.setup_tenant_table) and `codigo` becomes
--     unique PER TENANT. Every tenant gets its own copy of the six roles
--     (fsj.seed_roles_tenant, below), and an ADMINISTRADOR can create,
--     edit and delete roles of its own tenant through the app.
--   * fsj.permiso stays a GLOBAL catalog (no tenant_id, SELECT-only for
--     fsj_app), still mirrored 1:1 by modules/auth/domain/permisos.ts
--     #PERMISO_CODES. rol_permiso keeps its FK to it, so an unknown permiso
--     code can never be stored.
--   * fsj.usuario_rol now references fsj.rol through a COMPOSITE FK
--     (tenant_id, rol_id) -> rol (tenant_id, id): a usuario can only hold
--     roles of its own tenant (INV-T02 shape, same as every other
--     tenant-scoped child table).
--   * New permiso `roles.gestionar` (create/edit/delete roles). Granted to
--     no role row: ADMINISTRADOR gets it implicitly (below).
--   * fsj.permiso gets a mandatory `categoria` (operativo | consulta |
--     gestion | sistema), mirrored by modules/auth/domain/permisos.ts
--     #PERMISO_CATALOGO (tests/db/auth-permisos.test.ts checks both ways).
--     `operativo` = registers or authorizes a movement in the regulated
--     pharmacy circuit; `sistema` = never granted through a role.
--
-- Why ALTER the existing tables instead of creating new ones
-- ----------------------------------------------------------
-- The table names, the Prisma models (Rol/RolPermiso/UsuarioRol), the
-- surrogate `rol.id` referenced by `usuario_rol.rol_id`, and every raw SQL
-- reader (INV-DT-001's trigger fsj.designacion_dt_validar_rol, the
-- last-admin lock query in modules/usuarios/infrastructure/admin-guard.ts)
-- keep working unchanged: they all join `rol r ON r.id = ur.rol_id` and
-- filter `r.codigo`, and both columns keep their meaning. New tables would
-- have forced renaming/rewriting all of them for no gain. The only data
-- movement is: copy the global rows once per tenant, re-point usuario_rol,
-- delete the global rows.
--
-- Protected roles (enforced HERE by triggers, and again in the app layer --
-- modules/usuarios/domain/roles.ts)
-- --------------------------------------------------------------------------
--   * ADMINISTRADOR -- `es_administrador = true` (a CHECK ties the flag to
--     this codigo, so no other role can ever carry it). It holds every
--     `consulta` and `gestion` permiso of the catalog, INCLUDING any added
--     in the future, and NEVER an `operativo` one, WITHOUT rol_permiso
--     rows: the session loader (modules/auth/infrastructure/
--     session-repository.ts) computes that set from the catalog. It cannot
--     be modified or deleted and can have no rol_permiso rows (INV-ROL-002).
--     An administrator who must also act operationally (e.g. a
--     pharmacist-owner) additionally holds an operational role.
--   * SISTEMA -- internal role of the per-tenant technical user (migration
--     0002). Untouchable like ADMINISTRADOR (INV-ROL-002), never assignable
--     to a human usuario (INV-ROL-005).
--   * DIRECTOR_TECNICO -- permisos/nombre/descripcion editable, but it can
--     never be deleted (INV-ROL-003): INV-DT-001 (fsj.designacion_dt_
--     validar_rol) keys on this codigo.
--   * `codigo` is immutable for EVERY role (INV-ROL-001): it is the stable
--     identifier business rules, audit rows and URLs filter on; `nombre` is
--     the display label.
--   * Any role still assigned to a usuario cannot be deleted (INV-ROL-004;
--     the composite FK from usuario_rol is the structural backstop).
--
-- Effective permissions
-- ---------------------
-- The backfill uses the default template (fsj.seed_roles_tenant), which
-- equals the current global matrix (migration 0002 + 0043 + 0046 + 0051).
-- A verification block below ABORTS the migration unless:
--   * every usuario_rol row landed on its tenant's copy of the same role;
--   * every usuario WITHOUT ADMINISTRADOR keeps EXACTLY the same effective
--     permission set;
--   * every usuario keeps AT LEAST its previous set (no one loses access --
--     ADMINISTRADOR held no operativo permiso before, so the "no operativo
--     for admin" rule removes nothing);
--   * nobody GAINS any operativo permiso.
-- Usuarios holding ADMINISTRADOR gain the consulta/gestion permisos they
-- did not hold yet (e.g. libro.ver, cierres.ver, medicos.gestionar,
-- roles.gestionar).
--
-- Depends on 0001 (fsj.setup_tenant_table), 0002 (rol/permiso/rol_permiso/
-- usuario_rol), 0005/0022 (INV-DT-001 reads rol.codigo), 0043/0046/0051
-- (current matrix), 0053 (CREAR_ROL/EDITAR_ROL/ELIMINAR_ROL -- used by the
-- app only, not here).
--
-- Error convention: RAISE EXCEPTION 'INV-XXX: message' USING ERRCODE = 'P0001'.
-- The non-INV exceptions in the verification blocks are migration-time
-- aborts for the operator, never reachable from the app.

-- ============================================================================
-- 1. New permiso + human-readable descriptions.
--    The role editor (/admin/accesos/roles) shows `permiso.descripcion` next
--    to each checkbox, so the unaccented 0002 texts are rewritten in proper
--    Spanish. Codes are untouched. Every permiso also gets its categoria.
-- ============================================================================
INSERT INTO fsj.permiso (codigo, descripcion) VALUES
  ('roles.gestionar', 'Crear, editar y eliminar roles')
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE fsj.permiso ADD COLUMN IF NOT EXISTS categoria text;

UPDATE fsj.permiso p SET categoria = d.categoria, descripcion = d.descripcion
FROM (VALUES
  ('auth.login',                       'consulta',   'Iniciar sesión y volver a autenticarse'),
  ('auth.logout',                      'consulta',   'Cerrar sesión'),
  ('auth.password.cambiar',            'consulta',   'Cambiar la propia contraseña y clave rápida'),
  ('auth.activar',                     'sistema',    'Activar cuenta con credencial de un uso (titular de la credencial, no por rol)'),
  ('usuarios.listar',                  'gestion',    'Ver el listado de usuarios'),
  ('usuarios.ver',                     'gestion',    'Ver el detalle de un usuario'),
  ('usuarios.crear',                   'gestion',    'Crear usuarios'),
  ('usuarios.editar',                  'gestion',    'Editar datos personales de usuarios'),
  ('usuarios.roles.modificar',         'gestion',    'Asignar y quitar roles a usuarios'),
  ('usuarios.suspender',               'gestion',    'Suspender usuarios'),
  ('usuarios.reactivar',               'gestion',    'Reactivar usuarios'),
  ('usuarios.baja',                    'gestion',    'Dar de baja usuarios'),
  ('usuarios.credencial.restablecer',  'gestion',    'Restablecer la credencial de activación'),
  ('usuarios.auditoria.ver',           'gestion',    'Ver el historial de auditoría de usuarios'),
  ('dt.designar',                      'gestion',    'Designar Director Técnico'),
  ('dt.cesar',                         'gestion',    'Registrar el cese de un Director Técnico'),
  ('roles.ver',                        'gestion',    'Ver roles y sus permisos'),
  ('roles.gestionar',                  'gestion',    'Crear, editar y eliminar roles'),
  ('config.ver',                       'gestion',    'Ver datos de la farmacia y parámetros'),
  ('config.editar',                    'gestion',    'Editar datos de la farmacia y parámetros'),
  ('unidades.crear',                   'gestion',    'Crear unidades de medida'),
  ('unidades.editar',                  'gestion',    'Editar unidades de medida'),
  ('unidades.baja',                    'gestion',    'Dar de baja unidades de medida'),
  ('drogas.crear',                     'gestion',    'Crear drogas'),
  ('drogas.editar',                    'gestion',    'Editar drogas'),
  ('drogas.baja',                      'gestion',    'Dar de baja drogas'),
  ('drogas.reactivar',                 'gestion',    'Reactivar drogas'),
  ('proveedores.gestionar',            'gestion',    'Gestionar proveedores'),
  ('medicos.gestionar',                'gestion',    'Gestionar médicos'),
  ('pacientes.gestionar',              'gestion',    'Gestionar pacientes'),
  ('precios.reglas.editar',            'gestion',    'Editar reglas de precio'),
  ('stock.ver',                        'consulta',   'Ver stock'),
  ('stock.valorizado.ver',             'consulta',   'Ver stock valorizado (costos)'),
  ('stock.partida.ingresar',           'operativo',  'Ingresar partidas de stock'),
  ('stock.partida.costo.corregir',     'gestion',    'Corregir el costo de una partida'),
  ('stock.ajuste.registrar',           'operativo',  'Registrar ajustes de stock'),
  ('stock.ajuste.autorizar',           'operativo',  'Autorizar ajustes de stock'),
  ('recetas.crear',                    'operativo',  'Crear recetas'),
  ('recetas.editar',                   'operativo',  'Editar recetas'),
  ('recetas.anular',                   'operativo',  'Anular recetas'),
  ('fichas.generar',                   'operativo',  'Generar fichas técnicas'),
  ('fichas.imprimir',                  'consulta',   'Imprimir fichas técnicas'),
  ('cotizaciones.calcular',            'operativo',  'Calcular presupuestos'),
  ('cotizaciones.ver',                 'consulta',   'Ver presupuestos'),
  ('preparaciones.iniciar',            'operativo',  'Iniciar preparaciones'),
  ('preparaciones.descartar',          'operativo',  'Descartar preparaciones'),
  ('preparaciones.confirmar',          'operativo',  'Confirmar preparaciones'),
  ('etiquetas.generar',                'operativo',  'Generar etiquetas'),
  ('etiquetas.imprimir',               'consulta',   'Imprimir etiquetas'),
  ('libro.ver',                        'consulta',   'Ver el libro recetario'),
  ('libro.exportar',                   'consulta',   'Exportar el libro recetario'),
  ('libro.anulacion.solicitar',        'operativo',  'Solicitar la anulación de un asiento'),
  ('libro.anulacion.autorizar',        'operativo',  'Autorizar la anulación de un asiento'),
  ('libro.historico.digitalizar',      'operativo',  'Digitalizar libros históricos'),
  ('cierres.ver',                      'consulta',   'Ver cierres diarios'),
  ('cierres.reporte',                  'consulta',   'Ver el reporte de cumplimiento de cierres'),
  ('cierres.firmar',                   'operativo',  'Firmar el cierre diario'),
  ('cierres.imprimir',                 'consulta',   'Imprimir el comprobante de cierre'),
  ('cierres.folio.corregir',           'operativo',  'Corregir el folio de un cierre'),
  ('libros.crear',                     'operativo',  'Crear libros rubricados'),
  ('libros.cerrar',                    'operativo',  'Cerrar libros rubricados'),
  ('tenants.crear',                    'sistema',    'Crear farmacias (operador de plataforma, fuera de una farmacia)'),
  ('tenants.editar',                   'sistema',    'Editar farmacias (operador de plataforma, fuera de una farmacia)'),
  ('tenants.baja',                     'sistema',    'Dar de baja farmacias (operador de plataforma, fuera de una farmacia)'),
  ('entregas.registrar',               'operativo',  'Registrar entregas'),
  ('entregas.firma.confirmar',         'operativo',  'Confirmar la firma recibida de una entrega'),
  ('archivo.lotes.gestionar',          'operativo',  'Gestionar lotes de archivo de recetas'),
  ('archivo.destruccion.gestionar',    'operativo',  'Gestionar trámites de destrucción'),
  ('reportes.ver',                     'consulta',   'Ver reportes operativos'),
  ('reportes.usuarios',                'consulta',   'Ver reportes de usuarios'),
  ('reportes.auditoria',               'consulta',   'Ver reportes de auditoría'),
  ('auditoria.ver',                    'consulta',   'Ver el registro de auditoría')
) AS d(codigo, categoria, descripcion)
WHERE p.codigo = d.codigo;

-- A catalog row missing from the list above (drift) makes this fail, so
-- every permiso is classified. Future migrations adding a permiso MUST set
-- its categoria (NOT NULL, no default) -- see docs/specs/roles-personalizables.md.
ALTER TABLE fsj.permiso ALTER COLUMN categoria SET NOT NULL;
ALTER TABLE fsj.permiso ADD CONSTRAINT permiso_categoria_valida
  CHECK (categoria IN ('operativo', 'consulta', 'gestion', 'sistema'));

COMMENT ON COLUMN fsj.permiso.categoria IS
  'DP-03 (migration 0054): operativo (registers/authorizes a movement in the regulated circuit -- never implicit for ADMINISTRADOR), consulta, gestion, sistema (never through a role). Mirrors modules/auth/domain/permisos.ts#PERMISO_CATALOGO.';

-- ============================================================================
-- 2. Snapshot of the CURRENT state, for the verification in step 7.
--    Plain TEMP tables (dropped explicitly at the end; this whole file runs
--    in one transaction).
-- ============================================================================
CREATE TEMP TABLE tmp_0054_permisos_antes AS
SELECT DISTINCT ur.tenant_id, ur.usuario_id, p.codigo AS permiso_codigo
FROM fsj.usuario_rol ur
JOIN fsj.rol_permiso rp ON rp.rol_id = ur.rol_id
JOIN fsj.permiso p ON p.id = rp.permiso_id;

CREATE TEMP TABLE tmp_0054_asignaciones_antes AS
SELECT ur.id AS usuario_rol_id, ur.tenant_id, r.codigo AS rol_codigo
FROM fsj.usuario_rol ur
JOIN fsj.rol r ON r.id = ur.rol_id;

-- ============================================================================
-- 3. New columns + per-tenant uniqueness. During the transition the old
--    global rows have tenant_id NULL (NOT NULL is set in step 6, once they
--    are gone).
-- ============================================================================
ALTER TABLE fsj.rol ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES fsj.tenant (id);
ALTER TABLE fsj.rol ADD COLUMN IF NOT EXISTS es_administrador boolean NOT NULL DEFAULT false;
ALTER TABLE fsj.rol_permiso ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE fsj.rol DROP CONSTRAINT IF EXISTS rol_codigo_key;
ALTER TABLE fsj.rol ADD CONSTRAINT rol_tenant_codigo_key UNIQUE (tenant_id, codigo);
ALTER TABLE fsj.rol ADD CONSTRAINT rol_tenant_id_key UNIQUE (tenant_id, id);

COMMENT ON COLUMN fsj.rol.es_administrador IS
  'DP-03 (migration 0054): true ONLY for ADMINISTRADOR (CHECK rol_es_administrador_solo_admin). The session loader grants it every consulta/gestion permiso of the catalog -- including permisos added later, never an operativo one -- and it never has rol_permiso rows (INV-ROL-002).';

-- ============================================================================
-- 4. The default role template: fsj.plantilla_rol_permisos (the matrix,
--    data only) + fsj.seed_roles_tenant (the ONE seeding entry point), used
--    by this backfill, by the AFTER INSERT trigger on fsj.tenant (step 9)
--    and, explicitly, by scripts/create-tenant.ts. Idempotent (ON CONFLICT
--    DO NOTHING) -- but only meant to run on a tenant that has no roles yet:
--    on an existing tenant it would re-create a default role an admin
--    deleted.
--
--    Mirrors, role by role, the matrix that tests/db/auth-permisos.test.ts
--    (EXPECTED_ROL_PERMISOS) validates and the unit tests' SEED_GRANTS copy.
--    ADMINISTRADOR and SISTEMA get no rol_permiso rows (see header).
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
  'DP-03 (migration 0054): seeds THE default role template of a new tenant (ADMINISTRADOR locked with es_administrador, DIRECTOR_TECNICO, FARMACEUTICO, ATENCION_PUBLICO, SOLO_CONSULTA, SISTEMA). Called by migration 0054''s backfill, by trg_tenant_seed_roles (AFTER INSERT ON fsj.tenant) and by scripts/create-tenant.ts. Operator-only (EXECUTE revoked from PUBLIC).';

-- Platform-operator only: fsj_app must not be able to re-seed (and thereby
-- re-create a default role an admin deleted).
REVOKE EXECUTE ON FUNCTION fsj.seed_roles_tenant(uuid) FROM PUBLIC;

-- ============================================================================
-- 5. Backfill: every existing tenant gets its copy, then usuario_rol is
--    re-pointed from the global row to the tenant's row with the same
--    codigo. The old FKs to fsj.rol(id) are dropped first, by catalog
--    lookup (their names come from 0002's inline REFERENCES).
-- ============================================================================
SELECT fsj.seed_roles_tenant(t.id) FROM fsj.tenant t;

DO $do$
DECLARE
  v_con record;
BEGIN
  FOR v_con IN
    SELECT c.conrelid::regclass AS tabla, c.conname
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = 'fsj.rol'::regclass
      AND c.conrelid IN ('fsj.usuario_rol'::regclass, 'fsj.rol_permiso'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', v_con.tabla, v_con.conname);
  END LOOP;
END
$do$;

UPDATE fsj.usuario_rol ur
SET rol_id = nuevo.id
FROM fsj.rol viejo, fsj.rol nuevo
WHERE viejo.id = ur.rol_id
  AND viejo.tenant_id IS NULL
  AND nuevo.tenant_id = ur.tenant_id
  AND nuevo.codigo = viejo.codigo;

-- The UPDATE above queued events for the DEFERRED constraint trigger
-- trg_usuario_rol_al_menos_un_rol (INV-U02, migration 0002). PostgreSQL
-- refuses any later ALTER TABLE fsj.usuario_rol in this transaction while
-- they are pending (55006 "pending trigger events"), so fire them now.
-- Nothing after this point needs deferral.
SET CONSTRAINTS ALL IMMEDIATE;

-- ============================================================================
-- 6. Drop the global rows; tenant_id becomes mandatory; new constraints.
-- ============================================================================
DELETE FROM fsj.rol_permiso rp
USING fsj.rol r
WHERE rp.rol_id = r.id AND r.tenant_id IS NULL;

DELETE FROM fsj.rol WHERE tenant_id IS NULL;

ALTER TABLE fsj.rol ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE fsj.rol_permiso ALTER COLUMN tenant_id SET NOT NULL;

-- Only the ADMINISTRADOR row may (and must) carry es_administrador.
ALTER TABLE fsj.rol ADD CONSTRAINT rol_es_administrador_solo_admin
  CHECK (es_administrador = (codigo = 'ADMINISTRADOR'));

-- Stable, URL/audit-safe codes: generated by the app from the nombre
-- (modules/usuarios/domain/roles.ts#generarCodigoRol).
ALTER TABLE fsj.rol ADD CONSTRAINT rol_codigo_formato
  CHECK (codigo ~ '^[A-Z][A-Z0-9_]{0,59}$');

ALTER TABLE fsj.rol ADD CONSTRAINT rol_nombre_no_vacio
  CHECK (btrim(nombre) <> '' AND char_length(nombre) <= 80);

-- Two roles of the same tenant cannot share a display name (case-insensitive):
-- pickers and listings identify roles by nombre.
CREATE UNIQUE INDEX IF NOT EXISTS rol_tenant_nombre_key ON fsj.rol (tenant_id, lower(nombre));

ALTER TABLE fsj.rol_permiso
  ADD CONSTRAINT rol_permiso_rol_fkey FOREIGN KEY (tenant_id, rol_id)
  REFERENCES fsj.rol (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE fsj.usuario_rol
  ADD CONSTRAINT usuario_rol_rol_fkey FOREIGN KEY (tenant_id, rol_id)
  REFERENCES fsj.rol (tenant_id, id);

-- Backs "how many usuarios hold this role" (roles listing, INV-ROL-004)
-- and the FK check on rol DELETE.
CREATE INDEX IF NOT EXISTS idx_usuario_rol_tenant_rol ON fsj.usuario_rol (tenant_id, rol_id);

COMMENT ON TABLE fsj.rol IS
  'M03, per-tenant since migration 0054 (DP-03 RESUELTA: editable per tenant + audited). Seeded per tenant by fsj.seed_roles_tenant. ADMINISTRADOR (es_administrador) and SISTEMA are untouchable (INV-ROL-002), DIRECTOR_TECNICO cannot be deleted (INV-ROL-003), codigo is immutable (INV-ROL-001), an assigned role cannot be deleted (INV-ROL-004).';
COMMENT ON TABLE fsj.rol_permiso IS
  'M03, per-tenant since migration 0054: role -> permiso, one row per pair. FK to the global fsj.permiso catalog (unknown codes impossible). Never rows for ADMINISTRADOR/SISTEMA (INV-ROL-002).';
COMMENT ON TABLE fsj.permiso IS
  'Global catalog (M03, plan §7): permission codes and their categoria, mirrored 1:1 by modules/auth/domain/permisos.ts#PERMISO_CATALOGO (tests/db/auth-permisos.test.ts). Read-only for fsj_app.';

-- ============================================================================
-- 7. Verification -- aborts the whole migration (nothing is applied) if the
--    restructure changed anything it must not.
-- ============================================================================
DO $do$
DECLARE
  v_diff integer;
BEGIN
  -- 7a. Every assignment points at its OWN tenant's copy of the SAME role.
  SELECT count(*) INTO v_diff
  FROM tmp_0054_asignaciones_antes a
  LEFT JOIN fsj.usuario_rol ur ON ur.id = a.usuario_rol_id
  LEFT JOIN fsj.rol r ON r.id = ur.rol_id
  WHERE r.id IS NULL
     OR r.tenant_id IS DISTINCT FROM a.tenant_id
     OR r.codigo IS DISTINCT FROM a.rol_codigo;
  IF v_diff > 0 THEN
    RAISE EXCEPTION 'migration 0054: % usuario_rol rows did not land on their tenant''s copy of the same role', v_diff;
  END IF;

  -- 7b. No usuario held a `sistema` permiso (no role can grant one any
  --     more, see modules/auth/domain/permisos.ts#PERMISOS_FUERA_DE_ROLES).
  SELECT count(*) INTO v_diff
  FROM tmp_0054_permisos_antes a
  JOIN fsj.permiso p ON p.codigo = a.permiso_codigo
  WHERE p.categoria = 'sistema';
  IF v_diff > 0 THEN
    RAISE EXCEPTION 'migration 0054: % (usuario, permiso) pairs held a permiso outside roles', v_diff;
  END IF;

  -- Effective set AFTER the restructure, computed exactly like the session
  -- loader: rol_permiso rows, plus every consulta/gestion permiso for a
  -- usuario holding the locked ADMINISTRADOR role.
  CREATE TEMP TABLE tmp_0054_permisos_despues AS
  SELECT DISTINCT ur.tenant_id, ur.usuario_id, p.codigo AS permiso_codigo
  FROM fsj.usuario_rol ur
  JOIN fsj.rol_permiso rp ON rp.tenant_id = ur.tenant_id AND rp.rol_id = ur.rol_id
  JOIN fsj.permiso p ON p.id = rp.permiso_id
  UNION
  SELECT ur.tenant_id, ur.usuario_id, p.codigo
  FROM fsj.usuario_rol ur
  JOIN fsj.rol r ON r.tenant_id = ur.tenant_id AND r.id = ur.rol_id AND r.es_administrador
  CROSS JOIN fsj.permiso p
  WHERE p.categoria IN ('consulta', 'gestion');

  -- 7c. Every usuario WITHOUT the (locked) ADMINISTRADOR role keeps EXACTLY
  --     the same effective permission set, in both directions.
  WITH sin_admin AS (
    SELECT u.tenant_id, u.id AS usuario_id
    FROM fsj.usuario u
    WHERE NOT EXISTS (
      SELECT 1 FROM fsj.usuario_rol ur
      JOIN fsj.rol r ON r.tenant_id = ur.tenant_id AND r.id = ur.rol_id
      WHERE ur.tenant_id = u.tenant_id AND ur.usuario_id = u.id AND r.es_administrador
    )
  ),
  antes AS (
    SELECT a.tenant_id, a.usuario_id, a.permiso_codigo
    FROM tmp_0054_permisos_antes a
    JOIN sin_admin s ON s.tenant_id = a.tenant_id AND s.usuario_id = a.usuario_id
  ),
  despues AS (
    SELECT d.tenant_id, d.usuario_id, d.permiso_codigo
    FROM tmp_0054_permisos_despues d
    JOIN sin_admin s ON s.tenant_id = d.tenant_id AND s.usuario_id = d.usuario_id
  ),
  diferencias AS (
    (SELECT * FROM antes EXCEPT SELECT * FROM despues)
    UNION ALL
    (SELECT * FROM despues EXCEPT SELECT * FROM antes)
  )
  SELECT count(*) INTO v_diff FROM diferencias;
  IF v_diff > 0 THEN
    RAISE EXCEPTION 'migration 0054: effective permissions changed for % (usuario, permiso) pairs of non-ADMINISTRADOR usuarios', v_diff;
  END IF;

  -- 7d. Nobody loses a permiso: every usuario's new set is a SUPERSET of
  --     the old one (holds for ADMINISTRADOR because it held no operativo
  --     permiso before this migration).
  SELECT count(*) INTO v_diff FROM (
    SELECT tenant_id, usuario_id, permiso_codigo FROM tmp_0054_permisos_antes
    EXCEPT
    SELECT tenant_id, usuario_id, permiso_codigo FROM tmp_0054_permisos_despues
  ) perdidos;
  IF v_diff > 0 THEN
    RAISE EXCEPTION 'migration 0054: % (usuario, permiso) pairs would be LOST', v_diff;
  END IF;

  -- 7e. Nobody GAINS an operativo permiso (the locked ADMINISTRADOR only
  --     adds consulta/gestion).
  SELECT count(*) INTO v_diff FROM (
    SELECT d.tenant_id, d.usuario_id, d.permiso_codigo
    FROM tmp_0054_permisos_despues d
    JOIN fsj.permiso p ON p.codigo = d.permiso_codigo AND p.categoria = 'operativo'
    EXCEPT
    SELECT tenant_id, usuario_id, permiso_codigo FROM tmp_0054_permisos_antes
  ) ganados;
  IF v_diff > 0 THEN
    RAISE EXCEPTION 'migration 0054: % (usuario, permiso) pairs would GAIN an operativo permiso', v_diff;
  END IF;

  DROP TABLE tmp_0054_permisos_despues;
END
$do$;

DROP TABLE tmp_0054_permisos_antes;
DROP TABLE tmp_0054_asignaciones_antes;

-- ============================================================================
-- 8. RLS (INV-T01/INV-T03) + grants for fsj_app.
--    rol: read, create, edit nombre/descripcion only, delete.
--    rol_permiso: read, insert, delete (a role's permisos are replaced by
--    delete + insert; no UPDATE -- a pair has nothing to update).
--    permiso: unchanged, SELECT only (migration 0002).
-- ============================================================================
SELECT fsj.setup_tenant_table('fsj.rol');
SELECT fsj.setup_tenant_table('fsj.rol_permiso');

GRANT SELECT, INSERT, DELETE ON fsj.rol TO fsj_app;
GRANT UPDATE (nombre, descripcion) ON fsj.rol TO fsj_app;
GRANT SELECT, INSERT, DELETE ON fsj.rol_permiso TO fsj_app;
REVOKE UPDATE ON fsj.rol_permiso FROM fsj_app;

-- ============================================================================
-- 9. Protection triggers.
-- ============================================================================

-- fsj.rol: INV-ROL-001 (codigo / es_administrador immutable),
-- INV-ROL-002 (ADMINISTRADOR / SISTEMA untouchable), INV-ROL-003
-- (DIRECTOR_TECNICO not deletable), INV-ROL-004 (assigned role not
-- deletable -- the composite FK from usuario_rol would reject it too, with
-- a less helpful 23503).
CREATE OR REPLACE FUNCTION fsj.rol_validar_cambio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.es_administrador OR OLD.codigo = 'SISTEMA' THEN
      RAISE EXCEPTION 'INV-ROL-002: role % is protected and cannot be modified or deleted', OLD.codigo
        USING ERRCODE = 'P0001';
    END IF;
    IF OLD.codigo = 'DIRECTOR_TECNICO' THEN
      RAISE EXCEPTION 'INV-ROL-003: role DIRECTOR_TECNICO cannot be deleted (INV-DT-001 depends on it)'
        USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM fsj.usuario_rol ur WHERE ur.tenant_id = OLD.tenant_id AND ur.rol_id = OLD.id) THEN
      RAISE EXCEPTION 'INV-ROL-004: role % is assigned to at least one usuario and cannot be deleted', OLD.codigo
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.codigo IS DISTINCT FROM OLD.codigo OR NEW.es_administrador IS DISTINCT FROM OLD.es_administrador THEN
    RAISE EXCEPTION 'INV-ROL-001: rol.codigo and rol.es_administrador are immutable (role %)', OLD.codigo
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.es_administrador OR OLD.codigo = 'SISTEMA' THEN
    RAISE EXCEPTION 'INV-ROL-002: role % is protected and cannot be modified or deleted', OLD.codigo
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.rol_validar_cambio() IS
  'DP-03 (migration 0054): INV-ROL-001 codigo/es_administrador immutable; INV-ROL-002 ADMINISTRADOR/SISTEMA cannot be modified or deleted; INV-ROL-003 DIRECTOR_TECNICO cannot be deleted; INV-ROL-004 an assigned role cannot be deleted.';

DROP TRIGGER IF EXISTS trg_rol_validar_cambio ON fsj.rol;
CREATE TRIGGER trg_rol_validar_cambio
  BEFORE UPDATE OR DELETE ON fsj.rol
  FOR EACH ROW EXECUTE FUNCTION fsj.rol_validar_cambio();

-- fsj.rol_permiso: INV-ROL-002 -- the locked ADMINISTRADOR (consulta/gestion,
-- implicitly) and the permission-less SISTEMA never get rows. On a CASCADE
-- delete of a (deletable) role the parent row is already gone, so the
-- lookup finds nothing and the delete proceeds.
CREATE OR REPLACE FUNCTION fsj.rol_permiso_validar_rol()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id uuid;
  v_rol_id    uuid;
  v_codigo    text;
  v_todos     boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
    v_rol_id := OLD.rol_id;
  ELSE
    v_tenant_id := NEW.tenant_id;
    v_rol_id := NEW.rol_id;
  END IF;

  SELECT r.codigo, r.es_administrador INTO v_codigo, v_todos
  FROM fsj.rol r
  WHERE r.tenant_id = v_tenant_id AND r.id = v_rol_id;

  IF FOUND AND (v_todos OR v_codigo = 'SISTEMA') THEN
    RAISE EXCEPTION 'INV-ROL-002: permisos of role % are fixed and cannot be changed', v_codigo
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.rol_permiso_validar_rol() IS
  'DP-03 (migration 0054): INV-ROL-002 -- no rol_permiso rows can be added to / removed from ADMINISTRADOR (es_administrador) or SISTEMA.';

DROP TRIGGER IF EXISTS trg_rol_permiso_validar_rol ON fsj.rol_permiso;
CREATE TRIGGER trg_rol_permiso_validar_rol
  BEFORE INSERT OR UPDATE OR DELETE ON fsj.rol_permiso
  FOR EACH ROW EXECUTE FUNCTION fsj.rol_permiso_validar_rol();

-- fsj.usuario_rol: INV-ROL-005 -- SISTEMA is only ever held by the
-- tenant's technical usuario (es_tecnico = true). Checked on INSERT and on
-- any UPDATE of the role/usuario columns; existing rows are not
-- re-validated (the technical user is the only holder today).
CREATE OR REPLACE FUNCTION fsj.usuario_rol_validar_sistema()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fsj.rol r
    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.rol_id AND r.codigo = 'SISTEMA'
  ) AND NOT EXISTS (
    SELECT 1 FROM fsj.usuario u
    WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.usuario_id AND u.es_tecnico
  ) THEN
    RAISE EXCEPTION 'INV-ROL-005: role SISTEMA can only be held by the technical usuario (usuario %)', NEW.usuario_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.usuario_rol_validar_sistema() IS
  'DP-03 (migration 0054): INV-ROL-005 -- the SISTEMA role is not assignable to a human usuario.';

DROP TRIGGER IF EXISTS trg_usuario_rol_validar_sistema ON fsj.usuario_rol;
CREATE TRIGGER trg_usuario_rol_validar_sistema
  BEFORE INSERT OR UPDATE OF rol_id, usuario_id ON fsj.usuario_rol
  FOR EACH ROW EXECUTE FUNCTION fsj.usuario_rol_validar_sistema();

-- fsj.tenant: every NEW tenant gets the default roles in the same
-- transaction that creates it (scripts/create-tenant.ts, DB test fixtures).
CREATE OR REPLACE FUNCTION fsj.tenant_seed_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.seed_roles_tenant(NEW.id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.tenant_seed_roles() IS
  'DP-03 (migration 0054): AFTER INSERT ON fsj.tenant -- seeds the default roles (fsj.seed_roles_tenant) of the new tenant.';

DROP TRIGGER IF EXISTS trg_tenant_seed_roles ON fsj.tenant;
CREATE TRIGGER trg_tenant_seed_roles
  AFTER INSERT ON fsj.tenant
  FOR EACH ROW EXECUTE FUNCTION fsj.tenant_seed_roles();

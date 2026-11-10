-- 0125 -- Pharmacy estado and contacto, one alta for script and panel, platform reads (openspec/changes/plataforma-superadmin,
-- stage 2; spec P8-P12).
--
--   1. fsj.tenant.estado (ACTIVO / SUSPENDIDO) + contacto_* columns. fsj_app gets NO column grant on them: only the
--      platform functions below change them. fecha_baja (definitive baja) is unchanged and not offered by the panel (D9).
--      A SUSPENDIDO pharmacy cannot log in and its sessions stop on the next request (modules/auth); the daily jobs
--      keep processing it: fsj.listar_tenants_activos() (0119) filters on fecha_baja only (D10).
--   2. fsj.crear_tenant_interno(): the whole alta of scripts/create-tenant.ts (tenant, roles, acciones con PIN, SISTEMA,
--      first Administrador, parámetros, etiqueta tamaño and hoja, the three libros) in ONE function, so the script and
--      the panel seed exactly the same rows (D12). Owner-only: REVOKE from fsj_app. A new per-tenant seed is added by
--      a migration that replaces this function, never in the script.
--   3. fsj.plataforma_*: alta, suspend/reactivate, contacto, list, detail, audit of a pharmacy. Each one derives the
--      actor from the session token hash first (fsj.plataforma_actor, 0124) and audits in the same transaction.
--      None reads a tenant-scoped table (D11).
--   4. Permisos tenants.crear / tenants.editar / tenants.baja removed (D18): the superadmin does not use tenant permisos.
--
-- Code: modules/auth (validateSession and login reject a non-ACTIVO tenant), scripts/create-tenant.ts.
-- Apply together with that code (the script calls fsj.crear_tenant_interno; permisos.ts drops the three codes).
-- Rollback: prisma/rollbacks/0125_tenant_estado_y_alta.down.sql (as a NEW forward migration, code reverted first).

-- ============================================================================
-- 1. estado and contacto
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.estado_tenant AS ENUM ('ACTIVO', 'SUSPENDIDO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

ALTER TABLE fsj.tenant
  ADD COLUMN estado            fsj.estado_tenant NOT NULL DEFAULT 'ACTIVO',
  ADD COLUMN contacto_nombre   text CHECK (contacto_nombre IS NULL OR length(contacto_nombre) <= 120),
  ADD COLUMN contacto_email    extensions.citext CHECK (contacto_email IS NULL OR length(contacto_email) <= 254),
  ADD COLUMN contacto_telefono varchar(40);

COMMENT ON COLUMN fsj.tenant.estado IS
  '0125 (spec P11). SUSPENDIDO: no login, open sessions rejected on their next request, data untouched, daily jobs still run. Changed only by fsj.plataforma_cambiar_estado_tenant.';
COMMENT ON COLUMN fsj.tenant.contacto_email IS
  '0125 (spec P12). The platform''s own contact data about the client; changed only by the platform functions.';

-- ============================================================================
-- 2. fsj.crear_tenant_interno: the one alta (owner-only)
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.crear_tenant_interno(
  p_razon_social         text,
  p_cuit                 text,
  p_nombre_fantasia      text,
  p_domicilio            text,
  p_matricula_farmacia   text,
  p_zona_horaria         text,
  p_contacto_nombre      text,
  p_contacto_email       text,
  p_contacto_telefono    text,
  p_admin_email          text,
  p_admin_nombre         text,
  p_admin_apellido       text,
  p_admin_dni            text,
  p_admin_password_hash  text,
  p_etiqueta_nombre      text,
  p_etiqueta_ancho_mm    numeric,
  p_etiqueta_alto_mm     numeric,
  p_hoja_ancho_mm        numeric,
  p_hoja_alto_mm         numeric,
  p_hoja_margen_mm       numeric
)
RETURNS TABLE (tenant_id uuid, admin_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id   uuid;
  v_sistema_id  uuid := extensions.gen_random_uuid();
  v_admin_id    uuid := extensions.gen_random_uuid();
BEGIN
  INSERT INTO fsj.tenant (razon_social, cuit, nombre_fantasia, domicilio, matricula_farmacia, zona_horaria,
                          contacto_nombre, contacto_email, contacto_telefono)
  VALUES (p_razon_social, p_cuit, p_nombre_fantasia, p_domicilio, p_matricula_farmacia,
          coalesce(p_zona_horaria, 'America/Argentina/Mendoza'),
          p_contacto_nombre, p_contacto_email, p_contacto_telefono)
  RETURNING id INTO v_tenant_id;

  -- The AFTER INSERT triggers on fsj.tenant already ran both; calling them keeps the dependency visible (no-op).
  PERFORM fsj.seed_roles_tenant(v_tenant_id);
  PERFORM fsj.seed_acciones_con_pin(v_tenant_id);

  -- SISTEMA: self-created, one per tenant, es_tecnico (migration 0002).
  INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
  VALUES (v_sistema_id, v_tenant_id, 'sistema+' || v_tenant_id || '@internal.local', 'Sistema', 'Tecnico',
          'SISTEMA-' || v_tenant_id, 'ACTIVO', true, v_sistema_id);
  INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id)
  SELECT v_tenant_id, v_sistema_id, r.id, v_sistema_id FROM fsj.rol r WHERE r.tenant_id = v_tenant_id AND r.codigo = 'SISTEMA';

  -- First Administrador: created by SISTEMA (DP-04), ACTIVO with a temporary password (contrasena-temporal).
  INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id, password_hash, debe_cambiar_password)
  VALUES (v_admin_id, v_tenant_id, p_admin_email, p_admin_nombre, p_admin_apellido, p_admin_dni, 'ACTIVO', false,
          v_sistema_id, p_admin_password_hash, true);
  INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id)
  SELECT v_tenant_id, v_admin_id, r.id, v_sistema_id FROM fsj.rol r WHERE r.tenant_id = v_tenant_id AND r.codigo = 'ADMINISTRADOR';

  -- Per-tenant parámetros: the exact list scripts/create-tenant.ts inserted until 0125 (see its git history for
  -- the spec of each one).
  INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
  VALUES
    (v_tenant_id, 'precision_balanza', 'NUMERO', '0.001', 'Precision de la balanza para redondeo de linea_pesaje (GRAMO) -- openspec/specs/ficha-tecnica/spec.md R8'),
    (v_tenant_id, 'exceso_pesada_porcentaje', 'NUMERO', '0', 'Porcentaje de exceso de pesada aplicado a lineas no manuales -- openspec/specs/ficha-tecnica/spec.md R7'),
    (v_tenant_id, 'tolerancia_pesada_porcentaje', 'NUMERO', '5', 'Desvio maximo, en porcentaje, entre la pesada real y la esperada; fuera de el se pide la co-firma del Director Tecnico -- openspec/specs/pesada-real/spec.md'),
    (v_tenant_id, 'dias_alerta_vencimiento_partida', 'NUMERO', '30', 'Dias de anticipacion para la alerta de partidas por vencer -- DP-14, FASE 5 punto 5.7'),
    (v_tenant_id, 'plazo_firma_dias', 'NUMERO', '0', 'Dias corridos de gracia, despues del dia siguiente a la jornada, para firmar el cierre diario en termino (0 = solo el dia siguiente) -- DP-18'),
    (v_tenant_id, 'plazo_archivo_comun_anios', 'NUMERO', '2', 'Anios de conservacion en archivo fisico para lotes sin recetas controladas -- DP-26 PARCIAL, FASE 12 punto 12.1'),
    (v_tenant_id, 'plazo_archivo_controladas_anios', 'NUMERO', '3', 'Anios de conservacion en archivo fisico para lotes con al menos una receta controlada -- DP-26 PARCIAL, FASE 12 punto 12.1'),
    (v_tenant_id, 'meses_vencimiento_preparado', 'NUMERO', '3', 'Meses desde la elaboracion tras los cuales vence un preparado; se fija al confirmar la preparacion -- DP-28 Vencimiento'),
    (v_tenant_id, 'dias_retiro_vencido', 'NUMERO', '30', 'Dias, desde que la receta queda preparada, tras los cuales un preparado que nadie retiro pasa a Retiro vencido; 0 desactiva el vencimiento -- openspec/specs/retiro-vencido/spec.md'),
    (v_tenant_id, 'dias_relevamiento_inicial', 'NUMERO', '30', 'Dias, desde el primer cierre diario firmado, durante los cuales se puede cargar existencia inicial si el DT no cerro antes el relevamiento -- openspec/specs/existencia-inicial/spec.md'),
    (v_tenant_id, 'alicuota_iva_porcentaje', 'NUMERO', '21', 'Alicuota de IVA, en porcentaje, que se propone para cada costo de proveedor nuevo y con la que se cotizan las partidas -- openspec/specs/costos-proveedor/spec.md R7a'),
    (v_tenant_id, 'lector_qr_receta', 'TEXTO', 'CAMARA', 'Modo del lector del panel Importar con QR: CAMARA (boton de camara) o LECTOR (lector USB); cada equipo puede cambiarlo -- openspec/specs/importacion-receta-qr/spec.md')
  ON CONFLICT (tenant_id, clave) DO NOTHING;

  -- Etiqueta size and sheet (0066, 0096). Defaults come from modules/etiqueta-tamanos/domain (their only source).
  INSERT INTO fsj.etiqueta_tamano (tenant_id, nombre, ancho_mm, alto_mm)
  VALUES (v_tenant_id, p_etiqueta_nombre, p_etiqueta_ancho_mm, p_etiqueta_alto_mm)
  ON CONFLICT DO NOTHING;
  INSERT INTO fsj.etiqueta_hoja (tenant_id, ancho_mm, alto_mm, margen_mm)
  VALUES (v_tenant_id, p_hoja_ancho_mm, p_hoja_alto_mm, p_hoja_margen_mm)
  ON CONFLICT DO NOTHING;

  -- The three libros, open from day one; numero / fecha_rubrica / expediente_rubrica stay NULL (DP-38, migration 0014).
  INSERT INTO fsj.libro_rubricado (tenant_id, tipo, registrado_por_id)
  VALUES (v_tenant_id, 'RECETARIO', v_sistema_id),
         (v_tenant_id, 'PSICOTROPICO', v_sistema_id),
         (v_tenant_id, 'ESTUPEFACIENTE', v_sistema_id);

  RETURN QUERY SELECT v_tenant_id, v_admin_id;
END;
$$;

COMMENT ON FUNCTION fsj.crear_tenant_interno(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric) IS
  '0125 (D12). The whole alta of a pharmacy in one call, used by scripts/create-tenant.ts (owner) and fsj.plataforma_crear_tenant. Owner-only. A new per-tenant seed is added by a migration that replaces this function.';

REVOKE ALL ON FUNCTION fsj.crear_tenant_interno(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, fsj_app;

-- ============================================================================
-- 3. Platform functions
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.plataforma_crear_tenant(
  p_token_hash           text,
  p_razon_social         text,
  p_cuit                 text,
  p_nombre_fantasia      text,
  p_domicilio            text,
  p_matricula_farmacia   text,
  p_zona_horaria         text,
  p_contacto_nombre      text,
  p_contacto_email       text,
  p_contacto_telefono    text,
  p_admin_email          text,
  p_admin_nombre         text,
  p_admin_apellido       text,
  p_admin_dni            text,
  p_admin_password_hash  text,
  p_etiqueta_nombre      text,
  p_etiqueta_ancho_mm    numeric,
  p_etiqueta_alto_mm     numeric,
  p_hoja_ancho_mm        numeric,
  p_hoja_alto_mm         numeric,
  p_hoja_margen_mm       numeric,
  p_ip                   text,
  p_request_id           text
)
RETURNS TABLE (tenant_id uuid, admin_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_actor     uuid := fsj.plataforma_actor(p_token_hash);
  v_tenant_id uuid;
  v_admin_id  uuid;
BEGIN
  SELECT c.tenant_id, c.admin_id INTO v_tenant_id, v_admin_id
  FROM fsj.crear_tenant_interno(p_razon_social, p_cuit, p_nombre_fantasia, p_domicilio, p_matricula_farmacia, p_zona_horaria,
                                p_contacto_nombre, p_contacto_email, p_contacto_telefono,
                                p_admin_email, p_admin_nombre, p_admin_apellido, p_admin_dni, p_admin_password_hash,
                                p_etiqueta_nombre, p_etiqueta_ancho_mm, p_etiqueta_alto_mm,
                                p_hoja_ancho_mm, p_hoja_alto_mm, p_hoja_margen_mm) AS c;

  -- Never the password hash.
  PERFORM fsj.plataforma_auditar(v_actor, 'TENANT_CREAR', 'tenant', v_tenant_id, v_tenant_id, NULL,
    jsonb_build_object(
      'razonSocial', p_razon_social, 'cuit', p_cuit, 'nombreFantasia', p_nombre_fantasia, 'domicilio', p_domicilio,
      'matriculaFarmacia', p_matricula_farmacia, 'zonaHoraria', p_zona_horaria,
      'contactoNombre', p_contacto_nombre, 'contactoEmail', p_contacto_email, 'contactoTelefono', p_contacto_telefono,
      'adminId', v_admin_id, 'adminEmail', p_admin_email),
    NULL, p_ip, p_request_id);

  RETURN QUERY SELECT v_tenant_id, v_admin_id;
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_crear_tenant(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_crear_tenant(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text) TO fsj_app;

-- Before the alta: which fields already belong to someone, so the form marks them (spec P10). The CUIT is compared by
-- digits; the email against both login tables. The unique constraints stay the backstop for the race.
CREATE OR REPLACE FUNCTION fsj.plataforma_alta_conflictos(p_token_hash text, p_cuit text, p_admin_email text)
RETURNS TABLE (cuit_en_uso boolean, email_en_uso boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := fsj.plataforma_actor(p_token_hash);
BEGIN
  RETURN QUERY SELECT
    EXISTS (SELECT 1 FROM fsj.tenant t WHERE regexp_replace(t.cuit, '[^0-9]', '', 'g') = regexp_replace(p_cuit, '[^0-9]', '', 'g')),
    EXISTS (SELECT 1 FROM fsj.usuario u WHERE u.email = p_admin_email::extensions.citext)
      OR EXISTS (SELECT 1 FROM fsj.superadmin s WHERE s.email = p_admin_email::extensions.citext);
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_alta_conflictos(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_alta_conflictos(text, text, text) TO fsj_app;

-- Suspend (motivo required) or reactivate. A pharmacy with fecha_baja cannot change estado; the same estado is refused.
CREATE OR REPLACE FUNCTION fsj.plataforma_cambiar_estado_tenant(
  p_token_hash  text,
  p_tenant_id   uuid,
  p_estado      fsj.estado_tenant,
  p_motivo      text,
  p_ip          text,
  p_request_id  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_actor      uuid := fsj.plataforma_actor(p_token_hash);
  v_anterior   fsj.estado_tenant;
  v_fecha_baja timestamptz;
BEGIN
  SELECT t.estado, t.fecha_baja INTO v_anterior, v_fecha_baja FROM fsj.tenant t WHERE t.id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-PLAT-TENANT: la farmacia no existe' USING ERRCODE = 'P0001';
  END IF;
  IF v_fecha_baja IS NOT NULL THEN
    RAISE EXCEPTION 'INV-PLAT-BAJA: la farmacia está dada de baja' USING ERRCODE = 'P0001';
  END IF;
  IF v_anterior = p_estado THEN
    RAISE EXCEPTION 'INV-PLAT-ESTADO: la farmacia ya está en ese estado' USING ERRCODE = 'P0001';
  END IF;
  IF p_estado = 'SUSPENDIDO' AND length(btrim(coalesce(p_motivo, ''))) = 0 THEN
    RAISE EXCEPTION 'INV-PLAT-MOTIVO: falta el motivo' USING ERRCODE = 'P0001';
  END IF;

  UPDATE fsj.tenant SET estado = p_estado WHERE id = p_tenant_id;

  PERFORM fsj.plataforma_auditar(v_actor,
    CASE WHEN p_estado = 'SUSPENDIDO' THEN 'TENANT_SUSPENDER' ELSE 'TENANT_REACTIVAR' END,
    'tenant', p_tenant_id, p_tenant_id,
    jsonb_build_object('estado', v_anterior), jsonb_build_object('estado', p_estado),
    nullif(btrim(coalesce(p_motivo, '')), ''), p_ip, p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_cambiar_estado_tenant(text, uuid, fsj.estado_tenant, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_cambiar_estado_tenant(text, uuid, fsj.estado_tenant, text, text, text) TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.plataforma_editar_contacto_tenant(
  p_token_hash  text,
  p_tenant_id   uuid,
  p_nombre      text,
  p_email       text,
  p_telefono    text,
  p_ip          text,
  p_request_id  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_actor    uuid := fsj.plataforma_actor(p_token_hash);
  v_anterior jsonb;
BEGIN
  SELECT jsonb_build_object('contactoNombre', t.contacto_nombre, 'contactoEmail', t.contacto_email, 'contactoTelefono', t.contacto_telefono)
  INTO v_anterior FROM fsj.tenant t WHERE t.id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-PLAT-TENANT: la farmacia no existe' USING ERRCODE = 'P0001';
  END IF;

  UPDATE fsj.tenant SET contacto_nombre = p_nombre, contacto_email = p_email, contacto_telefono = p_telefono WHERE id = p_tenant_id;

  PERFORM fsj.plataforma_auditar(v_actor, 'TENANT_CONTACTO_EDITAR', 'tenant', p_tenant_id, p_tenant_id, v_anterior,
    jsonb_build_object('contactoNombre', p_nombre, 'contactoEmail', p_email, 'contactoTelefono', p_telefono),
    NULL, p_ip, p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_editar_contacto_tenant(text, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_editar_contacto_tenant(text, uuid, text, text, text, text, text) TO fsj_app;

-- List (spec P8). saldo is 0 here; migration 0126 replaces this function with the real one.
CREATE OR REPLACE FUNCTION fsj.plataforma_listar_tenants(p_token_hash text, p_busqueda text, p_limit integer, p_offset integer)
RETURNS TABLE (
  id               uuid,
  razon_social     text,
  nombre_fantasia  text,
  cuit             text,
  estado           fsj.estado_tenant,
  fecha_baja       timestamptz,
  saldo            numeric,
  total            bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_actor    uuid := fsj.plataforma_actor(p_token_hash);
  v_busqueda text := nullif(btrim(coalesce(p_busqueda, '')), '');
  -- What was typed, literally: % and _ escaped (ILIKE's default escape is the backslash).
  v_patron   text := '%' || replace(replace(replace(v_busqueda, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- CUIT compared by digits only, so "30-12345678" finds 30123456789 and the other way round.
  v_digitos  text := nullif(regexp_replace(coalesce(v_busqueda, ''), '[^0-9]', '', 'g'), '');
BEGIN
  RETURN QUERY
  SELECT t.id, t.razon_social, t.nombre_fantasia, t.cuit, t.estado, t.fecha_baja, 0::numeric, count(*) OVER ()
  FROM fsj.tenant t
  WHERE v_busqueda IS NULL
     OR t.razon_social ILIKE v_patron
     OR t.nombre_fantasia ILIKE v_patron
     OR (v_digitos IS NOT NULL AND regexp_replace(t.cuit, '[^0-9]', '', 'g') LIKE '%' || v_digitos || '%')
  ORDER BY t.razon_social, t.id
  LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_listar_tenants(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_listar_tenants(text, text, integer, integer) TO fsj_app;

-- Detail (spec P9): the tenant row without the logo bytes. Zero rows for an unknown id.
CREATE OR REPLACE FUNCTION fsj.plataforma_ver_tenant(p_token_hash text, p_tenant_id uuid)
RETURNS TABLE (
  id                  uuid,
  razon_social        text,
  nombre_fantasia     text,
  cuit                text,
  domicilio           text,
  matricula_farmacia  text,
  telefono_fijo       text,
  telefono_celular    text,
  zona_horaria        text,
  estado              fsj.estado_tenant,
  fecha_baja          timestamptz,
  creado_en           timestamptz,
  contacto_nombre     text,
  contacto_email      text,
  contacto_telefono   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := fsj.plataforma_actor(p_token_hash);
BEGIN
  RETURN QUERY
  SELECT t.id, t.razon_social, t.nombre_fantasia, t.cuit, t.domicilio, t.matricula_farmacia,
         t.telefono_fijo::text, t.telefono_celular::text, t.zona_horaria, t.estado, t.fecha_baja, t.creado_en,
         t.contacto_nombre, t.contacto_email::text, t.contacto_telefono::text
  FROM fsj.tenant t
  WHERE t.id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_ver_tenant(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_ver_tenant(text, uuid) TO fsj_app;

-- Platform history of one pharmacy (spec P9), newest first.
CREATE OR REPLACE FUNCTION fsj.plataforma_auditoria_tenant(p_token_hash text, p_tenant_id uuid, p_limit integer)
RETURNS TABLE (
  id                 uuid,
  ocurrido_en        timestamptz,
  accion             text,
  superadmin_nombre  text,
  valor_anterior     jsonb,
  valor_nuevo        jsonb,
  motivo             text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := fsj.plataforma_actor(p_token_hash);
BEGIN
  RETURN QUERY
  SELECT a.id, a.ocurrido_en, a.accion, s.nombre, a.valor_anterior, a.valor_nuevo, a.motivo
  FROM fsj.plataforma_auditoria a
  JOIN fsj.superadmin s ON s.id = a.superadmin_id
  WHERE a.tenant_id = p_tenant_id
  ORDER BY a.ocurrido_en DESC, a.id
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_auditoria_tenant(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_auditoria_tenant(text, uuid, integer) TO fsj_app;

-- ============================================================================
-- 4. Unused platform permisos (D18)
-- ============================================================================
-- 'sistema' permisos are never in a role (modules/auth/domain/permisos.ts#PERMISOS_FUERA_DE_ROLES), so these deletes
-- remove no grant anyone has; they are explicit anyway so the FK cannot block the catalog delete.
DELETE FROM fsj.rol_permiso rp USING fsj.permiso p
WHERE rp.permiso_id = p.id AND p.codigo IN ('tenants.crear', 'tenants.editar', 'tenants.baja');
DELETE FROM fsj.accion_con_pin a USING fsj.permiso p
WHERE a.permiso_id = p.id AND p.codigo IN ('tenants.crear', 'tenants.editar', 'tenants.baja');
DELETE FROM fsj.permiso WHERE codigo IN ('tenants.crear', 'tenants.editar', 'tenants.baja');

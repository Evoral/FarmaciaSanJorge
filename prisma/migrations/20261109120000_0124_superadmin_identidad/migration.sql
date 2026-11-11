-- 0124 -- Superadmin identity, platform sessions and platform audit (openspec/specs/plataforma/spec.md, stage 1).
--
-- The superadmin (platform operator, DP-37) is NOT a fsj.usuario: it has no tenant, so no tenant RLS policy ever
-- reaches it and no policy "or is superadmin" is ever written (spec P1). Its three tables are closed to fsj_app:
-- RLS enabled + forced with a deny-all policy (the catalog guard requires a policy; this one documents that nobody
-- reads them through RLS) and every privilege revoked. The runtime reaches them ONLY through the SECURITY DEFINER
-- functions below, and every platform function past login receives the HASH of the session token and derives the actor
-- itself (fsj.plataforma_actor), so a forgotten guard in TS still fails here (spec P6).
--
-- Superadmins are created, reset and deactivated only by scripts/superadmin.ts with the owner credential (spec P2).
--
-- Email: unique across fsj.usuario and fsj.superadmin (spec P3), so one /login serves both. A collision raises
-- unique_violation with the usuario constraint's name, so a pharmacy Administrador creating a usuario gets the same
-- generic "ya existe" as for an email used in another pharmacy -- nothing tells it a superadmin has it.
-- No table lock: the race needs a superadmin created by the CLI and a usuario with the same email in the same instant.
--
-- Session lifecycle lives here only (spec P4): 8 h absolute (expira_en, set at creation), 15 min idle (ultimo_uso_en),
-- revoked (revocada_en), superadmin ACTIVO. Real now(), like the tenant sessions (fsj.sesion), not the test clock.
--
-- Code: modules/auth (login.ts superadmin branch, require-superadmin.ts), app/(auth)/login/actions.ts.
-- Apply together with that code: login() calls fsj.superadmin_resolve_login().
-- Rollback: prisma/rollbacks/0124_superadmin_identidad.down.sql (as a NEW forward migration, code reverted first).

DO $do$ BEGIN
  CREATE TYPE fsj.estado_superadmin AS ENUM ('ACTIVO', 'INACTIVO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================================
-- Tables
-- ============================================================================
CREATE TABLE fsj.superadmin (
  id                 uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  email              extensions.citext NOT NULL,
  nombre             text NOT NULL CHECK (length(btrim(nombre)) > 0),
  password_hash      text NOT NULL,
  estado             fsj.estado_superadmin NOT NULL DEFAULT 'ACTIVO',
  intentos_fallidos  integer NOT NULL DEFAULT 0,
  bloqueado_hasta    timestamptz,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  ultimo_acceso      timestamptz,
  CONSTRAINT superadmin_email_key UNIQUE (email)
);

COMMENT ON TABLE fsj.superadmin IS
  '0124. Platform operators (DP-37), outside every tenant. Closed to fsj_app (deny-all policy + no grants); reached only through the fsj.superadmin_* / fsj.plataforma_* SECURITY DEFINER functions. Rows are created only by scripts/superadmin.ts and never deleted (set INACTIVO).';

CREATE TABLE fsj.superadmin_sesion (
  id             uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  superadmin_id  uuid NOT NULL REFERENCES fsj.superadmin (id),
  token_hash     text NOT NULL,
  creada_en      timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_en  timestamptz NOT NULL DEFAULT now(),
  expira_en      timestamptz NOT NULL,
  revocada_en    timestamptz,
  ip             text,
  user_agent     text,
  CONSTRAINT superadmin_sesion_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX superadmin_sesion_superadmin_idx ON fsj.superadmin_sesion (superadmin_id);

COMMENT ON TABLE fsj.superadmin_sesion IS
  '0124. Platform sessions: SHA-256 of an opaque token (cookie fsj_plataforma, Path=/plataforma). Lifecycle checked only by fsj.plataforma_actor(): 8 h absolute, 15 min idle, revocada_en, superadmin ACTIVO.';

CREATE TABLE fsj.plataforma_auditoria (
  id              uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  superadmin_id   uuid NOT NULL REFERENCES fsj.superadmin (id),
  accion          text NOT NULL,
  entidad         text NOT NULL,
  entidad_id      uuid NOT NULL,
  tenant_id       uuid REFERENCES fsj.tenant (id),
  valor_anterior  jsonb,
  valor_nuevo     jsonb,
  motivo          text,
  ip              text,
  request_id      text,
  ocurrido_en     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plataforma_auditoria_accion_check CHECK (accion IN (
    'LOGIN', 'LOGIN_BLOQUEO', 'LOGOUT',
    'TENANT_CREAR', 'TENANT_SUSPENDER', 'TENANT_REACTIVAR', 'TENANT_CONTACTO_EDITAR',
    'CARGO_REGISTRAR', 'CARGO_ANULAR', 'PAGO_REGISTRAR', 'PAGO_ANULAR'
  ))
);

CREATE INDEX plataforma_auditoria_tenant_idx ON fsj.plataforma_auditoria (tenant_id, ocurrido_en DESC);
CREATE INDEX plataforma_auditoria_superadmin_idx ON fsj.plataforma_auditoria (superadmin_id, ocurrido_en DESC);

COMMENT ON TABLE fsj.plataforma_auditoria IS
  '0124. Immutable audit of every platform write and superadmin login/lockout/logout (spec P7), written by the same SECURITY DEFINER function in the same transaction. fsj.registro_auditoria cannot hold it: it requires a tenant and a fsj.usuario. Never holds a password or its hash.';

-- ============================================================================
-- Closed to the runtime: RLS forced + deny-all policy + no privileges
-- ============================================================================
DO $do$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['superadmin', 'superadmin_sesion', 'plataforma_auditoria'] LOOP
    EXECUTE format('ALTER TABLE fsj.%I ENABLE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('ALTER TABLE fsj.%I FORCE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS plataforma_sin_acceso ON fsj.%I', v_tabla);
    EXECUTE format('CREATE POLICY plataforma_sin_acceso ON fsj.%I USING (false) WITH CHECK (false)', v_tabla);
    EXECUTE format('REVOKE ALL ON TABLE fsj.%I FROM PUBLIC, fsj_app', v_tabla);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE fsj.%I FROM anon', v_tabla);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE fsj.%I FROM authenticated', v_tabla);
    END IF;
  END LOOP;
END
$do$;

-- A superadmin is never deleted (its audit rows point at it); the audit is append-only.
CREATE TRIGGER trg_superadmin_forbid_delete BEFORE DELETE ON fsj.superadmin
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();
CREATE TRIGGER trg_superadmin_forbid_truncate BEFORE TRUNCATE ON fsj.superadmin
  FOR EACH STATEMENT EXECUTE FUNCTION fsj.forbid_truncate();
CREATE TRIGGER trg_plataforma_auditoria_forbid_update_delete BEFORE UPDATE OR DELETE ON fsj.plataforma_auditoria
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();
CREATE TRIGGER trg_plataforma_auditoria_forbid_truncate BEFORE TRUNCATE ON fsj.plataforma_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION fsj.forbid_truncate();

-- ============================================================================
-- Email unique across fsj.usuario and fsj.superadmin (spec P3)
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.email_login_unico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
BEGIN
  IF TG_TABLE_NAME = 'usuario' THEN
    IF EXISTS (SELECT 1 FROM fsj.superadmin WHERE email = NEW.email) THEN
      RAISE EXCEPTION 'duplicate key value violates unique constraint "usuario_email_key"'
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'usuario_email_key';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM fsj.usuario WHERE email = NEW.email) THEN
    RAISE EXCEPTION 'duplicate key value violates unique constraint "superadmin_email_key"'
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'superadmin_email_key';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.email_login_unico() IS
  '0124. BEFORE INSERT OR UPDATE OF email on fsj.usuario and fsj.superadmin: an email can log in as one kind only (spec P3). Raises unique_violation named after the table''s own email constraint, never revealing the other table.';

REVOKE ALL ON FUNCTION fsj.email_login_unico() FROM PUBLIC, fsj_app;

CREATE TRIGGER trg_usuario_email_login_unico BEFORE INSERT OR UPDATE OF email ON fsj.usuario
  FOR EACH ROW EXECUTE FUNCTION fsj.email_login_unico();
CREATE TRIGGER trg_superadmin_email_login_unico BEFORE INSERT OR UPDATE OF email ON fsj.superadmin
  FOR EACH ROW EXECUTE FUNCTION fsj.email_login_unico();

-- ============================================================================
-- Login (called by modules/auth/application/login.ts only when no usuario matched)
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.superadmin_resolve_login(p_email text)
RETURNS TABLE (
  superadmin_id      uuid,
  password_hash      text,
  estado             fsj.estado_superadmin,
  intentos_fallidos  integer,
  bloqueado_hasta    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
  SELECT id, password_hash, estado, intentos_fallidos, bloqueado_hasta
  FROM fsj.superadmin
  WHERE email = p_email::extensions.citext;
$$;

COMMENT ON FUNCTION fsj.superadmin_resolve_login(text) IS
  '0124. Same shape and purpose as fsj.usuario_resolve_login (0010), for a superadmin. Zero rows for an unknown email.';

REVOKE ALL ON FUNCTION fsj.superadmin_resolve_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.superadmin_resolve_login(text) TO fsj_app;

-- Records an audit row. Internal: every caller has already validated the actor.
CREATE OR REPLACE FUNCTION fsj.plataforma_auditar(
  p_superadmin_id  uuid,
  p_accion         text,
  p_entidad        text,
  p_entidad_id     uuid,
  p_tenant_id      uuid,
  p_valor_anterior jsonb,
  p_valor_nuevo    jsonb,
  p_motivo         text,
  p_ip             text,
  p_request_id     text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
  INSERT INTO fsj.plataforma_auditoria
    (superadmin_id, accion, entidad, entidad_id, tenant_id, valor_anterior, valor_nuevo, motivo, ip, request_id)
  VALUES
    (p_superadmin_id, p_accion, p_entidad, p_entidad_id, p_tenant_id, p_valor_anterior, p_valor_nuevo, p_motivo, p_ip, p_request_id);
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_auditar(uuid, text, text, uuid, uuid, jsonb, jsonb, text, text, text) FROM PUBLIC, fsj_app;

-- Correct password already verified by the caller (argon2 runs in Node, like the tenant login). Re-checks ACTIVO and
-- the lockout, resets the counters, creates the session and audits LOGIN. Returns the absolute expiry for the cookie.
CREATE OR REPLACE FUNCTION fsj.plataforma_iniciar_sesion(
  p_superadmin_id  uuid,
  p_token_hash     text,
  p_ip             text,
  p_user_agent     text,
  p_request_id     text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_superadmin fsj.superadmin%ROWTYPE;
  v_sesion_id  uuid;
  v_expira_en  timestamptz := now() + interval '8 hours';
BEGIN
  SELECT * INTO v_superadmin FROM fsj.superadmin WHERE id = p_superadmin_id FOR UPDATE;
  IF NOT FOUND
     OR v_superadmin.estado <> 'ACTIVO'
     OR (v_superadmin.bloqueado_hasta IS NOT NULL AND v_superadmin.bloqueado_hasta > now()) THEN
    RAISE EXCEPTION 'INV-PLAT-AUTH: el superadmin no puede iniciar sesión' USING ERRCODE = 'P0001';
  END IF;

  UPDATE fsj.superadmin
  SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now()
  WHERE id = p_superadmin_id;

  INSERT INTO fsj.superadmin_sesion (superadmin_id, token_hash, expira_en, ip, user_agent)
  VALUES (p_superadmin_id, p_token_hash, v_expira_en, p_ip, p_user_agent)
  RETURNING id INTO v_sesion_id;

  PERFORM fsj.plataforma_auditar(p_superadmin_id, 'LOGIN', 'superadmin_sesion', v_sesion_id, NULL, NULL, NULL, NULL, p_ip, p_request_id);
  RETURN v_expira_en;
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_iniciar_sesion(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_iniciar_sesion(uuid, text, text, text, text) TO fsj_app;

-- Wrong password for a live superadmin: same counter rule as modules/auth/infrastructure/usuario-repository.ts
-- #recordLoginFailure. Audits LOGIN_BLOQUEO when this failure reaches p_max_intentos.
CREATE OR REPLACE FUNCTION fsj.plataforma_login_fallido(
  p_superadmin_id   uuid,
  p_max_intentos    integer,
  p_bloqueado_hasta timestamptz,
  p_ip              text,
  p_request_id      text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_intentos integer;
BEGIN
  UPDATE fsj.superadmin
  SET intentos_fallidos = intentos_fallidos + 1,
      bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= p_max_intentos THEN p_bloqueado_hasta ELSE NULL END
  WHERE id = p_superadmin_id
  RETURNING intentos_fallidos INTO v_intentos;

  IF v_intentos IS NULL THEN
    RETURN 0;
  END IF;

  IF v_intentos >= p_max_intentos THEN
    PERFORM fsj.plataforma_auditar(p_superadmin_id, 'LOGIN_BLOQUEO', 'superadmin', p_superadmin_id, NULL, NULL, NULL,
      format('Bloqueo tras %s intentos fallidos consecutivos.', v_intentos), p_ip, p_request_id);
  END IF;
  RETURN v_intentos;
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_login_fallido(uuid, integer, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_login_fallido(uuid, integer, timestamptz, text, text) TO fsj_app;

-- ============================================================================
-- Session validation: the actor of every platform function
-- ============================================================================
-- Internal (no EXECUTE for fsj_app): raises INV-PLAT-AUTH unless the token's session is live and its superadmin
-- ACTIVO; touches ultimo_uso_en at most once a minute. Every fsj.plataforma_* function past login calls it first.
CREATE OR REPLACE FUNCTION fsj.plataforma_actor(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_sesion_id      uuid;
  v_superadmin_id  uuid;
  v_ultimo_uso_en  timestamptz;
BEGIN
  SELECT s.id, s.superadmin_id, s.ultimo_uso_en
  INTO v_sesion_id, v_superadmin_id, v_ultimo_uso_en
  FROM fsj.superadmin_sesion s
  JOIN fsj.superadmin a ON a.id = s.superadmin_id
  WHERE s.token_hash = p_token_hash
    AND s.revocada_en IS NULL
    AND s.expira_en > now()
    AND s.ultimo_uso_en > now() - interval '15 minutes'
    AND a.estado = 'ACTIVO';

  IF v_sesion_id IS NULL THEN
    RAISE EXCEPTION 'INV-PLAT-AUTH: sesión de plataforma inválida' USING ERRCODE = 'P0001';
  END IF;

  IF v_ultimo_uso_en < now() - interval '1 minute' THEN
    UPDATE fsj.superadmin_sesion SET ultimo_uso_en = now() WHERE id = v_sesion_id;
  END IF;

  RETURN v_superadmin_id;
END;
$$;

COMMENT ON FUNCTION fsj.plataforma_actor(text) IS
  '0124. The platform actor (spec P6): superadmin id of a live session, or INV-PLAT-AUTH. Internal: not executable by fsj_app; called by every fsj.plataforma_* function past login.';

REVOKE ALL ON FUNCTION fsj.plataforma_actor(text) FROM PUBLIC, fsj_app;

-- For requireSuperAdmin(): the identity of a live session, zero rows otherwise (never raises for a bad token).
CREATE OR REPLACE FUNCTION fsj.plataforma_validar_sesion(p_token_hash text)
RETURNS TABLE (superadmin_id uuid, email text, nombre text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_superadmin_id uuid;
BEGIN
  BEGIN
    v_superadmin_id := fsj.plataforma_actor(p_token_hash);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    -- Only the "no live session" answer becomes zero rows; any other error propagates.
    IF SQLERRM NOT LIKE 'INV-PLAT-AUTH:%' THEN
      RAISE;
    END IF;
    RETURN;
  END;

  RETURN QUERY SELECT a.id, a.email::text, a.nombre FROM fsj.superadmin a WHERE a.id = v_superadmin_id;
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_validar_sesion(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_validar_sesion(text) TO fsj_app;

-- Logout: revokes the session and audits LOGOUT. A token that is no longer live is a no-op (logout never fails).
CREATE OR REPLACE FUNCTION fsj.plataforma_cerrar_sesion(p_token_hash text, p_ip text, p_request_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_sesion_id      uuid;
  v_superadmin_id  uuid;
BEGIN
  UPDATE fsj.superadmin_sesion
  SET revocada_en = now()
  WHERE token_hash = p_token_hash AND revocada_en IS NULL
  RETURNING id, superadmin_id INTO v_sesion_id, v_superadmin_id;

  IF v_sesion_id IS NOT NULL THEN
    PERFORM fsj.plataforma_auditar(v_superadmin_id, 'LOGOUT', 'superadmin_sesion', v_sesion_id, NULL, NULL, NULL, NULL, p_ip, p_request_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_cerrar_sesion(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_cerrar_sesion(text, text, text) TO fsj_app;

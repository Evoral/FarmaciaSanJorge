-- 0126 -- Cuenta corriente of each pharmacy with the platform (openspec/changes/plataforma-superadmin, stage 4; spec
-- P13-P16).
--
--   1. fsj.plataforma_cargo (período, monto, concepto) and fsj.plataforma_pago (fecha, monto, medio, nota, envio_id).
--      ARS only, numeric(14,2), monto > 0. Closed to fsj_app like the 0124 tables (forced RLS, deny-all policy, no
--      grants); reached only through the functions below.
--   2. Nothing is deleted: forbid_delete + forbid_truncate. The only UPDATE allowed is the anulación, once: the three
--      anulación columns go from NULL to a value and every other column stays (fsj.plataforma_movimiento_solo_anular).
--   3. Two non-anulados cargos never share pharmacy, período and concepto; a pago's envio_id (one per form instance,
--      like openspec/specs/alta-receta-idempotente) makes a repeated submit write nothing.
--   4. Saldo = non-anulados cargos minus non-anulados pagos, computed on every read, never stored (P16).
--      fsj.plataforma_listar_tenants (0125) is replaced to return it.
--
-- "Not in the future" for a pago's fecha: today in America/Argentina/Buenos_Aires by fsj.instante_actual() (0026),
-- so the test clock applies.
-- Code: modules/plataforma (cuenta corriente use cases and UI). Apply together with it.
-- Rollback: prisma/rollbacks/0126_cuenta_corriente.down.sql (as a NEW forward migration; it DROPS every cargo and pago).

DO $do$ BEGIN
  CREATE TYPE fsj.medio_pago_plataforma AS ENUM ('TRANSFERENCIA', 'EFECTIVO', 'MERCADO_PAGO', 'OTRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================================
-- 1. Tables
-- ============================================================================
CREATE TABLE fsj.plataforma_cargo (
  id                uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES fsj.tenant (id),
  periodo           date NOT NULL CHECK (extract(day FROM periodo) = 1),
  monto             numeric(14,2) NOT NULL CHECK (monto > 0),
  concepto          text NOT NULL CHECK (length(btrim(concepto)) BETWEEN 1 AND 200),
  creado_por_id     uuid NOT NULL REFERENCES fsj.superadmin (id),
  creado_en         timestamptz NOT NULL DEFAULT now(),
  anulado_en        timestamptz,
  anulado_por_id    uuid REFERENCES fsj.superadmin (id),
  motivo_anulacion  text,
  CONSTRAINT plataforma_cargo_anulacion_check CHECK (
    (anulado_en IS NULL) = (anulado_por_id IS NULL) AND (anulado_en IS NULL) = (motivo_anulacion IS NULL)
  )
);

CREATE INDEX plataforma_cargo_tenant_idx ON fsj.plataforma_cargo (tenant_id, periodo);
CREATE UNIQUE INDEX plataforma_cargo_unico ON fsj.plataforma_cargo (tenant_id, periodo, lower(btrim(concepto)))
  WHERE anulado_en IS NULL;

COMMENT ON TABLE fsj.plataforma_cargo IS
  '0126 (spec P13). A charge to a pharmacy for a month (periodo = its first day). Never deleted; anulado once. Closed to fsj_app.';

CREATE TABLE fsj.plataforma_pago (
  id                uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES fsj.tenant (id),
  fecha             date NOT NULL,
  monto             numeric(14,2) NOT NULL CHECK (monto > 0),
  medio             fsj.medio_pago_plataforma NOT NULL,
  nota              text CHECK (nota IS NULL OR length(nota) <= 500),
  envio_id          uuid NOT NULL,
  creado_por_id     uuid NOT NULL REFERENCES fsj.superadmin (id),
  creado_en         timestamptz NOT NULL DEFAULT now(),
  anulado_en        timestamptz,
  anulado_por_id    uuid REFERENCES fsj.superadmin (id),
  motivo_anulacion  text,
  CONSTRAINT plataforma_pago_envio_id_key UNIQUE (envio_id),
  CONSTRAINT plataforma_pago_anulacion_check CHECK (
    (anulado_en IS NULL) = (anulado_por_id IS NULL) AND (anulado_en IS NULL) = (motivo_anulacion IS NULL)
  )
);

CREATE INDEX plataforma_pago_tenant_idx ON fsj.plataforma_pago (tenant_id, fecha);

COMMENT ON TABLE fsj.plataforma_pago IS
  '0126 (spec P14). A payment of a pharmacy. envio_id = one per form instance: a repeated submit writes nothing. Never deleted; anulado once. Closed to fsj_app.';

DO $do$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['plataforma_cargo', 'plataforma_pago'] LOOP
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

-- ============================================================================
-- 2. Append-only, anulación once
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.plataforma_movimiento_solo_anular()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = fsj, extensions
AS $$
BEGIN
  IF OLD.anulado_en IS NOT NULL THEN
    RAISE EXCEPTION 'INV-PLAT-ANULADO: el movimiento ya está anulado' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.anulado_en IS NULL
     OR to_jsonb(NEW) - ARRAY['anulado_en', 'anulado_por_id', 'motivo_anulacion']
        IS DISTINCT FROM to_jsonb(OLD) - ARRAY['anulado_en', 'anulado_por_id', 'motivo_anulacion'] THEN
    RAISE EXCEPTION 'INV-PLAT-INMUTABLE: un cargo o pago solo se puede anular' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.plataforma_movimiento_solo_anular() IS
  '0126 (spec P15). BEFORE UPDATE on plataforma_cargo / plataforma_pago: only the NULL -> value transition of anulado_en, anulado_por_id and motivo_anulacion.';

REVOKE ALL ON FUNCTION fsj.plataforma_movimiento_solo_anular() FROM PUBLIC, fsj_app;

DO $do$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['plataforma_cargo', 'plataforma_pago'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_solo_anular BEFORE UPDATE ON fsj.%I FOR EACH ROW EXECUTE FUNCTION fsj.plataforma_movimiento_solo_anular()', v_tabla, v_tabla);
    EXECUTE format('CREATE TRIGGER trg_%s_forbid_delete BEFORE DELETE ON fsj.%I FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete()', v_tabla, v_tabla);
    EXECUTE format('CREATE TRIGGER trg_%s_forbid_truncate BEFORE TRUNCATE ON fsj.%I FOR EACH STATEMENT EXECUTE FUNCTION fsj.forbid_truncate()', v_tabla, v_tabla);
  END LOOP;
END
$do$;

-- ============================================================================
-- 3. Functions
-- ============================================================================
-- Internal: saldo of one pharmacy (P16). Positive = the pharmacy owes.
CREATE OR REPLACE FUNCTION fsj.plataforma_saldo_tenant(p_tenant_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
  SELECT (coalesce((SELECT sum(c.monto) FROM fsj.plataforma_cargo c WHERE c.tenant_id = p_tenant_id AND c.anulado_en IS NULL), 0)
        - coalesce((SELECT sum(p.monto) FROM fsj.plataforma_pago p WHERE p.tenant_id = p_tenant_id AND p.anulado_en IS NULL), 0))::numeric(14,2);
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_saldo_tenant(uuid) FROM PUBLIC, fsj_app;

-- Internal: refuse a tenant id that does not exist (the FK would too, with an unreadable message).
CREATE OR REPLACE FUNCTION fsj.plataforma_exigir_tenant(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fsj.tenant t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'INV-PLAT-TENANT: la farmacia no existe' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_exigir_tenant(uuid) FROM PUBLIC, fsj_app;

CREATE OR REPLACE FUNCTION fsj.plataforma_registrar_cargo(
  p_token_hash  text,
  p_tenant_id   uuid,
  p_periodo     date,
  p_monto       numeric,
  p_concepto    text,
  p_ip          text,
  p_request_id  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_actor    uuid := fsj.plataforma_actor(p_token_hash);
  v_periodo  date := date_trunc('month', p_periodo)::date;
  v_id       uuid;
BEGIN
  PERFORM fsj.plataforma_exigir_tenant(p_tenant_id);
  BEGIN
    INSERT INTO fsj.plataforma_cargo (tenant_id, periodo, monto, concepto, creado_por_id)
    VALUES (p_tenant_id, v_periodo, p_monto, btrim(p_concepto), v_actor)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'INV-PLAT-CARGO-DUPLICADO: ya hay un cargo con ese período y concepto' USING ERRCODE = 'P0001';
  END;

  PERFORM fsj.plataforma_auditar(v_actor, 'CARGO_REGISTRAR', 'plataforma_cargo', v_id, p_tenant_id, NULL,
    jsonb_build_object('periodo', v_periodo, 'monto', p_monto, 'concepto', btrim(p_concepto)), NULL, p_ip, p_request_id);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_registrar_cargo(text, uuid, date, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_registrar_cargo(text, uuid, date, numeric, text, text, text) TO fsj_app;

-- A repeated envio_id returns the pago it already created and writes (and audits) nothing.
CREATE OR REPLACE FUNCTION fsj.plataforma_registrar_pago(
  p_token_hash  text,
  p_tenant_id   uuid,
  p_fecha       date,
  p_monto       numeric,
  p_medio       fsj.medio_pago_plataforma,
  p_nota        text,
  p_envio_id    uuid,
  p_ip          text,
  p_request_id  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_actor      uuid := fsj.plataforma_actor(p_token_hash);
  v_existente  record;
  v_id         uuid;
BEGIN
  SELECT p.id, p.tenant_id INTO v_existente FROM fsj.plataforma_pago p WHERE p.envio_id = p_envio_id;
  IF FOUND THEN
    IF v_existente.tenant_id IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION 'INV-PLAT-ENVIO: ese envío ya se usó para otra farmacia' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existente.id;
  END IF;

  PERFORM fsj.plataforma_exigir_tenant(p_tenant_id);
  IF p_fecha > (fsj.instante_actual() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN
    RAISE EXCEPTION 'INV-PLAT-FECHA-FUTURA: la fecha del pago no puede ser posterior a hoy' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO fsj.plataforma_pago (tenant_id, fecha, monto, medio, nota, envio_id, creado_por_id)
    VALUES (p_tenant_id, p_fecha, p_monto, p_medio, nullif(btrim(coalesce(p_nota, '')), ''), p_envio_id, v_actor)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- The same envio_id committed by a concurrent submit in the meantime.
    SELECT p.id INTO v_id FROM fsj.plataforma_pago p WHERE p.envio_id = p_envio_id AND p.tenant_id = p_tenant_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'INV-PLAT-ENVIO: ese envío ya se usó para otra farmacia' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_id;
  END;

  PERFORM fsj.plataforma_auditar(v_actor, 'PAGO_REGISTRAR', 'plataforma_pago', v_id, p_tenant_id, NULL,
    jsonb_build_object('fecha', p_fecha, 'monto', p_monto, 'medio', p_medio, 'nota', nullif(btrim(coalesce(p_nota, '')), '')),
    NULL, p_ip, p_request_id);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_registrar_pago(text, uuid, date, numeric, fsj.medio_pago_plataforma, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_registrar_pago(text, uuid, date, numeric, fsj.medio_pago_plataforma, text, uuid, text, text) TO fsj_app;

-- Anular a cargo or a pago (P15). p_tipo: 'CARGO' | 'PAGO'. The trigger refuses an already anulado one.
CREATE OR REPLACE FUNCTION fsj.plataforma_anular_movimiento(
  p_token_hash  text,
  p_tipo        text,
  p_id          uuid,
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
  v_motivo     text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_tenant_id  uuid;
  v_anulado_en timestamptz;
BEGIN
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'INV-PLAT-MOTIVO: falta el motivo' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'CARGO' THEN
    SELECT c.tenant_id, c.anulado_en INTO v_tenant_id, v_anulado_en FROM fsj.plataforma_cargo c WHERE c.id = p_id FOR UPDATE;
  ELSIF p_tipo = 'PAGO' THEN
    SELECT p.tenant_id, p.anulado_en INTO v_tenant_id, v_anulado_en FROM fsj.plataforma_pago p WHERE p.id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'INV-PLAT-MOVIMIENTO: tipo de movimiento desconocido' USING ERRCODE = 'P0001';
  END IF;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'INV-PLAT-MOVIMIENTO: el movimiento no existe' USING ERRCODE = 'P0001';
  END IF;
  IF v_anulado_en IS NOT NULL THEN
    RAISE EXCEPTION 'INV-PLAT-ANULADO: el movimiento ya está anulado' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'CARGO' THEN
    UPDATE fsj.plataforma_cargo SET anulado_en = now(), anulado_por_id = v_actor, motivo_anulacion = v_motivo WHERE id = p_id;
  ELSE
    UPDATE fsj.plataforma_pago SET anulado_en = now(), anulado_por_id = v_actor, motivo_anulacion = v_motivo WHERE id = p_id;
  END IF;

  PERFORM fsj.plataforma_auditar(v_actor, CASE WHEN p_tipo = 'CARGO' THEN 'CARGO_ANULAR' ELSE 'PAGO_ANULAR' END,
    CASE WHEN p_tipo = 'CARGO' THEN 'plataforma_cargo' ELSE 'plataforma_pago' END, p_id, v_tenant_id,
    NULL, NULL, v_motivo, p_ip, p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_anular_movimiento(text, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_anular_movimiento(text, text, uuid, text, text, text) TO fsj_app;

-- The cuenta corriente of one pharmacy: cargos (dated by período) and pagos (by fecha) as one list, oldest first,
-- plus the saldo on every row (the same value: one round trip for the detail page).
CREATE OR REPLACE FUNCTION fsj.plataforma_cuenta_corriente(p_token_hash text, p_tenant_id uuid)
RETURNS TABLE (
  tipo              text,
  id                uuid,
  fecha             date,
  descripcion       text,
  medio             text,
  monto             numeric,
  creado_en         timestamptz,
  creado_por        text,
  anulado_en        timestamptz,
  anulado_por       text,
  motivo_anulacion  text,
  saldo             numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := fsj.plataforma_actor(p_token_hash);
  v_saldo numeric := fsj.plataforma_saldo_tenant(p_tenant_id);
BEGIN
  RETURN QUERY
  SELECT m.tipo, m.id, m.fecha, m.descripcion, m.medio, m.monto, m.creado_en, cs.nombre, m.anulado_en, an.nombre, m.motivo_anulacion, v_saldo
  FROM (
    SELECT 'CARGO'::text AS tipo, c.id, c.periodo AS fecha, c.concepto AS descripcion, NULL::text AS medio, c.monto,
           c.creado_en, c.creado_por_id, c.anulado_en, c.anulado_por_id, c.motivo_anulacion
    FROM fsj.plataforma_cargo c WHERE c.tenant_id = p_tenant_id
    UNION ALL
    SELECT 'PAGO'::text, p.id, p.fecha, p.nota, p.medio::text, p.monto,
           p.creado_en, p.creado_por_id, p.anulado_en, p.anulado_por_id, p.motivo_anulacion
    FROM fsj.plataforma_pago p WHERE p.tenant_id = p_tenant_id
  ) m
  JOIN fsj.superadmin cs ON cs.id = m.creado_por_id
  LEFT JOIN fsj.superadmin an ON an.id = m.anulado_por_id
  ORDER BY m.fecha, m.creado_en, m.id;
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_cuenta_corriente(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_cuenta_corriente(text, uuid) TO fsj_app;

-- Saldo of one pharmacy, for the detail page when it has no movements yet (0,00).
CREATE OR REPLACE FUNCTION fsj.plataforma_saldo(p_token_hash text, p_tenant_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_actor uuid := fsj.plataforma_actor(p_token_hash);
BEGIN
  RETURN fsj.plataforma_saldo_tenant(p_tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION fsj.plataforma_saldo(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_saldo(text, uuid) TO fsj_app;

-- 0125's list, now with the real saldo.
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
  v_patron   text := '%' || replace(replace(replace(v_busqueda, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_digitos  text := nullif(regexp_replace(coalesce(v_busqueda, ''), '[^0-9]', '', 'g'), '');
BEGIN
  RETURN QUERY
  SELECT f.id, f.razon_social, f.nombre_fantasia, f.cuit, f.estado, f.fecha_baja, fsj.plataforma_saldo_tenant(f.id), f.total
  FROM (
    SELECT t.id, t.razon_social, t.nombre_fantasia, t.cuit, t.estado, t.fecha_baja, count(*) OVER () AS total
    FROM fsj.tenant t
    WHERE v_busqueda IS NULL
       OR t.razon_social ILIKE v_patron
       OR t.nombre_fantasia ILIKE v_patron
       OR (v_digitos IS NOT NULL AND regexp_replace(t.cuit, '[^0-9]', '', 'g') LIKE '%' || v_digitos || '%')
    ORDER BY t.razon_social, t.id
    LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)
    OFFSET greatest(coalesce(p_offset, 0), 0)
  ) f
  ORDER BY f.razon_social, f.id;
END;
$$;

-- 0015_cierre_diario
--
-- FASE 1, point 1.13 (M13a only -- M13b/libro rubricado folios stay
-- DEFERRED, DP-38; no foja_inutilizada). Depends on 0005 (fsj.es_dt_vigente),
-- 0014 (fsj.jornada_actual, fsj.asiento_recetario, fsj.asiento_contralor).
--
-- DP-18/DP-18c are open (exact firma deadline; motivo_demora enum values).
-- Per task instructions: assume "the same jornada ends at midnight in the
-- tenant's own time zone" (i.e. fuera_de_termino = signing after the
-- calendar day p_fecha has already passed in the tenant's zona_horaria),
-- isolated in ONE function (fsj.cierre_diario_calcular_fuera_de_termino)
-- so it is trivial to revisit once DP-18 resolves. motivo_demora is a
-- plain text column, NOT an enum (DP-18c open) -- task instruction.
--
-- The entire "firmar cierre" operation is a single SECURITY DEFINER
-- function, fsj.cierre_diario_firmar(), rather than a plain INSERT grant
-- to fsj_app -- this is what lets the DB (not an app-layer convention)
-- guarantee INV-C02 (every VIGENTE asiento AND asiento_contralor of the
-- jornada gets linked, atomically, in the SAME transaction that creates
-- the cierre row) and INV-C20 (fecha_firma is always now(), never
-- client-supplied). fsj_app has NO INSERT grant on fsj.cierre_diario at
-- all -- see the grants section at the bottom.

-- ============================================================================
-- cierre_diario (M13a)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.cierre_diario (
  id                    uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  fecha                 date NOT NULL,
  director_tecnico_id   uuid NOT NULL,
  designacion_id        uuid NOT NULL,
  matricula_dt          text NOT NULL,        -- snapshot, frozen at signing time
  cantidad_asientos     integer NOT NULL,
  hash_lote             text NOT NULL,        -- INV-C05
  sello_tiempo          timestamptz NOT NULL DEFAULT now(),
  mecanismo_firma       text NOT NULL DEFAULT 'CREDENCIALES_DT', -- PROPUESTA minimal: re-auth with the DT's own credentials (DP-19, TSA/firma digital, is out of scope)
  version_formato       integer NOT NULL DEFAULT 1,
  fecha_impresion       timestamptz,
  impreso_por_id        uuid,
  fecha_firma           timestamptz NOT NULL DEFAULT now(), -- INV-C20: DB-set, never client-supplied
  fuera_de_termino      boolean NOT NULL,
  motivo_demora         text,     -- DP-18c open: plain text, not an enum -- see migration header
  motivo_demora_detalle text,
  PRIMARY KEY (id),
  CONSTRAINT cierre_diario_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT cierre_diario_fecha_unica UNIQUE (tenant_id, fecha), -- INV-C01
  CONSTRAINT cierre_diario_director_tecnico_fkey FOREIGN KEY (tenant_id, director_tecnico_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT cierre_diario_designacion_fkey FOREIGN KEY (tenant_id, designacion_id) REFERENCES fsj.designacion_director_tecnico (tenant_id, id),
  CONSTRAINT cierre_diario_impreso_por_fkey FOREIGN KEY (tenant_id, impreso_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT cierre_diario_cantidad_asientos_check CHECK (cantidad_asientos >= 0),
  -- INV-C18.
  CONSTRAINT cierre_diario_fuera_de_termino_check CHECK (NOT fuera_de_termino OR motivo_demora IS NOT NULL),
  -- fecha_impresion/impreso_por_id are set together (both or neither).
  CONSTRAINT cierre_diario_impresion_pair_check CHECK ((fecha_impresion IS NULL) = (impreso_por_id IS NULL))
);

COMMENT ON TABLE fsj.cierre_diario IS
  'M13a. INV-C04: immutable except fecha_impresion/impreso_por_id (NULL->value, once). No DELETE ever. Rows are created EXCLUSIVELY by fsj.cierre_diario_firmar() (SECURITY DEFINER) -- fsj_app has no direct INSERT grant, so fecha_firma/hash_lote/fuera_de_termino can never be forged by the app layer.';

SELECT fsj.setup_tenant_table('fsj.cierre_diario');

-- No INSERT/UPDATE/DELETE grant beyond the two impression columns -- see
-- migration header. ALTER DEFAULT PRIVILEGES would otherwise hand out
-- SELECT+INSERT; revoke INSERT explicitly (defense in depth/explicit intent).
REVOKE INSERT, DELETE, TRUNCATE ON fsj.cierre_diario FROM fsj_app;
GRANT UPDATE (fecha_impresion, impreso_por_id) ON fsj.cierre_diario TO fsj_app;

CREATE TRIGGER trg_cierre_diario_forbid_delete
  BEFORE DELETE ON fsj.cierre_diario
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

CREATE OR REPLACE FUNCTION fsj.cierre_diario_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.fecha IS DISTINCT FROM OLD.fecha
     OR NEW.director_tecnico_id IS DISTINCT FROM OLD.director_tecnico_id
     OR NEW.designacion_id IS DISTINCT FROM OLD.designacion_id
     OR NEW.matricula_dt IS DISTINCT FROM OLD.matricula_dt
     OR NEW.cantidad_asientos IS DISTINCT FROM OLD.cantidad_asientos
     OR NEW.hash_lote IS DISTINCT FROM OLD.hash_lote
     OR NEW.sello_tiempo IS DISTINCT FROM OLD.sello_tiempo
     OR NEW.mecanismo_firma IS DISTINCT FROM OLD.mecanismo_firma
     OR NEW.version_formato IS DISTINCT FROM OLD.version_formato
     OR NEW.fecha_firma IS DISTINCT FROM OLD.fecha_firma
     OR NEW.fuera_de_termino IS DISTINCT FROM OLD.fuera_de_termino
     OR NEW.motivo_demora IS DISTINCT FROM OLD.motivo_demora
     OR NEW.motivo_demora_detalle IS DISTINCT FROM OLD.motivo_demora_detalle
  THEN
    RAISE EXCEPTION 'INV-C04: cierre_diario rows are immutable except fecha_impresion/impreso_por_id' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.fecha_impresion IS NOT NULL AND NEW.fecha_impresion IS DISTINCT FROM OLD.fecha_impresion THEN
    RAISE EXCEPTION 'INV-C04: cierre_diario.fecha_impresion cannot change once set' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cierre_diario_validar_update
  BEFORE UPDATE ON fsj.cierre_diario
  FOR EACH ROW EXECUTE FUNCTION fsj.cierre_diario_validar_update();

-- ============================================================================
-- asiento_recetario/asiento_contralor.cierre_diario_id FKs (deferred from
-- migration 0014, which does not know about fsj.cierre_diario yet -- same
-- convention as migration 0013 adding movimiento_stock's preparacion FK).
-- ============================================================================
ALTER TABLE fsj.asiento_recetario
  ADD CONSTRAINT asiento_recetario_cierre_diario_fkey
  FOREIGN KEY (tenant_id, cierre_diario_id) REFERENCES fsj.cierre_diario (tenant_id, id);

ALTER TABLE fsj.asiento_contralor
  ADD CONSTRAINT asiento_contralor_cierre_diario_fkey
  FOREIGN KEY (tenant_id, cierre_diario_id) REFERENCES fsj.cierre_diario (tenant_id, id);

-- ============================================================================
-- INV-C03: no movimiento_stock may be dated (by jornada) into an already
-- signed jornada. Extends fsj.movimiento_stock_aplicar's BEFORE INSERT
-- companion trigger (fsj.movimiento_stock_validar_ajuste already runs
-- BEFORE INSERT; adding a dedicated trigger here keeps each check in its
-- own well-named function rather than growing an unrelated one).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.movimiento_stock_validar_jornada_abierta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fsj.cierre_diario
    WHERE tenant_id = NEW.tenant_id AND fecha = fsj.jornada_actual(NEW.tenant_id)
  ) THEN
    RAISE EXCEPTION 'INV-C03: cannot register a movimiento_stock -- jornada % is already signed', fsj.jornada_actual(NEW.tenant_id)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_movimiento_stock_validar_jornada_abierta
  BEFORE INSERT ON fsj.movimiento_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.movimiento_stock_validar_jornada_abierta();

-- ============================================================================
-- fsj.cierre_diario_calcular_fuera_de_termino: isolated per task
-- instruction (DP-18 open) -- "the same jornada ends at midnight in the
-- tenant's own time zone". Signing fecha=p_fecha is ON TIME as long as the
-- tenant's CURRENT jornada is still p_fecha (i.e. that calendar day, in
-- the tenant's zona_horaria, has not yet turned into the next one);
-- anything signed on a LATER jornada is late. Revisit this ONE function
-- once DP-18 resolves (e.g. a configurable grace period in days/hours).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.cierre_diario_calcular_fuera_de_termino(p_tenant_id uuid, p_fecha date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT fsj.jornada_actual(p_tenant_id) > p_fecha;
$$;

COMMENT ON FUNCTION fsj.cierre_diario_calcular_fuera_de_termino(uuid, date) IS
  'DP-18 OPEN -- deliberately simplistic placeholder rule (task instruction): fuera_de_termino iff the tenant''s CURRENT jornada is already later than p_fecha (i.e. midnight in zona_horaria has passed). Isolated here so revisiting DP-18 only touches this one function.';

-- ============================================================================
-- fsj.cierre_diario_firmar: THE signing transaction (INV-C01..C07,
-- C17..C20, U04). SECURITY DEFINER so it can write fsj.cierre_diario (no
-- direct grant to fsj_app) and set asiento_recetario/asiento_contralor's
-- cierre_diario_id (gated by the fsj.cierre session flag those tables'
-- validar_update triggers check -- migration 0014).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.cierre_diario_firmar(
  p_tenant_id uuid,
  p_fecha date,
  p_director_tecnico_id uuid,
  p_designacion_id uuid,
  p_motivo_demora text DEFAULT NULL,
  p_motivo_demora_detalle text DEFAULT NULL
)
RETURNS fsj.cierre_diario
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_matricula        text;
  v_fuera             boolean;
  v_hash_lote         text;
  v_cantidad          integer;
  v_cierre            fsj.cierre_diario%ROWTYPE;
BEGIN
  -- Serializes concurrent firmas for the SAME tenant (two DTs racing to
  -- sign, or two different fechas) -- held for the rest of this
  -- transaction (pg_advisory_XACT_lock).
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text));

  -- INV-U04: signer is a DT vigente AT cierre.fecha, via the SPECIFIC
  -- designacion supplied (also confirms it belongs to this director and
  -- tenant, and captures the matricula snapshot).
  SELECT matricula INTO v_matricula
  FROM fsj.designacion_director_tecnico
  WHERE tenant_id = p_tenant_id
    AND id = p_designacion_id
    AND usuario_id = p_director_tecnico_id
    AND vigente_desde <= p_fecha
    AND (vigente_hasta IS NULL OR vigente_hasta >= p_fecha);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-U04: usuario % / designacion % is not a DT vigente on %', p_director_tecnico_id, p_designacion_id, p_fecha
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-C01.
  IF EXISTS (SELECT 1 FROM fsj.cierre_diario WHERE tenant_id = p_tenant_id AND fecha = p_fecha) THEN
    RAISE EXCEPTION 'INV-C01: jornada % is already signed', p_fecha USING ERRCODE = 'P0001';
  END IF;

  -- INV-C19: strictly chronological. No unsigned VIGENTE asiento before
  -- p_fecha, and no cierre already exists for a LATER fecha.
  IF EXISTS (
    SELECT 1 FROM fsj.asiento_recetario
    WHERE tenant_id = p_tenant_id AND estado = 'VIGENTE' AND cierre_diario_id IS NULL AND fecha_asiento < p_fecha
  ) THEN
    RAISE EXCEPTION 'INV-C19: cannot sign % -- an earlier jornada still has unsigned asientos', p_fecha USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM fsj.cierre_diario WHERE tenant_id = p_tenant_id AND fecha > p_fecha) THEN
    RAISE EXCEPTION 'INV-C19: cannot sign % out of order -- a later jornada is already signed', p_fecha USING ERRCODE = 'P0001';
  END IF;

  -- INV-C18.
  v_fuera := fsj.cierre_diario_calcular_fuera_de_termino(p_tenant_id, p_fecha);
  IF v_fuera AND p_motivo_demora IS NULL THEN
    RAISE EXCEPTION 'INV-C18: signing % out of term requires motivo_demora', p_fecha USING ERRCODE = 'P0001';
  END IF;

  -- INV-C05/C19: hash_lote over the VIGENTE asientos of the fecha, in
  -- correlativo order.
  SELECT coalesce(string_agg(hash_integridad, chr(31) ORDER BY numero_correlativo), ''), count(*)
  INTO v_hash_lote, v_cantidad
  FROM fsj.asiento_recetario
  WHERE tenant_id = p_tenant_id AND fecha_asiento = p_fecha AND estado = 'VIGENTE' AND cierre_diario_id IS NULL;

  v_hash_lote := encode(extensions.digest('FSJ-CIERRE-V1' || chr(31) || v_hash_lote, 'sha256'), 'hex');

  INSERT INTO fsj.cierre_diario (
    tenant_id, fecha, director_tecnico_id, designacion_id, matricula_dt,
    cantidad_asientos, hash_lote, fuera_de_termino, motivo_demora, motivo_demora_detalle
  ) VALUES (
    p_tenant_id, p_fecha, p_director_tecnico_id, p_designacion_id, v_matricula,
    v_cantidad, v_hash_lote, v_fuera, p_motivo_demora, p_motivo_demora_detalle
  )
  RETURNING * INTO v_cierre;

  PERFORM set_config('fsj.cierre', 'on', true);

  -- INV-C02: link EVERY VIGENTE asiento (recetario) of the jornada.
  UPDATE fsj.asiento_recetario
  SET cierre_diario_id = v_cierre.id
  WHERE tenant_id = p_tenant_id AND fecha_asiento = p_fecha AND estado = 'VIGENTE' AND cierre_diario_id IS NULL;

  -- INV-C02 also applies to the contralor asientos of the jornada (spec).
  UPDATE fsj.asiento_contralor
  SET cierre_diario_id = v_cierre.id
  WHERE tenant_id = p_tenant_id AND fecha_asiento = p_fecha AND estado = 'VIGENTE' AND cierre_diario_id IS NULL;

  PERFORM set_config('fsj.cierre', 'off', true);

  RETURN v_cierre;
END;
$$;

COMMENT ON FUNCTION fsj.cierre_diario_firmar(uuid, date, uuid, uuid, text, text) IS
  'M13a signing transaction: INV-C01, C02 (links every VIGENTE asiento AND asiento_contralor of the jornada), C05 (hash_lote), C18, C19, C20 (fecha_firma is always now()), U04. Grant EXECUTE only -- fsj_app has no direct INSERT on fsj.cierre_diario.';

GRANT EXECUTE ON FUNCTION fsj.cierre_diario_firmar(uuid, date, uuid, uuid, text, text) TO fsj_app;

-- 0014_libro_recetario_contralor
--
-- FASE 1, point 1.12 (M12): the legal core. docs/specs/libro-recetario-y-contralor.md
-- is the source of truth and overrides the plan wherever they differ (task
-- instructions). Depends on 0001 (fsj.tenant, fsj.setup_tenant_table,
-- fsj.forbid_delete), 0002 (fsj.usuario), 0005 (fsj.es_dt_vigente), 0007
-- (fsj.droga), 0008 (fsj.movimiento_stock), 0012 (fsj.linea_pesaje), 0013
-- (fsj.preparacion).
--
-- Creates, in order:
--   1. fsj.jornada_actual(tenant_id) -- the SQL-callable jornada helper the
--      task asks for, then used to replace the current_date shortcuts in
--      migration 0008's trigger functions (via CREATE OR REPLACE, without
--      editing 0008's file -- see the bottom of this migration).
--   2. fsj.hash_genesis() + the canonical serialization used by every hash
--      chain in this migration (documented in full below -- a future
--      verifier must reproduce this byte for byte).
--   3. fsj.tipo_libro, fsj.libro_rubricado (minimal, no folios -- M13b
--      stays deferred per DP-38) + fsj.contador_correlativo (the gapless,
--      FOR-UPDATE-locked counter, one row per libro).
--   4. fsj.origen_asiento, fsj.estado_asiento, fsj.asiento_recetario,
--      fsj.detalle_asiento, fsj.anulacion_asiento (DP-16/DP-16c: anulacion
--      in an open jornada, asiento rectificativo in a signed one).
--   5. fsj.asiento_historico (DP-17: separate table, outside the
--      correlativo/hash chain/cierres -- spec section 2).
--   6. tenant.fecha_activacion_contralor (INV-L17) + fsj.tipo_movimiento_contralor
--      + fsj.asiento_contralor (spec section 4) + movimiento_stock.numero_vale_adquisicion.
--   7. movimiento_stock.linea_pesaje_id + the deferred INV-S12 consumption
--      check (docs/specs/ficha-tecnica.md's revised INV-S12/S13/S19/S20 --
--      only the sum-equals-cantidad_a_pesar guarantee is a hard DB
--      invariant; partida SELECTION/ordering (S13/S19/S20's "all but the
--      last partida end at 0") is an [APP] reparto concern, FASE 8 --
--      out of scope here per task instructions ("the application use case
--      that orchestrates the confirmation is FASE 8, not now").
--   8. INV-P04 (bidirectional deferred constraint trigger between
--      fsj.preparacion and fsj.asiento_recetario) + INV-L08 (deferred
--      constraint trigger on fsj.movimiento_stock requiring a matching
--      fsj.asiento_contralor row when the contralor is active).
--   9. CREATE OR REPLACE of migration 0008's two current_date-using
--      trigger functions, switching them to fsj.jornada_actual().
--
-- PENDIENTE items from the spec that are intentionally NOT implemented
-- here (left as documented gaps, never silently assumed):
--   - "Se segrega para inspeccion" (spec section 1, PENDIENTE): no table
--     tracks the segregated preparado. Physical practice only, for now.
--   - Rectificativo por "error de dato" (spec section 1, PENDIENTE):
--     whether it must also transcribe the corrected data is unresolved --
--     the table has the same snapshot columns as any asiento, so the APP
--     MAY choose to fill them with corrected values, but nothing here
--     requires or validates that.
--   - Droga controlada dada de alta DESPUES de la activacion (spec
--     section 4, PENDIENTE): no automatic saldo-0 APERTURA is generated.
--     The trigger below requires an explicit APERTURA (INV-L15) before any
--     other movement for that droga+libro -- this fails CLOSED (movements
--     are rejected until someone inserts the APERTURA by hand), which is
--     the safe default, not a resolution of the PENDIENTE.
--   - Sobrante de droga controlada como INGRESO sin vale (spec section 4,
--     PENDIENTE): INV-L16 below unconditionally requires
--     numero_vale_adquisicion for every INGRESO. A surplus movement will
--     be rejected until this is resolved -- not silently allowed through.
--
-- DEDUCCION (not in the spec, needed to make it buildable): every tenant
-- gets THREE libro_rubricado rows (RECETARIO, PSICOTROPICO, ESTUPEFACIENTE)
-- at creation time, all open from day one. This is what lets
-- asiento_recetario be generated for every preparacion regardless of
-- whether the contralor is ever activated (RECETARIO must always exist),
-- and keeps "el libro contralor tambien arranca en 1" true structurally
-- without needing an app-level "activate contralor" flow to also create a
-- libro row (that flow is FASE 8/9, out of scope here). If the contralor
-- is never activated, the PSICOTROPICO/ESTUPEFACIENTE libro rows and their
-- counters simply never receive an asiento_contralor row.

-- ============================================================================
-- 1. fsj.jornada_actual(tenant_id): the jornada (business day, in the
-- tenant's own time zone) "right now". Mirrors shared/time/jornada.ts's
-- jornadaDe(new Date(), tenant.zona_horaria) exactly: AT TIME ZONE on a
-- timestamptz converts to that zone's local wall-clock time, and ::date
-- truncates it the same way Intl.DateTimeFormat's en-CA formatter does.
-- fsj.tenant has no RLS (global table, migration 0001), so this resolves
-- regardless of the caller's app.tenant_id / role.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.jornada_actual(p_tenant_id uuid)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE t.zona_horaria)::date
  FROM fsj.tenant t
  WHERE t.id = p_tenant_id;
$$;

COMMENT ON FUNCTION fsj.jornada_actual(uuid) IS
  'The tenant''s current business date (jornada), in its own zona_horaria. Use this everywhere a legal date is decided (asientos, cierres, DT vigency checks) -- never current_date/now()::date directly. Mirrors shared/time/jornada.ts#jornadaDe.';

GRANT EXECUTE ON FUNCTION fsj.jornada_actual(uuid) TO fsj_app;

-- ============================================================================
-- 2. Hash chain: canonical serialization (DP-32 -- computed in the DB by a
-- BEFORE INSERT trigger, never sent by the app).
--
-- ALGORITHM (documented in full so a future verifier can reproduce it byte
-- for byte -- see also the "verify the chain" test below, which recomputes
-- it in plain SQL from the stored columns):
--
--   hash_integridad = encode(extensions.digest(payload, 'sha256'), 'hex')
--
--   payload = the row's fields, in the EXACT order listed below, joined
--   with chr(31) (ASCII Unit Separator -- chosen because it cannot appear
--   in normal free-text input, so no escaping is needed; if it ever does
--   appear in a snapshot text field, it becomes part of that field's raw
--   bytes like any other character -- it is a field SEPARATOR added
--   between fields by array_to_string, not a delimiter stripped from
--   field content).
--
--   UUID columns are serialized via their canonical lowercase
--   8-4-4-4-12 hyphenated text form (uuid::text); NULL uuid/text columns
--   are serialized as the empty string; numeric columns via their plain
--   decimal text form (numeric::text -- no exponents, no trailing-zero
--   normalization beyond what Postgres already does for the stored
--   value); date columns via ISO-8601 YYYY-MM-DD (date::text).
--
--   fsj.asiento_recetario payload (version tag 'FSJ-ASIENTO-V1'):
--     'FSJ-ASIENTO-V1', tenant_id, libro_id, numero_correlativo,
--     fecha_asiento, origen, preparacion_id-or-'', asiento_original_id-or-'',
--     paciente_texto, medico_texto, formula_texto, estado, hash_anterior
--
--   fsj.asiento_contralor payload (version tag 'FSJ-ASIENTO-CONTRALOR-V1'):
--     'FSJ-ASIENTO-CONTRALOR-V1', tenant_id, libro_id, numero_correlativo,
--     fecha_asiento, tipo_movimiento, droga_id, droga_descripcion, cantidad,
--     unidad_medida_id, saldo_anterior, saldo_posterior,
--     movimiento_stock_id-or-'', asiento_recetario_id-or-'',
--     numero_vale_adquisicion-or-'', estado, hash_anterior
--
--   Genesis: the FIRST asiento of any (tenant, libro) uses
--   hash_anterior = fsj.hash_genesis() -- a fixed, documented constant
--   (NOT a real asiento's hash), computed once below and reused as the
--   contador_correlativo row's default ultimo_hash. It is intentionally
--   the SAME literal constant for every libro (recetario and every
--   contralor book alike): the chain is still unique per libro because
--   every subsequent hash also incorporates tenant_id/libro_id, so sharing
--   a genesis value creates no collision risk.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.hash_genesis()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(extensions.digest('FSJ-LIBRO-GENESIS-V1', 'sha256'), 'hex');
$$;

COMMENT ON FUNCTION fsj.hash_genesis() IS
  'Fixed genesis hash for every hash-chained libro (recetario and contralor alike) -- see the canonical serialization comment above this function in migration 0014. NOT a real asiento hash; the value the FIRST asiento of any libro chains against.';

GRANT EXECUTE ON FUNCTION fsj.hash_genesis() TO fsj_app;

-- ============================================================================
-- 3. libro_rubricado (minimal per task scope -- M13b/folios stay deferred,
-- DP-38) + contador_correlativo (DP-31: gapless counter, one row per
-- (tenant, libro), locked FOR UPDATE and assigned by a BEFORE INSERT
-- trigger -- the app never sends numero_correlativo).
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.tipo_libro AS ENUM ('RECETARIO', 'PSICOTROPICO', 'ESTUPEFACIENTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE TABLE IF NOT EXISTS fsj.libro_rubricado (
  id                  uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  tipo                fsj.tipo_libro NOT NULL,
  numero              text NOT NULL,
  fecha_rubrica       date NOT NULL,
  expediente_rubrica  text,
  fecha_cierre        date,
  registrado_por_id   uuid NOT NULL,
  registrado_en       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT libro_rubricado_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT libro_rubricado_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id)
);

COMMENT ON TABLE fsj.libro_rubricado IS
  'M12/M13b minimal model (spec [CONFLICTO], DP-38 open): tipo/numero/fecha_rubrica/expediente_rubrica/fecha_cierre only, NO folios. At most one OPEN book (fecha_cierre IS NULL) per (tenant, tipo) -- see the partial unique index below. See migration header for why every tenant gets all 3 tipos at creation time.';

SELECT fsj.setup_tenant_table('fsj.libro_rubricado');

CREATE UNIQUE INDEX IF NOT EXISTS uq_libro_rubricado_abierto
  ON fsj.libro_rubricado (tenant_id, tipo)
  WHERE fecha_cierre IS NULL;

GRANT UPDATE (fecha_cierre) ON fsj.libro_rubricado TO fsj_app;

CREATE TRIGGER trg_libro_rubricado_forbid_delete
  BEFORE DELETE ON fsj.libro_rubricado
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

CREATE OR REPLACE FUNCTION fsj.libro_rubricado_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.numero IS DISTINCT FROM OLD.numero
     OR NEW.fecha_rubrica IS DISTINCT FROM OLD.fecha_rubrica
     OR NEW.expediente_rubrica IS DISTINCT FROM OLD.expediente_rubrica
     OR NEW.registrado_por_id IS DISTINCT FROM OLD.registrado_por_id
  THEN
    RAISE EXCEPTION 'INV-LIB-001: libro_rubricado rows are immutable except fecha_cierre (NULL -> value, once)' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.fecha_cierre IS NOT NULL AND NEW.fecha_cierre IS DISTINCT FROM OLD.fecha_cierre THEN
    RAISE EXCEPTION 'INV-LIB-001: libro_rubricado.fecha_cierre cannot change once set' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_libro_rubricado_validar_update
  BEFORE UPDATE ON fsj.libro_rubricado
  FOR EACH ROW EXECUTE FUNCTION fsj.libro_rubricado_validar_update();

-- ---------------------------------------------------------------------------
-- contador_correlativo: PK (tenant_id, libro_id) per spec section 3. No
-- SEQUENCE (a rolled-back transaction would still consume a sequence
-- value, creating a gap -- INV-L04 forbids that). fsj_app has NO grant at
-- all on this table -- only the SECURITY DEFINER trigger functions below
-- (fsj.asiento_recetario_preparar / fsj.asiento_contralor_preparar, via
-- fsj.contador_correlativo_tomar) ever read or write it. Same manual-RLS
-- convention as fsj.receta_numero_contador (migration 0011): tenant_id IS
-- part of the PK, so setup_tenant_table's UNIQUE(tenant_id,id) assumption
-- doesn't apply, but the RLS policy + INV-T03 protection still matter.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fsj.contador_correlativo (
  tenant_id     uuid NOT NULL,
  libro_id      uuid NOT NULL,
  ultimo_valor  bigint NOT NULL DEFAULT 0,
  ultimo_hash   text NOT NULL DEFAULT fsj.hash_genesis(),
  PRIMARY KEY (tenant_id, libro_id),
  CONSTRAINT contador_correlativo_libro_fkey FOREIGN KEY (tenant_id, libro_id) REFERENCES fsj.libro_rubricado (tenant_id, id)
);

COMMENT ON TABLE fsj.contador_correlativo IS
  'DP-31: the gapless correlativo counter, one row per (tenant, libro). Locked FOR UPDATE and advanced ONLY by fsj.contador_correlativo_tomar(), called from the BEFORE INSERT triggers on asiento_recetario/asiento_contralor. A rolled-back INSERT never advances this row (the UPDATE that commits ultimo_valor happens inside the same transaction as the asiento insert), which is exactly what keeps the sequence gapless across failed attempts -- see migration header.';

ALTER TABLE fsj.contador_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsj.contador_correlativo FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fsj.contador_correlativo;
CREATE POLICY tenant_isolation ON fsj.contador_correlativo
  USING (tenant_id = fsj.current_tenant_id())
  WITH CHECK (tenant_id = fsj.current_tenant_id());

REVOKE INSERT, UPDATE ON fsj.contador_correlativo FROM fsj_app;

-- Every new libro_rubricado row gets its own counter row immediately,
-- starting at 0 (first asiento will be 1) -- covers both the backfill
-- INSERT below (existing tenants) and scripts/create-tenant.ts (new ones).
CREATE OR REPLACE FUNCTION fsj.libro_rubricado_crear_contador()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
BEGIN
  INSERT INTO fsj.contador_correlativo (tenant_id, libro_id) VALUES (NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_libro_rubricado_crear_contador
  AFTER INSERT ON fsj.libro_rubricado
  FOR EACH ROW EXECUTE FUNCTION fsj.libro_rubricado_crear_contador();

-- ---------------------------------------------------------------------------
-- fsj.contador_correlativo_tomar: locks the (tenant, libro) counter row
-- FOR UPDATE and returns the NEXT number + the current ultimo_hash (to
-- become the new row's hash_anterior). Does NOT advance the counter itself
-- -- the caller (asiento_recetario_preparar / asiento_contralor_preparar)
-- does that in the SAME statement it computes the new hash_integridad, so
-- ultimo_valor and ultimo_hash always move together. The row lock acquired
-- here is held until the calling transaction commits or rolls back, which
-- is what serializes concurrent inserts into the same libro (see the
-- concurrency test).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fsj.contador_correlativo_tomar(p_tenant_id uuid, p_libro_id uuid)
RETURNS TABLE (numero bigint, hash_anterior text)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT c.ultimo_valor + 1, c.ultimo_hash
  FROM fsj.contador_correlativo c
  WHERE c.tenant_id = p_tenant_id AND c.libro_id = p_libro_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-L03: no contador_correlativo row for tenant % / libro % -- the libro_rubricado must exist first', p_tenant_id, p_libro_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ============================================================================
-- 4. asiento_recetario + detalle_asiento + anulacion_asiento
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.origen_asiento AS ENUM ('SISTEMA', 'RECTIFICATIVO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE fsj.estado_asiento AS ENUM ('VIGENTE', 'ANULADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE TABLE IF NOT EXISTS fsj.asiento_recetario (
  id                    uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  libro_id              uuid NOT NULL,            -- trigger-assigned: the tenant's open RECETARIO libro
  numero_correlativo    bigint NOT NULL,           -- trigger-assigned, never sent by the app
  fecha_asiento         date NOT NULL,             -- trigger-assigned = fsj.jornada_actual(tenant_id)
  origen                fsj.origen_asiento NOT NULL,
  preparacion_id        uuid,                      -- NOT NULL iff origen = SISTEMA
  asiento_original_id   uuid,                      -- NOT NULL iff origen = RECTIFICATIVO
  paciente_texto        text NOT NULL,             -- INV-L05 snapshot
  medico_texto          text NOT NULL,             -- INV-L05 snapshot (nombre + matricula)
  formula_texto         text NOT NULL,             -- INV-L05 snapshot
  cierre_diario_id      uuid,                      -- FK added in migration 0015 (fsj.cierre_diario doesn't exist yet)
  estado                fsj.estado_asiento NOT NULL DEFAULT 'VIGENTE',
  hash_integridad       text NOT NULL,             -- trigger-assigned
  hash_anterior         text NOT NULL,             -- trigger-assigned
  registrado_por_id     uuid NOT NULL,
  registrado_en         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT asiento_recetario_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT asiento_recetario_correlativo_unico UNIQUE (tenant_id, libro_id, numero_correlativo),
  CONSTRAINT asiento_recetario_libro_fkey FOREIGN KEY (tenant_id, libro_id) REFERENCES fsj.libro_rubricado (tenant_id, id),
  CONSTRAINT asiento_recetario_preparacion_fkey FOREIGN KEY (tenant_id, preparacion_id) REFERENCES fsj.preparacion (tenant_id, id),
  CONSTRAINT asiento_recetario_original_fkey FOREIGN KEY (tenant_id, asiento_original_id) REFERENCES fsj.asiento_recetario (tenant_id, id),
  CONSTRAINT asiento_recetario_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  -- INV-L07 (origen <-> preparacion_id/asiento_original_id pairing, revised for RECTIFICATIVO).
  CONSTRAINT asiento_recetario_origen_check CHECK (
    (origen = 'SISTEMA' AND preparacion_id IS NOT NULL AND asiento_original_id IS NULL)
    OR (origen = 'RECTIFICATIVO' AND preparacion_id IS NULL AND asiento_original_id IS NOT NULL)
  )
);

COMMENT ON TABLE fsj.asiento_recetario IS
  'M12. Fully immutable (INV-L01) except cierre_diario_id (NULL->value, once, via fsj.cierre_diario_firmar -- migration 0015) and estado VIGENTE->ANULADO (via fsj.anulacion_asiento, INV-L02/L09 -- only while cierre_diario_id IS NULL). numero_correlativo/hash_integridad/hash_anterior/libro_id/fecha_asiento are ALL assigned by the BEFORE INSERT trigger below -- never sent by the app. See migration header for the canonical hash serialization.';

SELECT fsj.setup_tenant_table('fsj.asiento_recetario');

-- Defense in depth: no UPDATE/DELETE grant to fsj_app AT ALL. The only two
-- legal mutations (cierre_diario_id linking, estado ANULADO) happen
-- exclusively through SECURITY DEFINER paths below, which bypass grants by
-- running as the function owner -- the trg_asiento_recetario_validar_update
-- trigger is what actually gates them (via the fsj.cierre/fsj.anula
-- session flags), not a GRANT.
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.asiento_recetario FROM fsj_app;

-- At most one SISTEMA asiento per preparacion (reinforces INV-P04's
-- uniqueness direction with an index, on top of the deferred trigger).
CREATE UNIQUE INDEX IF NOT EXISTS uq_asiento_recetario_preparacion
  ON fsj.asiento_recetario (tenant_id, preparacion_id)
  WHERE origen = 'SISTEMA';

-- INV-L19: an original asiento has AT MOST ONE rectificativo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asiento_recetario_rectificativo_unico
  ON fsj.asiento_recetario (tenant_id, asiento_original_id)
  WHERE origen = 'RECTIFICATIVO';

-- ============================================================================
-- BEFORE INSERT: assigns libro_id, fecha_asiento, numero_correlativo,
-- hash_anterior, hash_integridad -- and validates INV-L18 for RECTIFICATIVO
-- entries. SECURITY DEFINER so it can read/write fsj.contador_correlativo,
-- which fsj_app has no grant on.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_recetario_preparar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_libro_id       uuid;
  v_numero         bigint;
  v_hash_anterior  text;
  v_original       fsj.asiento_recetario%ROWTYPE;
  v_payload        text;
BEGIN
  SELECT id INTO v_libro_id
  FROM fsj.libro_rubricado
  WHERE tenant_id = NEW.tenant_id AND tipo = 'RECETARIO' AND fecha_cierre IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-L03: tenant % has no open RECETARIO libro_rubricado', NEW.tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  NEW.libro_id := v_libro_id;
  NEW.fecha_asiento := fsj.jornada_actual(NEW.tenant_id);
  NEW.estado := 'VIGENTE';
  NEW.cierre_diario_id := NULL;

  IF NEW.origen = 'RECTIFICATIVO' THEN
    SELECT * INTO v_original
    FROM fsj.asiento_recetario
    WHERE tenant_id = NEW.tenant_id AND id = NEW.asiento_original_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INV-L18: asiento_original_id % not found', NEW.asiento_original_id USING ERRCODE = 'P0001';
    END IF;
    -- DEDUCCION: a rectificativo always targets the SISTEMA entry, never
    -- another rectificativo (the spec only says "asiento original de una
    -- jornada firmada", but chaining rectificativos would make "sin efecto
    -- por asiento X" ambiguous at display time).
    IF v_original.origen <> 'SISTEMA' THEN
      RAISE EXCEPTION 'INV-L18: rectificativo must reference a SISTEMA asiento (% is %)', NEW.asiento_original_id, v_original.origen
        USING ERRCODE = 'P0001';
    END IF;
    IF v_original.cierre_diario_id IS NULL THEN
      RAISE EXCEPTION 'INV-L18: asiento_original_id % belongs to a jornada that is not yet signed', NEW.asiento_original_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_original.fecha_asiento >= NEW.fecha_asiento THEN
      RAISE EXCEPTION 'INV-L18: rectificativo fecha_asiento (%) must be AFTER the original''s fecha_asiento (%)', NEW.fecha_asiento, v_original.fecha_asiento
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT numero, hash_anterior INTO v_numero, v_hash_anterior
  FROM fsj.contador_correlativo_tomar(NEW.tenant_id, v_libro_id);

  NEW.numero_correlativo := v_numero;
  NEW.hash_anterior := v_hash_anterior;

  v_payload := array_to_string(ARRAY[
    'FSJ-ASIENTO-V1',
    NEW.tenant_id::text,
    v_libro_id::text,
    NEW.numero_correlativo::text,
    NEW.fecha_asiento::text,
    NEW.origen::text,
    coalesce(NEW.preparacion_id::text, ''),
    coalesce(NEW.asiento_original_id::text, ''),
    NEW.paciente_texto,
    NEW.medico_texto,
    NEW.formula_texto,
    NEW.estado::text,
    v_hash_anterior
  ], chr(31));

  NEW.hash_integridad := encode(extensions.digest(v_payload, 'sha256'), 'hex');

  UPDATE fsj.contador_correlativo
  SET ultimo_valor = v_numero, ultimo_hash = NEW.hash_integridad
  WHERE tenant_id = NEW.tenant_id AND libro_id = v_libro_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asiento_recetario_preparar
  BEFORE INSERT ON fsj.asiento_recetario
  FOR EACH ROW EXECUTE FUNCTION fsj.asiento_recetario_preparar();

-- ============================================================================
-- BEFORE UPDATE: only cierre_diario_id (NULL->value, gated by the
-- fsj.cierre session flag set by fsj.cierre_diario_firmar, migration 0015)
-- and estado (VIGENTE->ANULADO, gated by the fsj.anula flag set by
-- fsj.anulacion_asiento_aplicar below, and only while cierre_diario_id IS
-- NULL -- INV-L02) may ever change. Everything else is frozen (INV-L01).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_recetario_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cierre_diario_id IS DISTINCT FROM OLD.cierre_diario_id THEN
    IF OLD.cierre_diario_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-L01: asiento_recetario.cierre_diario_id cannot change once set' USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(current_setting('fsj.cierre', true), '') <> 'on' THEN
      RAISE EXCEPTION 'INV-L01: asiento_recetario.cierre_diario_id can only be set by fsj.cierre_diario_firmar()' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF OLD.estado <> 'VIGENTE' OR NEW.estado <> 'ANULADO' THEN
      RAISE EXCEPTION 'INV-L01: invalid asiento_recetario.estado transition % -> %', OLD.estado, NEW.estado
        USING ERRCODE = 'P0001';
    END IF;
    IF OLD.cierre_diario_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-L02: cannot anular asiento % -- its jornada (%) is already signed; use a rectificativo instead', OLD.id, OLD.fecha_asiento
        USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(current_setting('fsj.anula', true), '') <> 'on' THEN
      RAISE EXCEPTION 'INV-L09: asiento_recetario.estado can only change via fsj.anulacion_asiento' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.libro_id IS DISTINCT FROM OLD.libro_id
     OR NEW.numero_correlativo IS DISTINCT FROM OLD.numero_correlativo
     OR NEW.fecha_asiento IS DISTINCT FROM OLD.fecha_asiento
     OR NEW.origen IS DISTINCT FROM OLD.origen
     OR NEW.preparacion_id IS DISTINCT FROM OLD.preparacion_id
     OR NEW.asiento_original_id IS DISTINCT FROM OLD.asiento_original_id
     OR NEW.paciente_texto IS DISTINCT FROM OLD.paciente_texto
     OR NEW.medico_texto IS DISTINCT FROM OLD.medico_texto
     OR NEW.formula_texto IS DISTINCT FROM OLD.formula_texto
     OR NEW.hash_integridad IS DISTINCT FROM OLD.hash_integridad
     OR NEW.hash_anterior IS DISTINCT FROM OLD.hash_anterior
     OR NEW.registrado_por_id IS DISTINCT FROM OLD.registrado_por_id
  THEN
    RAISE EXCEPTION 'INV-L01: asiento_recetario rows are immutable except cierre_diario_id (once) and estado VIGENTE->ANULADO' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asiento_recetario_validar_update
  BEFORE UPDATE ON fsj.asiento_recetario
  FOR EACH ROW EXECUTE FUNCTION fsj.asiento_recetario_validar_update();

CREATE TRIGGER trg_asiento_recetario_forbid_delete
  BEFORE DELETE ON fsj.asiento_recetario
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- ============================================================================
-- detalle_asiento: immutable lines. `cantidad` holds cantidad_a_pesar for
-- non-manual lines, or the REAL quantity registered at confirmation for
-- manual-enrase lines (docs/specs/ficha-tecnica.md: "esa cantidad se guarda
-- en el MovimientoStock ... y en DetalleAsiento, no en LineaPesaje").
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.detalle_asiento (
  id                     uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  asiento_recetario_id   uuid NOT NULL,
  linea_pesaje_id        uuid,               -- nullable: RECTIFICATIVO asientos may carry no lines of their own
  descripcion            text NOT NULL,
  cantidad               numeric NOT NULL,
  unidad_texto           text NOT NULL,
  orden                  integer NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT detalle_asiento_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT detalle_asiento_orden_unico UNIQUE (tenant_id, asiento_recetario_id, orden),
  CONSTRAINT detalle_asiento_asiento_fkey FOREIGN KEY (tenant_id, asiento_recetario_id) REFERENCES fsj.asiento_recetario (tenant_id, id),
  CONSTRAINT detalle_asiento_linea_fkey FOREIGN KEY (tenant_id, linea_pesaje_id) REFERENCES fsj.linea_pesaje (tenant_id, id),
  CONSTRAINT detalle_asiento_cantidad_check CHECK (cantidad > 0)
);

COMMENT ON TABLE fsj.detalle_asiento IS
  'M12. Immutable (no UPDATE/DELETE grant, trigger below). cantidad is cantidad_a_pesar for non-manual lines, or the real registered quantity for manual-enrase lines -- docs/specs/ficha-tecnica.md.';

SELECT fsj.setup_tenant_table('fsj.detalle_asiento');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.detalle_asiento FROM fsj_app;

CREATE TRIGGER trg_detalle_asiento_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.detalle_asiento
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- ============================================================================
-- anulacion_asiento: DP-16/DP-16c. Only valid while the asiento's jornada
-- is NOT yet signed (INV-L02/C03); requires a DT vigente TODAY as
-- autorizador (INV-U05-style). The AFTER INSERT trigger flips the
-- referenced asiento to ANULADO (INV-L09: "anular = INSERT anulacion +
-- trigger que pasa estado a ANULADO"). INV-L20: no stock movement, no
-- asiento_contralor is ever touched by this path.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.anulacion_asiento (
  id                  uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  asiento_id          uuid NOT NULL,
  motivo              text NOT NULL,
  autorizado_por_id   uuid NOT NULL,
  anulado_por_id      uuid NOT NULL,
  anulado_en          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT anulacion_asiento_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT anulacion_asiento_asiento_unico UNIQUE (tenant_id, asiento_id),
  CONSTRAINT anulacion_asiento_asiento_fkey FOREIGN KEY (tenant_id, asiento_id) REFERENCES fsj.asiento_recetario (tenant_id, id),
  CONSTRAINT anulacion_asiento_autorizado_por_fkey FOREIGN KEY (tenant_id, autorizado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT anulacion_asiento_anulado_por_fkey FOREIGN KEY (tenant_id, anulado_por_id) REFERENCES fsj.usuario (tenant_id, id)
);

COMMENT ON TABLE fsj.anulacion_asiento IS
  'M12, DP-16/DP-16c. Fully immutable (no UPDATE/DELETE grant, trigger below). INSERT is validated by trg_anulacion_asiento_validar (INV-L02/U05) and propagates estado=ANULADO onto the asiento via trg_anulacion_asiento_aplicar (INV-L09).';

SELECT fsj.setup_tenant_table('fsj.anulacion_asiento');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.anulacion_asiento FROM fsj_app;

CREATE TRIGGER trg_anulacion_asiento_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.anulacion_asiento
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

CREATE OR REPLACE FUNCTION fsj.anulacion_asiento_validar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_asiento fsj.asiento_recetario%ROWTYPE;
BEGIN
  SELECT * INTO v_asiento FROM fsj.asiento_recetario WHERE tenant_id = NEW.tenant_id AND id = NEW.asiento_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-L09: asiento % not found', NEW.asiento_id USING ERRCODE = 'P0001';
  END IF;
  IF v_asiento.estado <> 'VIGENTE' THEN
    RAISE EXCEPTION 'INV-L09: asiento % is not VIGENTE (currently %)', NEW.asiento_id, v_asiento.estado USING ERRCODE = 'P0001';
  END IF;
  IF v_asiento.cierre_diario_id IS NOT NULL THEN
    RAISE EXCEPTION 'INV-L02: cannot anular asiento % -- its jornada (%) is already signed; use a rectificativo instead', NEW.asiento_id, v_asiento.fecha_asiento
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT fsj.es_dt_vigente(NEW.autorizado_por_id, fsj.jornada_actual(NEW.tenant_id)) THEN
    RAISE EXCEPTION 'INV-U05: anulacion autorizado_por_id % is not a DT vigente today', NEW.autorizado_por_id USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_anulacion_asiento_validar
  BEFORE INSERT ON fsj.anulacion_asiento
  FOR EACH ROW EXECUTE FUNCTION fsj.anulacion_asiento_validar();

CREATE OR REPLACE FUNCTION fsj.anulacion_asiento_aplicar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
BEGIN
  PERFORM set_config('fsj.anula', 'on', true);
  UPDATE fsj.asiento_recetario SET estado = 'ANULADO' WHERE tenant_id = NEW.tenant_id AND id = NEW.asiento_id;
  PERFORM set_config('fsj.anula', 'off', true);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_anulacion_asiento_aplicar
  AFTER INSERT ON fsj.anulacion_asiento
  FOR EACH ROW EXECUTE FUNCTION fsj.anulacion_asiento_aplicar();

-- ============================================================================
-- 5. asiento_historico (DP-17, spec section 2): a SEPARATE table, outside
-- the digital libro's correlativo/hash chain/cierres. No stock effects.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.asiento_historico (
  id                      uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  tipo_libro              fsj.tipo_libro NOT NULL,
  numero_asiento_fisico   text NOT NULL,   -- copies the physical book's own numbering, as text
  fecha_asiento           date NOT NULL,
  paciente_texto          text,
  medico_texto            text,
  formula_texto           text NOT NULL,
  observaciones           text,
  digitalizado_por_id     uuid NOT NULL,
  digitalizado_en         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT asiento_historico_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT asiento_historico_digitalizado_por_fkey FOREIGN KEY (tenant_id, digitalizado_por_id) REFERENCES fsj.usuario (tenant_id, id)
);

COMMENT ON TABLE fsj.asiento_historico IS
  'DP-17, spec section 2: digitized entries from the PHYSICAL book, for reference only. Does NOT consume fsj.contador_correlativo, does NOT enter any hash chain, does NOT link to fsj.cierre_diario, does NOT generate movimiento_stock. Immutable (no UPDATE/DELETE grant, trigger below).';

SELECT fsj.setup_tenant_table('fsj.asiento_historico');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.asiento_historico FROM fsj_app;

CREATE TRIGGER trg_asiento_historico_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.asiento_historico
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- ============================================================================
-- 6. Contralor (spec section 4, DP-33).
-- ============================================================================
ALTER TABLE fsj.tenant ADD COLUMN IF NOT EXISTS fecha_activacion_contralor timestamptz;

COMMENT ON COLUMN fsj.tenant.fecha_activacion_contralor IS
  'NULL = contralor libros are kept by hand (no asiento_contralor rows generated). Once set, INV-L17 forbids ever changing it again (not just "never back to NULL" -- see trg_tenant_validar_activacion_contralor, a DEDUCCION for tighter integrity than the literal spec wording).';

GRANT UPDATE (fecha_activacion_contralor) ON fsj.tenant TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.tenant_validar_activacion_contralor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.fecha_activacion_contralor IS NOT NULL AND NEW.fecha_activacion_contralor IS DISTINCT FROM OLD.fecha_activacion_contralor THEN
    RAISE EXCEPTION 'INV-L17: tenant.fecha_activacion_contralor cannot change once set' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_validar_activacion_contralor
  BEFORE UPDATE OF fecha_activacion_contralor ON fsj.tenant
  FOR EACH ROW EXECUTE FUNCTION fsj.tenant_validar_activacion_contralor();

DO $do$ BEGIN
  CREATE TYPE fsj.tipo_movimiento_contralor AS ENUM ('APERTURA', 'INGRESO', 'EGRESO', 'AJUSTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE TABLE IF NOT EXISTS fsj.asiento_contralor (
  id                        uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  libro_id                  uuid NOT NULL,             -- trigger-assigned from droga.tipo_control
  numero_correlativo        bigint NOT NULL,            -- trigger-assigned
  fecha_asiento             date NOT NULL,              -- trigger-assigned
  tipo_movimiento           fsj.tipo_movimiento_contralor NOT NULL,
  droga_id                  uuid NOT NULL,
  droga_descripcion         text NOT NULL,              -- frozen snapshot
  cantidad                  numeric NOT NULL,
  unidad_medida_id          uuid NOT NULL,
  saldo_anterior            numeric NOT NULL,           -- trigger-assigned, INV-L13
  saldo_posterior           numeric NOT NULL,           -- trigger-assigned, INV-L12/L14
  movimiento_stock_id       uuid,                       -- NULL only for APERTURA
  asiento_recetario_id      uuid,                       -- only for EGRESO (por preparacion)
  numero_vale_adquisicion   text,                       -- only for INGRESO, INV-L16
  cierre_diario_id          uuid,                       -- FK added in migration 0015
  estado                    fsj.estado_asiento NOT NULL DEFAULT 'VIGENTE',
  hash_integridad           text NOT NULL,
  hash_anterior             text NOT NULL,
  registrado_por_id         uuid NOT NULL,
  registrado_en             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT asiento_contralor_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT asiento_contralor_correlativo_unico UNIQUE (tenant_id, libro_id, numero_correlativo),
  -- MovimientoStock 1 -> 0..1 AsientoContralor (Postgres UNIQUE allows
  -- multiple NULLs, so every APERTURA row's NULL is exempt automatically).
  CONSTRAINT asiento_contralor_movimiento_unico UNIQUE (tenant_id, movimiento_stock_id),
  CONSTRAINT asiento_contralor_libro_fkey FOREIGN KEY (tenant_id, libro_id) REFERENCES fsj.libro_rubricado (tenant_id, id),
  CONSTRAINT asiento_contralor_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  CONSTRAINT asiento_contralor_unidad_fkey FOREIGN KEY (unidad_medida_id) REFERENCES fsj.unidad_medida (id),
  CONSTRAINT asiento_contralor_movimiento_fkey FOREIGN KEY (tenant_id, movimiento_stock_id) REFERENCES fsj.movimiento_stock (tenant_id, id),
  CONSTRAINT asiento_contralor_asiento_recetario_fkey FOREIGN KEY (tenant_id, asiento_recetario_id) REFERENCES fsj.asiento_recetario (tenant_id, id),
  CONSTRAINT asiento_contralor_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT asiento_contralor_cantidad_check CHECK (cantidad > 0 OR (tipo_movimiento = 'APERTURA' AND cantidad >= 0)),
  CONSTRAINT asiento_contralor_saldo_check CHECK (saldo_anterior >= 0 AND saldo_posterior >= 0),
  -- Per-tipo field pairing (INV-L15/L16 NOT-NULL halves + the deductions
  -- in the spec: EGRESO <-> asiento_recetario_id, INGRESO <-> vale).
  CONSTRAINT asiento_contralor_tipo_check CHECK (
    (tipo_movimiento = 'APERTURA' AND movimiento_stock_id IS NULL AND asiento_recetario_id IS NULL AND numero_vale_adquisicion IS NULL)
    OR (tipo_movimiento = 'INGRESO' AND movimiento_stock_id IS NOT NULL AND asiento_recetario_id IS NULL AND numero_vale_adquisicion IS NOT NULL)
    OR (tipo_movimiento = 'EGRESO' AND movimiento_stock_id IS NOT NULL AND asiento_recetario_id IS NOT NULL AND numero_vale_adquisicion IS NULL)
    OR (tipo_movimiento = 'AJUSTE' AND movimiento_stock_id IS NOT NULL AND asiento_recetario_id IS NULL AND numero_vale_adquisicion IS NULL)
  )
);

COMMENT ON TABLE fsj.asiento_contralor IS
  'M12, spec section 4. Fully immutable (no UPDATE/DELETE grant, trigger below) -- unlike asiento_recetario, contralor rows have no anulacion/rectificativo path (INV-L20: anular/rectificar a recetario entry never touches the contralor). libro_id/numero_correlativo/fecha_asiento/saldo_anterior/saldo_posterior/hash_* are ALL trigger-assigned. [CONFLICTO] resolutions applied per spec: AJUSTE always subtracts (like movimiento_stock DP-21b); libro_rubricado is the minimal model (no folios).';

SELECT fsj.setup_tenant_table('fsj.asiento_contralor');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.asiento_contralor FROM fsj_app;

CREATE TRIGGER trg_asiento_contralor_forbid_delete
  BEFORE DELETE ON fsj.asiento_contralor
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- Unlike detalle_asiento/anulacion_asiento/asiento_historico (genuinely
-- fully immutable), asiento_contralor has exactly ONE legal mutation path:
-- cierre_diario_id NULL->value, set by fsj.cierre_diario_firmar (migration
-- 0015) via the same fsj.cierre session flag used for asiento_recetario.
-- Everything else, including estado (contralor rows have no
-- anulacion/rectificativo path -- INV-L20), is frozen.
CREATE OR REPLACE FUNCTION fsj.asiento_contralor_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cierre_diario_id IS DISTINCT FROM OLD.cierre_diario_id THEN
    IF OLD.cierre_diario_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-L01: asiento_contralor.cierre_diario_id cannot change once set' USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(current_setting('fsj.cierre', true), '') <> 'on' THEN
      RAISE EXCEPTION 'INV-L01: asiento_contralor.cierre_diario_id can only be set by fsj.cierre_diario_firmar()' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.libro_id IS DISTINCT FROM OLD.libro_id
     OR NEW.numero_correlativo IS DISTINCT FROM OLD.numero_correlativo
     OR NEW.fecha_asiento IS DISTINCT FROM OLD.fecha_asiento
     OR NEW.tipo_movimiento IS DISTINCT FROM OLD.tipo_movimiento
     OR NEW.droga_id IS DISTINCT FROM OLD.droga_id
     OR NEW.droga_descripcion IS DISTINCT FROM OLD.droga_descripcion
     OR NEW.cantidad IS DISTINCT FROM OLD.cantidad
     OR NEW.unidad_medida_id IS DISTINCT FROM OLD.unidad_medida_id
     OR NEW.saldo_anterior IS DISTINCT FROM OLD.saldo_anterior
     OR NEW.saldo_posterior IS DISTINCT FROM OLD.saldo_posterior
     OR NEW.movimiento_stock_id IS DISTINCT FROM OLD.movimiento_stock_id
     OR NEW.asiento_recetario_id IS DISTINCT FROM OLD.asiento_recetario_id
     OR NEW.numero_vale_adquisicion IS DISTINCT FROM OLD.numero_vale_adquisicion
     OR NEW.estado IS DISTINCT FROM OLD.estado
     OR NEW.hash_integridad IS DISTINCT FROM OLD.hash_integridad
     OR NEW.hash_anterior IS DISTINCT FROM OLD.hash_anterior
     OR NEW.registrado_por_id IS DISTINCT FROM OLD.registrado_por_id
  THEN
    RAISE EXCEPTION 'INV-L01: asiento_contralor rows are immutable except cierre_diario_id (NULL -> value, once)' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asiento_contralor_validar_update
  BEFORE UPDATE ON fsj.asiento_contralor
  FOR EACH ROW EXECUTE FUNCTION fsj.asiento_contralor_validar_update();

-- INV-L15: exactly one APERTURA per (droga, libro).
CREATE UNIQUE INDEX IF NOT EXISTS uq_asiento_contralor_apertura_unica
  ON fsj.asiento_contralor (tenant_id, libro_id, droga_id)
  WHERE tipo_movimiento = 'APERTURA';

-- ============================================================================
-- BEFORE INSERT: resolves libro_id from droga.tipo_control, computes
-- saldo_anterior/saldo_posterior under a row lock on the droga's last
-- asiento in that libro (INV-L12/L13/L14/L15), then assigns the
-- correlativo/hash exactly like asiento_recetario_preparar above.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_contralor_preparar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_tipo_control   fsj.tipo_control;
  v_libro_id       uuid;
  v_prev_saldo     numeric;
  v_found          boolean;
  v_numero         bigint;
  v_hash_anterior  text;
  v_payload        text;
BEGIN
  SELECT tipo_control INTO v_tipo_control
  FROM fsj.droga
  WHERE tenant_id = NEW.tenant_id AND id = NEW.droga_id;

  IF v_tipo_control IS NULL OR v_tipo_control = 'NINGUNO' THEN
    RAISE EXCEPTION 'INV-L08: droga % is not a controlled drug (tipo_control %)', NEW.droga_id, v_tipo_control
      USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_libro_id
  FROM fsj.libro_rubricado
  WHERE tenant_id = NEW.tenant_id AND tipo::text = v_tipo_control::text AND fecha_cierre IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-L08: tenant % has no open % libro_rubricado', NEW.tenant_id, v_tipo_control
      USING ERRCODE = 'P0001';
  END IF;

  NEW.libro_id := v_libro_id;
  NEW.fecha_asiento := fsj.jornada_actual(NEW.tenant_id);
  NEW.estado := 'VIGENTE';
  NEW.cierre_diario_id := NULL;

  SELECT saldo_posterior INTO v_prev_saldo
  FROM fsj.asiento_contralor
  WHERE tenant_id = NEW.tenant_id AND libro_id = v_libro_id AND droga_id = NEW.droga_id
  ORDER BY numero_correlativo DESC
  LIMIT 1
  FOR UPDATE;
  v_found := FOUND;

  IF NEW.tipo_movimiento = 'APERTURA' THEN
    IF v_found THEN
      RAISE EXCEPTION 'INV-L15: droga % already has entries in libro % -- APERTURA must be the first', NEW.droga_id, v_libro_id
        USING ERRCODE = 'P0001';
    END IF;
    NEW.saldo_anterior := 0;
    NEW.saldo_posterior := NEW.saldo_anterior + NEW.cantidad;
  ELSE
    IF NOT v_found THEN
      RAISE EXCEPTION 'INV-L15: droga % has no APERTURA in libro % yet', NEW.droga_id, v_libro_id
        USING ERRCODE = 'P0001';
    END IF;
    NEW.saldo_anterior := v_prev_saldo;
    IF NEW.tipo_movimiento = 'INGRESO' THEN
      NEW.saldo_posterior := NEW.saldo_anterior + NEW.cantidad;
    ELSE
      -- EGRESO and AJUSTE both subtract -- [CONFLICTO] resolved per spec:
      -- "Se asume que el AJUSTE contralor siempre resta" (DP-21b analogue).
      NEW.saldo_posterior := NEW.saldo_anterior - NEW.cantidad;
    END IF;
  END IF;

  IF NEW.saldo_posterior < 0 THEN
    RAISE EXCEPTION 'INV-L14: asiento_contralor saldo_posterior cannot go negative (saldo_anterior % - cantidad % or + %)', NEW.saldo_anterior, NEW.cantidad, NEW.cantidad
      USING ERRCODE = 'P0001';
  END IF;

  SELECT numero, hash_anterior INTO v_numero, v_hash_anterior
  FROM fsj.contador_correlativo_tomar(NEW.tenant_id, v_libro_id);

  NEW.numero_correlativo := v_numero;
  NEW.hash_anterior := v_hash_anterior;

  v_payload := array_to_string(ARRAY[
    'FSJ-ASIENTO-CONTRALOR-V1',
    NEW.tenant_id::text,
    v_libro_id::text,
    NEW.numero_correlativo::text,
    NEW.fecha_asiento::text,
    NEW.tipo_movimiento::text,
    NEW.droga_id::text,
    NEW.droga_descripcion,
    NEW.cantidad::text,
    NEW.unidad_medida_id::text,
    NEW.saldo_anterior::text,
    NEW.saldo_posterior::text,
    coalesce(NEW.movimiento_stock_id::text, ''),
    coalesce(NEW.asiento_recetario_id::text, ''),
    coalesce(NEW.numero_vale_adquisicion, ''),
    NEW.estado::text,
    v_hash_anterior
  ], chr(31));

  NEW.hash_integridad := encode(extensions.digest(v_payload, 'sha256'), 'hex');

  UPDATE fsj.contador_correlativo
  SET ultimo_valor = v_numero, ultimo_hash = NEW.hash_integridad
  WHERE tenant_id = NEW.tenant_id AND libro_id = v_libro_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asiento_contralor_preparar
  BEFORE INSERT ON fsj.asiento_contralor
  FOR EACH ROW EXECUTE FUNCTION fsj.asiento_contralor_preparar();

-- ============================================================================
-- movimiento_stock.numero_vale_adquisicion (task-required addition, NEW
-- migration -- 0008 is not edited): required for INGRESO_COMPRA of a
-- controlled drug once the tenant's contralor is active (INV-L16).
-- ============================================================================
ALTER TABLE fsj.movimiento_stock ADD COLUMN IF NOT EXISTS numero_vale_adquisicion text;

COMMENT ON COLUMN fsj.movimiento_stock.numero_vale_adquisicion IS
  'INV-L16: required (by trg_movimiento_stock_validar_vale below) when tipo=INGRESO_COMPRA, the droga is controlled, and the tenant''s contralor is active as of registrado_en. NULL otherwise (uncontrolled drugs, or contralor not yet active).';

CREATE OR REPLACE FUNCTION fsj.movimiento_stock_validar_vale()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo_control  fsj.tipo_control;
  v_activacion    timestamptz;
BEGIN
  IF NEW.tipo <> 'INGRESO_COMPRA' THEN
    RETURN NEW;
  END IF;

  SELECT d.tipo_control INTO v_tipo_control
  FROM fsj.partida p
  JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
  WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.partida_id;

  IF v_tipo_control IS NULL OR v_tipo_control = 'NINGUNO' THEN
    RETURN NEW;
  END IF;

  SELECT fecha_activacion_contralor INTO v_activacion FROM fsj.tenant WHERE id = NEW.tenant_id;

  IF v_activacion IS NULL OR NEW.registrado_en < v_activacion THEN
    RETURN NEW;
  END IF;

  IF NEW.numero_vale_adquisicion IS NULL THEN
    RAISE EXCEPTION 'INV-L16: INGRESO_COMPRA of a controlled droga requires numero_vale_adquisicion once the contralor is active' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_movimiento_stock_validar_vale
  BEFORE INSERT ON fsj.movimiento_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.movimiento_stock_validar_vale();

-- ============================================================================
-- 7. movimiento_stock.linea_pesaje_id (deferred from 0008, per its header)
-- + the deferred INV-S12 consumption-sum check (revised by
-- docs/specs/ficha-tecnica.md). See migration header point 7 for scope.
-- ============================================================================
ALTER TABLE fsj.movimiento_stock ADD COLUMN IF NOT EXISTS linea_pesaje_id uuid;

ALTER TABLE fsj.movimiento_stock
  ADD CONSTRAINT movimiento_stock_linea_pesaje_fkey
  FOREIGN KEY (tenant_id, linea_pesaje_id) REFERENCES fsj.linea_pesaje (tenant_id, id);

ALTER TABLE fsj.movimiento_stock
  ADD CONSTRAINT movimiento_stock_linea_pesaje_check
  CHECK (tipo <> 'EGRESO_PREPARACION' OR linea_pesaje_id IS NOT NULL);

COMMENT ON COLUMN fsj.movimiento_stock.linea_pesaje_id IS
  'S12/S13/S19/S20 (revised by docs/specs/ficha-tecnica.md): required for EGRESO_PREPARACION. Deferred constraint trigger below checks that the SUM of a linea''s EGRESO_PREPARACION movements equals cantidad_a_pesar (non-manual lines) or is > 0 (manual-enrase lines) by commit time.';

CREATE OR REPLACE FUNCTION fsj.linea_pesaje_validar_consumo(p_tenant_id uuid, p_linea_pesaje_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_manual        boolean;
  v_cantidad      numeric;
  v_sum           numeric;
BEGIN
  SELECT es_enrase_manual, cantidad_a_pesar INTO v_manual, v_cantidad
  FROM fsj.linea_pesaje
  WHERE tenant_id = p_tenant_id AND id = p_linea_pesaje_id;

  SELECT coalesce(sum(cantidad), 0) INTO v_sum
  FROM fsj.movimiento_stock
  WHERE tenant_id = p_tenant_id AND linea_pesaje_id = p_linea_pesaje_id AND tipo = 'EGRESO_PREPARACION';

  IF v_manual THEN
    IF v_sum <= 0 THEN
      RAISE EXCEPTION 'INV-S12: manual-enrase linea_pesaje % must have a positive registered consumption (found %)', p_linea_pesaje_id, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF v_sum <> v_cantidad THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % consumption must equal cantidad_a_pesar % (found %)', p_linea_pesaje_id, v_cantidad, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.trg_movimiento_stock_check_linea_pesaje()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.linea_pesaje_id IS NOT NULL THEN
    PERFORM fsj.linea_pesaje_validar_consumo(NEW.tenant_id, NEW.linea_pesaje_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_movimiento_stock_linea_pesaje_consumo
  AFTER INSERT ON fsj.movimiento_stock
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_movimiento_stock_check_linea_pesaje();

-- ============================================================================
-- 8a. INV-P04: bidirectional deferred constraint trigger between
-- fsj.preparacion and fsj.asiento_recetario.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.preparacion_validar_asiento(p_tenant_id uuid, p_preparacion_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_estado fsj.estado_preparacion;
BEGIN
  SELECT estado INTO v_estado FROM fsj.preparacion WHERE tenant_id = p_tenant_id AND id = p_preparacion_id;

  IF v_estado = 'CONFIRMADA' THEN
    IF NOT EXISTS (
      SELECT 1 FROM fsj.asiento_recetario
      WHERE tenant_id = p_tenant_id AND preparacion_id = p_preparacion_id AND origen = 'SISTEMA'
    ) THEN
      RAISE EXCEPTION 'INV-P04: preparacion % is CONFIRMADA but has no SISTEMA asiento_recetario', p_preparacion_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.trg_preparacion_check_asiento()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.preparacion_validar_asiento(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_preparacion_asiento_p04
  AFTER INSERT OR UPDATE ON fsj.preparacion
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_preparacion_check_asiento();

CREATE OR REPLACE FUNCTION fsj.asiento_recetario_validar_preparacion(p_tenant_id uuid, p_asiento_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_origen          fsj.origen_asiento;
  v_preparacion_id  uuid;
  v_estado          fsj.estado_preparacion;
BEGIN
  SELECT origen, preparacion_id INTO v_origen, v_preparacion_id
  FROM fsj.asiento_recetario
  WHERE tenant_id = p_tenant_id AND id = p_asiento_id;

  IF v_origen <> 'SISTEMA' THEN
    RETURN;
  END IF;

  SELECT estado INTO v_estado FROM fsj.preparacion WHERE tenant_id = p_tenant_id AND id = v_preparacion_id;

  IF v_estado IS DISTINCT FROM 'CONFIRMADA' THEN
    RAISE EXCEPTION 'INV-P04: asiento_recetario % (SISTEMA) requires its preparacion % to be CONFIRMADA (is %)', p_asiento_id, v_preparacion_id, v_estado
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.trg_asiento_recetario_check_preparacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.asiento_recetario_validar_preparacion(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_asiento_recetario_p04
  AFTER INSERT ON fsj.asiento_recetario
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_asiento_recetario_check_preparacion();

-- ============================================================================
-- 8b. INV-L08: deferred constraint trigger on movimiento_stock requiring a
-- matching asiento_contralor row when the contralor is active for a
-- controlled drug's movement (dated on/after fecha_activacion_contralor --
-- no retroactive asientos for older movements, per spec section 4).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.movimiento_stock_validar_contralor(p_tenant_id uuid, p_movimiento_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_mov          fsj.movimiento_stock%ROWTYPE;
  v_activacion   timestamptz;
  v_tipo_control fsj.tipo_control;
BEGIN
  SELECT * INTO v_mov FROM fsj.movimiento_stock WHERE tenant_id = p_tenant_id AND id = p_movimiento_id;

  SELECT fecha_activacion_contralor INTO v_activacion FROM fsj.tenant WHERE id = p_tenant_id;
  IF v_activacion IS NULL OR v_mov.registrado_en < v_activacion THEN
    RETURN;
  END IF;

  SELECT d.tipo_control INTO v_tipo_control
  FROM fsj.partida p
  JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
  WHERE p.tenant_id = p_tenant_id AND p.id = v_mov.partida_id;

  IF v_tipo_control IS NULL OR v_tipo_control = 'NINGUNO' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM fsj.asiento_contralor WHERE tenant_id = p_tenant_id AND movimiento_stock_id = p_movimiento_id) THEN
    RAISE EXCEPTION 'INV-L08: movimiento_stock % on controlled droga (tipo_control %) requires a matching asiento_contralor', p_movimiento_id, v_tipo_control
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.trg_movimiento_stock_check_contralor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.movimiento_stock_validar_contralor(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_movimiento_stock_contralor_obligatorio
  AFTER INSERT ON fsj.movimiento_stock
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_movimiento_stock_check_contralor();

-- ============================================================================
-- 9. Switch migration 0008's two current_date-using functions to
-- fsj.jornada_actual() -- via CREATE OR REPLACE in this NEW migration,
-- without editing 0008's file (task instruction).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.movimiento_stock_validar_ajuste()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tipo = 'AJUSTE'
     AND NEW.autorizado_por_id IS NOT NULL
     AND NOT fsj.es_dt_vigente(NEW.autorizado_por_id, fsj.jornada_actual(NEW.tenant_id)) THEN
    RAISE EXCEPTION 'INV-U05: AJUSTE autorizado_por_id % is not a DT vigente today', NEW.autorizado_por_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.movimiento_stock_validar_ajuste() IS
  'INV-U05. Updated by migration 0014 to use fsj.jornada_actual(tenant_id) instead of current_date (server date) -- see migration 0014 header point 9.';

CREATE OR REPLACE FUNCTION fsj.movimiento_stock_aplicar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_delta               numeric;
  v_fecha_vencimiento    date;
BEGIN
  IF NEW.tipo = 'INGRESO_COMPRA' THEN
    v_delta := NEW.cantidad;
  ELSE
    v_delta := -NEW.cantidad;
  END IF;

  IF NEW.tipo = 'EGRESO_PREPARACION' THEN
    SELECT fecha_vencimiento INTO v_fecha_vencimiento
    FROM fsj.partida WHERE id = NEW.partida_id;

    IF v_fecha_vencimiento < fsj.jornada_actual(NEW.tenant_id) THEN
      RAISE EXCEPTION 'INV-S10: cannot register EGRESO_PREPARACION against expired partida % (fecha_vencimiento %)',
        NEW.partida_id, v_fecha_vencimiento
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM set_config('fsj.mov', 'on', true);

  UPDATE fsj.partida
  SET cantidad_disponible = cantidad_disponible + v_delta,
      fecha_apertura = CASE
        WHEN NEW.tipo = 'EGRESO_PREPARACION' AND fecha_apertura IS NULL THEN NEW.registrado_en
        ELSE fecha_apertura
      END
  WHERE id = NEW.partida_id;

  PERFORM set_config('fsj.mov', 'off', true);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.movimiento_stock_aplicar() IS
  'INV-S01/S04, INV-S16/S17, INV-S10. Updated by migration 0014 to use fsj.jornada_actual(tenant_id) instead of current_date -- see migration 0014 header point 9.';

-- ============================================================================
-- Backfill: every EXISTING tenant gets its 3 libro_rubricado rows (RECETARIO
-- always; PSICOTROPICO/ESTUPEFACIENTE too -- see migration header
-- DEDUCCION), registered by that tenant's own SISTEMA user.
-- ============================================================================
INSERT INTO fsj.libro_rubricado (tenant_id, tipo, numero, fecha_rubrica, registrado_por_id)
SELECT t.id, v.tipo, '1', t.creado_en::date, u.id
FROM fsj.tenant t
CROSS JOIN (VALUES ('RECETARIO'::fsj.tipo_libro), ('PSICOTROPICO'::fsj.tipo_libro), ('ESTUPEFACIENTE'::fsj.tipo_libro)) AS v(tipo)
JOIN LATERAL (
  SELECT id FROM fsj.usuario WHERE tenant_id = t.id AND es_tecnico = true ORDER BY creado_en LIMIT 1
) u ON true
WHERE NOT EXISTS (
  SELECT 1 FROM fsj.libro_rubricado lr WHERE lr.tenant_id = t.id AND lr.tipo = v.tipo
);

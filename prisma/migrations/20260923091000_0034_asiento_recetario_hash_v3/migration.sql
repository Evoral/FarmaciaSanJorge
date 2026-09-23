-- 0034_asiento_recetario_hash_v3
--
-- D4 (user decision, 2026-09-23): hash V3 for asiento_recetario, now
-- covering its detalle_asiento lines -- closing the gap where a tampered
-- detalle line (droga/cantidad/unidad changed after the fact) was invisible
-- to fsj.verificar_cadena, which only ever recomputed the asiento's OWN
-- columns (V1/V2).
--
-- DESIGN (per task's recommendation, validated -- no deviation needed):
--   1. asiento_recetario.version_hash smallint NOT NULL DEFAULT 2 --
--      existing rows keep 2; every NEW insert is pinned to 3 by the BEFORE
--      INSERT trigger below (NOT by the column default: the app never
--      overrides it, but pinning it in the trigger keeps the invariant
--      true regardless of what a future caller might send).
--   2. The app now INSERTS detalle_asiento rows BEFORE the asiento_recetario
--      row, in the SAME transaction, using an APP-GENERATED asiento UUID
--      (passed explicitly as `id` on both the detalle rows'
--      asiento_recetario_id and the asiento's own `id` -- Postgres only
--      applies a column DEFAULT when the INSERT omits that column, so an
--      explicit id bypasses extensions.gen_random_uuid() and is what the
--      BEFORE INSERT trigger below sees as NEW.id). See
--      modules/preparaciones/infrastructure/preparacion-repository.ts
--      (insertAsientoRecetario) for the new order.
--   3. This REQUIRES detalle_asiento's FK to asiento_recetario to become
--      DEFERRABLE INITIALLY DEFERRED (the detalle rows point at an asiento
--      id that does not exist yet at the moment they are inserted).
--   4. asiento_recetario_preparar (the BEFORE INSERT trigger) now reads
--      "WHERE asiento_recetario_id = NEW.id ORDER BY orden" (NEW.id is
--      already the app-provided value by BEFORE INSERT time) and folds
--      each line (orden, descripcion, cantidad::text, unidad_texto,
--      linea_pesaje_id) into the fsj.hash_v2 payload, tag 'FSJ-ASIENTO-V3'.
--   5. A NEW BEFORE INSERT trigger on detalle_asiento (INV-L23) rejects a
--      detalle whose asiento_recetario_id ALREADY EXISTS -- freezing the
--      hashed line set at the moment the asiento is inserted (no line can
--      ever be added afterwards, matching the fully-immutable spirit of
--      both tables).
--   6. SISTEMA asientos require >= 1 detalle_asiento row at insert time
--      (INV-L22); RECTIFICATIVO asientos may have zero (D3: no data lines,
--      only "sin efecto").
--   7. fsj.verificar_cadena now recomputes EACH asiento_recetario row with
--      the hash function that matches ITS OWN stored version_hash (1/2/3)
--      instead of "trial and error" against V1/V2 in sequence -- simpler
--      and strictly more precise than migration 0018's ratchet, since the
--      row itself says which algorithm produced it. asiento_contralor is
--      UNCHANGED (out of scope for D4 -- no detalle-like child rows exist
--      there); its branch keeps the V1/V2 trial logic exactly as migration
--      0018 left it.
--
-- Existing tests that insert a SISTEMA asiento_recetario directly via SQL
-- (tests/db/fixtures.ts#seedAsientoSistema and every test file that rolls
-- its own INSERT INTO fsj.asiento_recetario for a SISTEMA row) are updated
-- in the SAME change to insert one detalle_asiento row first, against a
-- pre-generated id -- see this migration's companion test changes.

-- ============================================================================
-- 1. version_hash column.
-- ============================================================================
ALTER TABLE fsj.asiento_recetario ADD COLUMN IF NOT EXISTS version_hash smallint NOT NULL DEFAULT 2;

COMMENT ON COLUMN fsj.asiento_recetario.version_hash IS
  'Which hash_integridad serialization produced this row: 1 (migration 0014, byte-unsafe), 2 (migration 0018, asiento-only fields), 3 (migration 0034, includes detalle_asiento lines). Existing rows before this migration are 2 (the column default); every row inserted from this migration forward is pinned to 3 by fsj.asiento_recetario_preparar, never by the app.';

-- Full immutability (INV-L01): version_hash joins the frozen column list in
-- the BEFORE UPDATE guard (fsj_app has no UPDATE grant on this table at
-- all, so this is defense in depth, same posture as every other column
-- added to this trigger since migration 0014).
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
     OR NEW.version_hash IS DISTINCT FROM OLD.version_hash
     OR NEW.hash_integridad IS DISTINCT FROM OLD.hash_integridad
     OR NEW.hash_anterior IS DISTINCT FROM OLD.hash_anterior
     OR NEW.registrado_por_id IS DISTINCT FROM OLD.registrado_por_id
  THEN
    RAISE EXCEPTION 'INV-L01: asiento_recetario rows are immutable except cierre_diario_id (once) and estado VIGENTE->ANULADO' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. detalle_asiento -> asiento_recetario FK becomes DEFERRABLE INITIALLY
-- DEFERRED (the detalle rows are now inserted BEFORE their asiento).
-- ============================================================================
ALTER TABLE fsj.detalle_asiento DROP CONSTRAINT detalle_asiento_asiento_fkey;
ALTER TABLE fsj.detalle_asiento
  ADD CONSTRAINT detalle_asiento_asiento_fkey
  FOREIGN KEY (tenant_id, asiento_recetario_id) REFERENCES fsj.asiento_recetario (tenant_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- ============================================================================
-- 3. INV-L23: a detalle_asiento cannot be inserted once its asiento
-- already exists -- freezes the hashed line set at asiento insert time.
-- Runs BEFORE the (now deferred) FK, so it always fires -- the FK alone
-- would never catch a "too late" insert (the referenced asiento DOES
-- exist, so the FK itself is perfectly satisfied).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.detalle_asiento_validar_congelado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.asiento_recetario WHERE tenant_id = NEW.tenant_id AND id = NEW.asiento_recetario_id) THEN
    RAISE EXCEPTION 'INV-L23: cannot insert detalle_asiento % for asiento_recetario % -- that asiento already exists, so its hashed line set is frozen', NEW.id, NEW.asiento_recetario_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.detalle_asiento_validar_congelado() IS
  'INV-L23 (migration 0034): rejects a detalle_asiento INSERT whose asiento_recetario_id already exists in fsj.asiento_recetario. Detalle rows must be inserted BEFORE their asiento (app-generated id) -- see migration 0034 header.';

CREATE TRIGGER trg_detalle_asiento_validar_congelado
  BEFORE INSERT ON fsj.detalle_asiento
  FOR EACH ROW EXECUTE FUNCTION fsj.detalle_asiento_validar_congelado();

-- ============================================================================
-- 4. fsj.asiento_recetario_hash_v3: like asiento_recetario_hash_v2 (0018),
-- plus the ordered detalle_asiento lines. STABLE plpgsql (needs a query),
-- unlike the pure-SQL V1/V2 functions.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_recetario_hash_v3(r fsj.asiento_recetario)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = fsj, extensions
AS $$
DECLARE
  v_detalle  RECORD;
  v_n        integer := 0;
  v_lineas   text[] := ARRAY[]::text[];
  v_campos   text[];
BEGIN
  FOR v_detalle IN
    SELECT orden, descripcion, cantidad, unidad_texto, linea_pesaje_id
    FROM fsj.detalle_asiento
    WHERE tenant_id = r.tenant_id AND asiento_recetario_id = r.id
    ORDER BY orden
  LOOP
    v_n := v_n + 1;
    v_lineas := v_lineas || ARRAY[
      v_detalle.orden::text,
      v_detalle.descripcion,
      v_detalle.cantidad::text,
      v_detalle.unidad_texto,
      v_detalle.linea_pesaje_id::text
    ];
  END LOOP;

  v_campos := ARRAY[
    'FSJ-ASIENTO-V3',
    r.tenant_id::text,
    r.libro_id::text,
    r.numero_correlativo::text,
    to_char(r.fecha_asiento, 'YYYY-MM-DD'),
    r.origen::text,
    r.preparacion_id::text,
    r.asiento_original_id::text,
    r.paciente_texto,
    r.medico_texto,
    r.formula_texto,
    r.hash_anterior,
    v_n::text
  ] || v_lineas;

  RETURN fsj.hash_v2(v_campos);
END;
$$;

COMMENT ON FUNCTION fsj.asiento_recetario_hash_v3(fsj.asiento_recetario) IS
  'hash_integridad V3 of an asiento_recetario row (tag FSJ-ASIENTO-V3, migration 0034): the same fields as V2, plus the row''s own detalle_asiento lines (orden, descripcion, cantidad, unidad_texto, linea_pesaje_id, ORDER BY orden), prefixed by their count for injectivity (same convention as fsj.cierre_diario_firmar''s hash_lote). Used by the BEFORE INSERT trigger and by fsj.verificar_cadena.';

GRANT EXECUTE ON FUNCTION fsj.asiento_recetario_hash_v3(fsj.asiento_recetario) TO fsj_app;

-- ============================================================================
-- 5. asiento_recetario BEFORE INSERT ("preparar"): V3 hash, version_hash
-- := 3, and INV-L22 (SISTEMA requires >= 1 detalle at insert time).
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
  v_detalles       bigint;
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
  -- D4: every asiento inserted from this migration forward is hashed V3,
  -- regardless of what (if anything) the app sent for this column.
  NEW.version_hash := 3;

  IF NEW.origen = 'RECTIFICATIVO' THEN
    SELECT * INTO v_original
    FROM fsj.asiento_recetario
    WHERE tenant_id = NEW.tenant_id AND id = NEW.asiento_original_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INV-L18: asiento_original_id % not found', NEW.asiento_original_id USING ERRCODE = 'P0001';
    END IF;
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
  ELSE
    -- INV-L22 (D4): a SISTEMA asiento requires its detalle_asiento rows to
    -- have been inserted ALREADY, against NEW.id (app-generated -- see
    -- migration header). RECTIFICATIVO asientos are exempt (D3: no lines).
    SELECT count(*) INTO v_detalles
    FROM fsj.detalle_asiento
    WHERE tenant_id = NEW.tenant_id AND asiento_recetario_id = NEW.id;

    IF v_detalles = 0 THEN
      RAISE EXCEPTION 'INV-L22: a SISTEMA asiento_recetario requires at least one detalle_asiento row, inserted BEFORE it with the same (app-generated) id (asiento %)', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- RECETARIO is the lowest-ranked counter: locking it alone respects the
  -- global counter lock order (migration 0018 header, B1).
  SELECT numero, hash_anterior INTO v_numero, v_hash_anterior
  FROM fsj.contador_correlativo_tomar(NEW.tenant_id, v_libro_id);

  NEW.numero_correlativo := v_numero;
  NEW.hash_anterior := v_hash_anterior;
  NEW.hash_integridad := fsj.asiento_recetario_hash_v3(NEW);

  UPDATE fsj.contador_correlativo
  SET ultimo_valor = v_numero, ultimo_hash = NEW.hash_integridad
  WHERE tenant_id = NEW.tenant_id AND libro_id = v_libro_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.asiento_recetario_preparar() IS
  'BEFORE INSERT on asiento_recetario. D4 (migration 0034): pins version_hash=3 and hashes with fsj.asiento_recetario_hash_v3 (includes detalle_asiento lines, which must already exist under NEW.id -- INV-L22 for SISTEMA). INV-L18 for RECTIFICATIVO unchanged from migration 0018.';

-- ============================================================================
-- 6. fsj.verificar_cadena: recompute each asiento_recetario row with the
-- function matching ITS OWN version_hash (1/2/3), not by trial. Simpler
-- and strictly more precise than the migration 0018 ratchet. The
-- asiento_contralor branch is UNCHANGED (out of scope for D4).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.verificar_cadena(p_tenant uuid, p_libro uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = fsj, extensions
AS $$
DECLARE
  v_tipo          fsj.tipo_libro;
  v_esperado      bigint := 1;
  v_prev          text := fsj.hash_genesis();
  v_v2_visto      boolean := false;
  v_rec           fsj.asiento_recetario%ROWTYPE;
  v_con           fsj.asiento_contralor%ROWTYPE;
  v_hash_esperado text;
  v_ult_valor     bigint;
  v_ult_hash      text;
BEGIN
  SELECT tipo INTO v_tipo FROM fsj.libro_rubricado WHERE tenant_id = p_tenant AND id = p_libro;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-L03: libro % not found for tenant %', p_libro, p_tenant USING ERRCODE = 'P0001';
  END IF;

  IF v_tipo = 'RECETARIO' THEN
    FOR v_rec IN
      SELECT * FROM fsj.asiento_recetario
      WHERE tenant_id = p_tenant AND libro_id = p_libro
      ORDER BY numero_correlativo
    LOOP
      IF v_rec.numero_correlativo <> v_esperado OR v_rec.hash_anterior IS DISTINCT FROM v_prev THEN
        RETURN v_esperado;
      END IF;

      v_hash_esperado := CASE v_rec.version_hash
        WHEN 3 THEN fsj.asiento_recetario_hash_v3(v_rec)
        WHEN 2 THEN fsj.asiento_recetario_hash_v2(v_rec)
        ELSE fsj.asiento_recetario_hash_v1(v_rec)
      END;
      IF v_rec.hash_integridad IS DISTINCT FROM v_hash_esperado THEN
        RETURN v_rec.numero_correlativo;
      END IF;

      v_prev := v_rec.hash_integridad;
      v_esperado := v_esperado + 1;
    END LOOP;
  ELSE
    FOR v_con IN
      SELECT * FROM fsj.asiento_contralor
      WHERE tenant_id = p_tenant AND libro_id = p_libro
      ORDER BY numero_correlativo
    LOOP
      IF v_con.numero_correlativo <> v_esperado OR v_con.hash_anterior IS DISTINCT FROM v_prev THEN
        RETURN v_esperado;
      END IF;
      IF v_con.hash_integridad = fsj.asiento_contralor_hash_v2(v_con) THEN
        v_v2_visto := true;
      ELSIF v_v2_visto OR v_con.hash_integridad IS DISTINCT FROM fsj.asiento_contralor_hash_v1(v_con) THEN
        RETURN v_con.numero_correlativo;
      END IF;
      v_prev := v_con.hash_integridad;
      v_esperado := v_esperado + 1;
    END LOOP;
  END IF;

  -- Tail check: the counter must agree with the last row (detects removed
  -- trailing rows, or a counter advanced without a row).
  SELECT ultimo_valor, ultimo_hash INTO v_ult_valor, v_ult_hash
  FROM fsj.contador_correlativo
  WHERE tenant_id = p_tenant AND libro_id = p_libro;
  IF FOUND AND (v_ult_valor <> v_esperado - 1 OR v_ult_hash IS DISTINCT FROM v_prev) THEN
    RETURN v_esperado;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fsj.verificar_cadena(uuid, uuid) IS
  'Recomputes the hash chain of one libro. asiento_recetario rows: recomputed with the function matching their OWN stored version_hash (1/2/3 -- migration 0034). asiento_contralor rows: unchanged V1/V2 trial (migration 0018) -- D4 did not touch that table. Returns the first broken numero_correlativo, or NULL if intact. SECURITY INVOKER: RLS scopes it to the caller''s tenant.';

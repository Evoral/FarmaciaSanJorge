-- 0018_legal_core_fixes
--
-- Confirmed defect fixes for the legal core built by migrations 0014-0017
-- (docs/specs/libro-recetario-y-contralor.md). 0014-0017 are already
-- applied and are NOT edited in place (Prisma checksums); everything here
-- is CREATE OR REPLACE / ALTER / DROP+CREATE on top of them.
--
--   B1  Contralor saldo race (fsj.asiento_contralor_preparar).
--   B2  Deterministic, injective hash serialization V2 (+ fsj.verificar_cadena).
--   B3  libro_rubricado no longer fabricates official rubric data (DP-38).
--   M1  fsj.v_grants_legal exposes INSERT (and TRUNCATE).
--   M2  INV-C19 also blocks on unsigned contralor-only jornadas; hash_lote V2
--       also seals the contralor asientos linked to the cierre.
--   M3  The legal-table set of fsj.v_grants_legal is derived structurally.
--   N2/N3 fsj.jornada_de(instante, zona); fsj.jornada_actual delegates to it.
--
-- fsj.tenant had 0 rows when this was written, so no data migration is
-- needed; every step is still written to be safe if rows existed (see the
-- per-section notes, esp. B2's V1 legacy handling and B3).
--
-- ============================================================================
-- B1 -- WHY `SELECT ... ORDER BY numero_correlativo DESC LIMIT 1 FOR UPDATE`
-- WAS WRONG, AND WHY LOCKING THE COUNTER FIRST FIXES IT
-- ============================================================================
-- 0014 read the droga's previous saldo with
--     SELECT saldo_posterior ... ORDER BY numero_correlativo DESC LIMIT 1 FOR UPDATE
-- BEFORE locking the libro's counter. Two concurrent movements A and B of
-- the same droga: both run that SELECT against the same snapshot and both
-- pick the same "last" row R. A locks R, inserts R', commits. B was blocked
-- on R; when A commits, Postgres (READ COMMITTED, EvalPlanQual) re-checks
-- ONLY the row B had already chosen (R, still matching the WHERE clause) --
-- it never re-runs the ORDER BY/LIMIT, so B never discovers the newer row
-- R' that A just inserted. B then computes saldo_anterior from R: a stale
-- balance, silently breaking INV-L13 (and possibly INV-L14).
--
-- Fix: the FIRST thing the trigger does (after resolving which libro) is
-- lock the libro's counter row (fsj.contador_correlativo_tomar, FOR UPDATE).
-- Every insert into that libro serializes on that single row. Only AFTER
-- the lock wait does it read the previous saldo, with a PLAIN SELECT in a
-- NEW statement. Under READ COMMITTED each statement of a (volatile)
-- plpgsql function takes a fresh snapshot, so that SELECT sees every row
-- committed by whoever held the counter before us -- including R'. No
-- FOR UPDATE is needed on the asiento row itself: rows are immutable and
-- the counter lock already excludes every other writer of this libro.
-- Under REPEATABLE READ/SERIALIZABLE the counter's FOR UPDATE raises a
-- serialization failure (40001) instead of proceeding on a stale snapshot,
-- so the fix fails closed there too.
--
-- ============================================================================
-- B1 -- LOCK ORDERING (deadlock freedom)
-- ============================================================================
-- Counter rows of one tenant are ranked by (libro.tipo enum order, libro.id):
-- RECETARIO < PSICOTROPICO < ESTUPEFACIENTE. Rule, enforced IN THE DB:
--   * fsj.asiento_recetario_preparar locks only the RECETARIO counter (the
--     lowest rank).
--   * fsj.asiento_contralor_preparar first locks, in rank order, every OPEN
--     libro counter of the tenant ranked BELOW its target libro (i.e. the
--     RECETARIO counter, and the PSICOTROPICO one when the target is
--     ESTUPEFACIENTE), then the target counter itself.
-- Consequently the set of counters any transaction holds is always a
-- rank-prefix, and every counter lock it waits for ranks above everything
-- it holds -- classic ordered locking, so no wait cycle (deadlock) between
-- counters can form, whatever order the application inserts in. A
-- preparacion confirmation writing one asiento_recetario plus EGRESO
-- contralor asientos in both contralor books therefore always acquires
-- RECETARIO -> PSICOTROPICO -> ESTUPEFACIENTE. (The EGRESO row's FK to
-- asiento_recetario already forces "recetario first" structurally; the
-- prefix rule makes the contralor-vs-contralor order independent of app
-- code.) Cost: contralor inserts also serialize with recetario inserts of
-- the same tenant until commit -- negligible at a single pharmacy's volume.
-- Out of scope of this rule: partida row locks taken by
-- movimiento_stock_aplicar (always acquired BEFORE the counters, because an
-- INGRESO/EGRESO/AJUSTE asiento_contralor has a non-deferrable FK to its
-- movimiento_stock) -- the order among several partidas in one confirmation
-- is an application concern (FASE 8: lock partidas in id order).
--
-- ============================================================================
-- B2 -- HASH SERIALIZATION V2 (normative; reproduce byte for byte)
-- ============================================================================
-- Problems with V1: fecha_asiento::text depends on the session DateStyle,
-- and fields joined with chr(31) are not injective (a free-text field
-- containing chr(31) shifts field boundaries, so two DIFFERENT rows can
-- produce the SAME payload).
--
-- V2 encoding of ONE field f (a text value or NULL):
--     f IS NULL      ->  the single byte '-'  (0x2D, no length prefix)
--     otherwise      ->  L ':' B
--        B = the UTF-8 bytes of f (convert_to(f, 'UTF8'))
--        L = the number of BYTES in B (not characters), written in base 10,
--            ASCII digits, no sign, no leading zeros ('0' for the empty string)
--        ':' = the single byte 0x3A
--   Because a non-NULL encoding always starts with an ASCII digit and the
--   NULL token is '-', and every non-NULL field declares its own byte
--   length, the concatenation of encoded fields is uniquely decodable
--   (injective) with no escaping, whatever bytes the fields contain.
--
-- payload  = encode(field_1) || encode(field_2) || ... || encode(field_n)
--            (plain concatenation, NO separator). field_1 is ALWAYS the
--            version tag, encoded like any other field.
-- hash     = lowercase hex of SHA-256(payload)         (64 hex chars)
--
-- Canonical text form of each column type (all independent of session
-- settings such as DateStyle, TimeZone, lc_*):
--   uuid         lowercase 8-4-4-4-12 hyphenated (uuid::text)
--   bigint       base-10 ASCII, '-' sign if negative (bigint::text)
--   numeric      Postgres numeric output of the STORED value: plain
--                decimal, no exponent, scale as stored ('10' and '10.000'
--                differ) (numeric::text)
--   date         to_char(d, 'YYYY-MM-DD')
--   timestamptz  to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
--                (no V2 payload currently contains a timestamp; this is the
--                rule any future V2 field of that type MUST use)
--   enum         its label (enum::text)
--   text         as stored
--
-- asiento_recetario  (tag 'FSJ-ASIENTO-V2'), fields in this exact order:
--   tag, tenant_id, libro_id, numero_correlativo, fecha_asiento, origen,
--   preparacion_id, asiento_original_id, paciente_texto, medico_texto,
--   formula_texto, hash_anterior
-- asiento_contralor  (tag 'FSJ-ASIENTO-CONTRALOR-V2'):
--   tag, tenant_id, libro_id, numero_correlativo, fecha_asiento,
--   tipo_movimiento, droga_id, droga_descripcion, cantidad,
--   unidad_medida_id, saldo_anterior, saldo_posterior, movimiento_stock_id,
--   asiento_recetario_id, numero_vale_adquisicion, hash_anterior
--   (`estado` is deliberately NOT hashed in V2, unlike V1: it is the one
--   legally mutable column of asiento_recetario (VIGENTE -> ANULADO via
--   anulacion_asiento, itself immutable), so hashing it made every anulled
--   asiento fail re-verification. At insert time it is always VIGENTE.)
-- cierre_diario.hash_lote  (tag 'FSJ-CIERRE-V2'; cierre_diario.version_formato = 2):
--   tag, tenant_id, fecha, N, h_1..h_N, M, k_1..k_M
--   N   = count of the VIGENTE asiento_recetario rows linked to this cierre
--         (= cantidad_asientos); h_i their hash_integridad, ORDER BY
--         numero_correlativo
--   M   = count of the VIGENTE asiento_contralor rows linked to this cierre;
--         k_j their hash_integridad, ORDER BY libro_id::text, numero_correlativo
--   (N and M are bigint text.)
--
-- Genesis: unchanged -- hash_anterior of the first asiento of every libro
-- is fsj.hash_genesis() = hex(SHA-256('FSJ-LIBRO-GENESIS-V1')). It is a
-- constant, not a serialization, so it keeps its V1 name.
--
-- Legacy V1 rows: none exist in any environment (fsj.tenant was empty), but
-- fsj.verificar_cadena still accepts a V1-hashed row as long as it precedes
-- every V2 row of its libro (a chain can switch V1 -> V2 once, never back).
--
-- ============================================================================
-- B3 -- libro_rubricado rubric data (DP-38)
-- ============================================================================
-- numero / fecha_rubrica / expediente_rubrica are issued by the health
-- authority. The libro_recetario of this system is the pharmacy's OWN
-- digital book, not the physical rubricated one (DP-38, pending with the
-- Asociacion de Farmacias). Inventing '1' / current_date created a false
-- official record that the immutability trigger then made uncorrectable.
-- Now: all three are nullable, books are created with them NULL, and each
-- allows exactly one NULL -> value transition (never value -> other value,
-- never value -> NULL), mirroring fecha_cierre. If fabricated rows already
-- existed they are NOT auto-nulled here (a legal table must not be silently
-- rewritten by a migration): they would need a documented, audited manual
-- correction once DP-38 resolves.

-- ============================================================================
-- N2/N3. fsj.jornada_de + fsj.jornada_actual delegating to it.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.jornada_de(p_instante timestamptz, p_zona text)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (p_instante AT TIME ZONE p_zona)::date;
$$;

COMMENT ON FUNCTION fsj.jornada_de(timestamptz, text) IS
  'The jornada (business date) that instant p_instante falls on in time zone p_zona (IANA name). Mirrors shared/time/jornada.ts#jornadaDe. Every legal date decision goes through this (directly or via fsj.jornada_actual) -- never current_date/now()::date.';

GRANT EXECUTE ON FUNCTION fsj.jornada_de(timestamptz, text) TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.jornada_actual(p_tenant_id uuid)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT fsj.jornada_de(now(), t.zona_horaria)
  FROM fsj.tenant t
  WHERE t.id = p_tenant_id;
$$;

COMMENT ON FUNCTION fsj.jornada_actual(uuid) IS
  'The tenant''s current jornada: fsj.jornada_de(now(), tenant.zona_horaria). Use this everywhere a legal date is decided -- never current_date/now()::date directly.';

-- ============================================================================
-- B2. V2 serialization primitives.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.hash_campo_v2(p_valor text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_valor IS NULL THEN '-'
    ELSE octet_length(convert_to(p_valor, 'UTF8'))::text || ':' || p_valor
  END;
$$;

COMMENT ON FUNCTION fsj.hash_campo_v2(text) IS
  'Hash serialization V2, one field: NULL -> ''-''; otherwise <UTF-8 byte length>:<value>. See migration 0018 header for the full normative format.';

CREATE OR REPLACE FUNCTION fsj.hash_v2(p_campos text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = fsj, extensions
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(coalesce((SELECT string_agg(fsj.hash_campo_v2(u.campo), '' ORDER BY u.ord)
                           FROM unnest(p_campos) WITH ORDINALITY AS u(campo, ord)), ''), 'UTF8'),
      'sha256'),
    'hex');
$$;

COMMENT ON FUNCTION fsj.hash_v2(text[]) IS
  'Hash serialization V2: lowercase hex SHA-256 over the concatenation (no separator) of fsj.hash_campo_v2(field) for every array element in order (NULL elements -> ''-''). The first element is always the version tag. See migration 0018 header.';

GRANT EXECUTE ON FUNCTION fsj.hash_campo_v2(text) TO fsj_app;
GRANT EXECUTE ON FUNCTION fsj.hash_v2(text[]) TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.asiento_recetario_hash_v2(r fsj.asiento_recetario)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = fsj, extensions
AS $$
  SELECT fsj.hash_v2(ARRAY[
    'FSJ-ASIENTO-V2',
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
    r.hash_anterior
  ]);
$$;

COMMENT ON FUNCTION fsj.asiento_recetario_hash_v2(fsj.asiento_recetario) IS
  'hash_integridad V2 of an asiento_recetario row (tag FSJ-ASIENTO-V2). Used by the BEFORE INSERT trigger and by fsj.verificar_cadena. Field list: migration 0018 header.';

CREATE OR REPLACE FUNCTION fsj.asiento_contralor_hash_v2(r fsj.asiento_contralor)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = fsj, extensions
AS $$
  SELECT fsj.hash_v2(ARRAY[
    'FSJ-ASIENTO-CONTRALOR-V2',
    r.tenant_id::text,
    r.libro_id::text,
    r.numero_correlativo::text,
    to_char(r.fecha_asiento, 'YYYY-MM-DD'),
    r.tipo_movimiento::text,
    r.droga_id::text,
    r.droga_descripcion,
    r.cantidad::text,
    r.unidad_medida_id::text,
    r.saldo_anterior::text,
    r.saldo_posterior::text,
    r.movimiento_stock_id::text,
    r.asiento_recetario_id::text,
    r.numero_vale_adquisicion,
    r.hash_anterior
  ]);
$$;

COMMENT ON FUNCTION fsj.asiento_contralor_hash_v2(fsj.asiento_contralor) IS
  'hash_integridad V2 of an asiento_contralor row (tag FSJ-ASIENTO-CONTRALOR-V2). Used by the BEFORE INSERT trigger and by fsj.verificar_cadena. Field list: migration 0018 header.';

GRANT EXECUTE ON FUNCTION fsj.asiento_recetario_hash_v2(fsj.asiento_recetario) TO fsj_app;
GRANT EXECUTE ON FUNCTION fsj.asiento_contralor_hash_v2(fsj.asiento_contralor) TO fsj_app;

-- Legacy V1 recomputation (exactly migration 0014's algorithm, with estado
-- pinned to its insert-time value 'VIGENTE'), used ONLY by
-- fsj.verificar_cadena to accept pre-0018 rows. date is rendered with
-- to_char(YYYY-MM-DD), which equals 0014's date::text under the ISO
-- DateStyle the V1 rows were written with.
CREATE OR REPLACE FUNCTION fsj.asiento_recetario_hash_v1(r fsj.asiento_recetario)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = fsj, extensions
AS $$
  SELECT encode(extensions.digest(array_to_string(ARRAY[
    'FSJ-ASIENTO-V1', r.tenant_id::text, r.libro_id::text, r.numero_correlativo::text,
    to_char(r.fecha_asiento, 'YYYY-MM-DD'), r.origen::text,
    coalesce(r.preparacion_id::text, ''), coalesce(r.asiento_original_id::text, ''),
    r.paciente_texto, r.medico_texto, r.formula_texto, 'VIGENTE', r.hash_anterior
  ], chr(31)), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION fsj.asiento_contralor_hash_v1(r fsj.asiento_contralor)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = fsj, extensions
AS $$
  SELECT encode(extensions.digest(array_to_string(ARRAY[
    'FSJ-ASIENTO-CONTRALOR-V1', r.tenant_id::text, r.libro_id::text, r.numero_correlativo::text,
    to_char(r.fecha_asiento, 'YYYY-MM-DD'), r.tipo_movimiento::text, r.droga_id::text,
    r.droga_descripcion, r.cantidad::text, r.unidad_medida_id::text, r.saldo_anterior::text,
    r.saldo_posterior::text, coalesce(r.movimiento_stock_id::text, ''),
    coalesce(r.asiento_recetario_id::text, ''), coalesce(r.numero_vale_adquisicion, ''),
    'VIGENTE', r.hash_anterior
  ], chr(31)), 'sha256'), 'hex');
$$;

-- fsj.verificar_cadena is SECURITY INVOKER, so its callers need EXECUTE here too.
GRANT EXECUTE ON FUNCTION fsj.asiento_recetario_hash_v1(fsj.asiento_recetario) TO fsj_app;
GRANT EXECUTE ON FUNCTION fsj.asiento_contralor_hash_v1(fsj.asiento_contralor) TO fsj_app;

-- ============================================================================
-- B2. asiento_recetario BEFORE INSERT: same logic as 0014, V2 hash.
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

  -- RECETARIO is the lowest-ranked counter: locking it alone respects the
  -- global counter lock order (migration 0018 header, B1).
  SELECT numero, hash_anterior INTO v_numero, v_hash_anterior
  FROM fsj.contador_correlativo_tomar(NEW.tenant_id, v_libro_id);

  NEW.numero_correlativo := v_numero;
  NEW.hash_anterior := v_hash_anterior;
  NEW.hash_integridad := fsj.asiento_recetario_hash_v2(NEW);

  UPDATE fsj.contador_correlativo
  SET ultimo_valor = v_numero, ultimo_hash = NEW.hash_integridad
  WHERE tenant_id = NEW.tenant_id AND libro_id = v_libro_id;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- B1 + B2. asiento_contralor BEFORE INSERT: counters locked FIRST (in rank
-- order), THEN the previous saldo is read with a plain SELECT; V2 hash.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_contralor_preparar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_tipo_control   fsj.tipo_control;
  v_tipo_libro     fsj.tipo_libro;
  v_libro_id       uuid;
  v_prev_saldo     numeric;
  v_found          boolean;
  v_numero         bigint;
  v_hash_anterior  text;
BEGIN
  SELECT tipo_control INTO v_tipo_control
  FROM fsj.droga
  WHERE tenant_id = NEW.tenant_id AND id = NEW.droga_id;

  IF v_tipo_control IS NULL OR v_tipo_control = 'NINGUNO' THEN
    RAISE EXCEPTION 'INV-L08: droga % is not a controlled drug (tipo_control %)', NEW.droga_id, v_tipo_control
      USING ERRCODE = 'P0001';
  END IF;

  v_tipo_libro := v_tipo_control::text::fsj.tipo_libro;

  SELECT id INTO v_libro_id
  FROM fsj.libro_rubricado
  WHERE tenant_id = NEW.tenant_id AND tipo = v_tipo_libro AND fecha_cierre IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-L08: tenant % has no open % libro_rubricado', NEW.tenant_id, v_tipo_control
      USING ERRCODE = 'P0001';
  END IF;

  NEW.libro_id := v_libro_id;
  NEW.fecha_asiento := fsj.jornada_actual(NEW.tenant_id);
  NEW.estado := 'VIGENTE';
  NEW.cierre_diario_id := NULL;

  -- Step 1 (lock order, deadlock freedom): lock every lower-ranked open
  -- counter of the tenant, in rank order, before the target one.
  PERFORM 1
  FROM fsj.contador_correlativo c
  JOIN fsj.libro_rubricado l ON l.tenant_id = c.tenant_id AND l.id = c.libro_id
  WHERE c.tenant_id = NEW.tenant_id AND l.fecha_cierre IS NULL AND l.tipo < v_tipo_libro
  ORDER BY l.tipo, l.id
  FOR UPDATE OF c;

  -- Step 2: lock the target libro's counter. From here on no other
  -- transaction can insert into this libro until we commit/roll back.
  SELECT numero, hash_anterior INTO v_numero, v_hash_anterior
  FROM fsj.contador_correlativo_tomar(NEW.tenant_id, v_libro_id);

  -- Step 3: only now read the previous saldo, as a NEW statement (fresh
  -- READ COMMITTED snapshot taken after the lock wait above), so it sees
  -- the row committed by the previous lock holder. Plain SELECT: no row
  -- lock needed, the counter lock already excludes concurrent writers.
  SELECT saldo_posterior INTO v_prev_saldo
  FROM fsj.asiento_contralor
  WHERE tenant_id = NEW.tenant_id AND libro_id = v_libro_id AND droga_id = NEW.droga_id
  ORDER BY numero_correlativo DESC
  LIMIT 1;
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
      -- EGRESO and AJUSTE both subtract ([CONFLICTO] resolved per spec).
      NEW.saldo_posterior := NEW.saldo_anterior - NEW.cantidad;
    END IF;
  END IF;

  IF NEW.saldo_posterior < 0 THEN
    RAISE EXCEPTION 'INV-L14: asiento_contralor saldo_posterior cannot go negative (saldo_anterior % - cantidad % or + %)', NEW.saldo_anterior, NEW.cantidad, NEW.cantidad
      USING ERRCODE = 'P0001';
  END IF;

  NEW.numero_correlativo := v_numero;
  NEW.hash_anterior := v_hash_anterior;
  NEW.hash_integridad := fsj.asiento_contralor_hash_v2(NEW);

  UPDATE fsj.contador_correlativo
  SET ultimo_valor = v_numero, ultimo_hash = NEW.hash_integridad
  WHERE tenant_id = NEW.tenant_id AND libro_id = v_libro_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.asiento_contralor_preparar() IS
  'BEFORE INSERT on asiento_contralor. B1 (migration 0018): locks the libro counter FIRST (after the lower-ranked counters, for a global deadlock-free lock order) and only THEN reads the previous saldo with a plain SELECT in a new statement -- under READ COMMITTED that statement''s snapshot is taken after the lock wait, so it sees the row the previous lock holder committed. The old ORDER BY ... LIMIT 1 FOR UPDATE read, done before the counter lock, could miss a concurrently inserted newer row (EvalPlanQual re-checks only the row already chosen) and use a stale saldo_anterior. Hash: serialization V2.';

-- ============================================================================
-- B2. fsj.verificar_cadena: first broken correlativo of a libro, or NULL.
-- SECURITY INVOKER on purpose: as fsj_app, RLS confines it to the caller's
-- own tenant (another tenant's libro is simply "not found" -> exception).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.verificar_cadena(p_tenant uuid, p_libro uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = fsj, extensions
AS $$
DECLARE
  v_tipo      fsj.tipo_libro;
  v_esperado  bigint := 1;
  v_prev      text := fsj.hash_genesis();
  v_v2_visto  boolean := false;
  v_rec       fsj.asiento_recetario%ROWTYPE;
  v_con       fsj.asiento_contralor%ROWTYPE;
  v_ult_valor bigint;
  v_ult_hash  text;
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
      IF v_rec.hash_integridad = fsj.asiento_recetario_hash_v2(v_rec) THEN
        v_v2_visto := true;
      ELSIF v_v2_visto OR v_rec.hash_integridad IS DISTINCT FROM fsj.asiento_recetario_hash_v1(v_rec) THEN
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
  'Recomputes the hash chain of one libro (recetario or contralor) with serialization V2 (legacy V1 accepted only before the first V2 row). Returns the first broken numero_correlativo (gap, wrong hash_anterior, wrong hash_integridad, or counter/tail mismatch), or NULL if the chain is intact. SECURITY INVOKER: RLS scopes it to the caller''s tenant.';

GRANT EXECUTE ON FUNCTION fsj.verificar_cadena(uuid, uuid) TO fsj_app;

-- ============================================================================
-- M2 + B2. fsj.cierre_diario_firmar: INV-C19 also counts unsigned VIGENTE
-- asiento_contralor rows; hash_lote V2 seals recetario AND contralor rows.
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
  v_matricula         text;
  v_fuera             boolean;
  v_hash_lote         text;
  v_rec_hashes        text[];
  v_con_hashes        text[];
  v_cantidad          integer;
  v_cierre            fsj.cierre_diario%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text));

  -- INV-U04.
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

  -- INV-C19: strictly chronological. No unsigned VIGENTE asiento -- recetario
  -- OR contralor (M2: a contralor-only jornada must not be skippable) --
  -- before p_fecha, and no cierre already exists for a LATER fecha.
  IF EXISTS (
    SELECT 1 FROM fsj.asiento_recetario
    WHERE tenant_id = p_tenant_id AND estado = 'VIGENTE' AND cierre_diario_id IS NULL AND fecha_asiento < p_fecha
  ) OR EXISTS (
    SELECT 1 FROM fsj.asiento_contralor
    WHERE tenant_id = p_tenant_id AND estado = 'VIGENTE' AND cierre_diario_id IS NULL AND fecha_asiento < p_fecha
  ) THEN
    RAISE EXCEPTION 'INV-C19: cannot sign % -- an earlier jornada still has unsigned asientos (recetario or contralor)', p_fecha USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM fsj.cierre_diario WHERE tenant_id = p_tenant_id AND fecha > p_fecha) THEN
    RAISE EXCEPTION 'INV-C19: cannot sign % out of order -- a later jornada is already signed', p_fecha USING ERRCODE = 'P0001';
  END IF;

  -- INV-C18.
  v_fuera := fsj.cierre_diario_calcular_fuera_de_termino(p_tenant_id, p_fecha);
  IF v_fuera AND p_motivo_demora IS NULL THEN
    RAISE EXCEPTION 'INV-C18: signing % out of term requires motivo_demora', p_fecha USING ERRCODE = 'P0001';
  END IF;

  -- INV-C05 (V2, migration 0018 header): the exact rows linked below.
  SELECT coalesce(array_agg(hash_integridad ORDER BY numero_correlativo), ARRAY[]::text[])
  INTO v_rec_hashes
  FROM fsj.asiento_recetario
  WHERE tenant_id = p_tenant_id AND fecha_asiento = p_fecha AND estado = 'VIGENTE' AND cierre_diario_id IS NULL;

  SELECT coalesce(array_agg(hash_integridad ORDER BY libro_id::text, numero_correlativo), ARRAY[]::text[])
  INTO v_con_hashes
  FROM fsj.asiento_contralor
  WHERE tenant_id = p_tenant_id AND fecha_asiento = p_fecha AND estado = 'VIGENTE' AND cierre_diario_id IS NULL;

  v_cantidad := cardinality(v_rec_hashes);

  v_hash_lote := fsj.hash_v2(
    ARRAY['FSJ-CIERRE-V2', p_tenant_id::text, to_char(p_fecha, 'YYYY-MM-DD'), cardinality(v_rec_hashes)::text]
    || v_rec_hashes
    || ARRAY[cardinality(v_con_hashes)::text]
    || v_con_hashes
  );

  INSERT INTO fsj.cierre_diario (
    tenant_id, fecha, director_tecnico_id, designacion_id, matricula_dt,
    cantidad_asientos, hash_lote, version_formato, fuera_de_termino, motivo_demora, motivo_demora_detalle
  ) VALUES (
    p_tenant_id, p_fecha, p_director_tecnico_id, p_designacion_id, v_matricula,
    v_cantidad, v_hash_lote, 2, v_fuera, p_motivo_demora, p_motivo_demora_detalle
  )
  RETURNING * INTO v_cierre;

  PERFORM set_config('fsj.cierre', 'on', true);

  -- INV-C02: link EVERY VIGENTE asiento (recetario AND contralor) of the jornada.
  UPDATE fsj.asiento_recetario
  SET cierre_diario_id = v_cierre.id
  WHERE tenant_id = p_tenant_id AND fecha_asiento = p_fecha AND estado = 'VIGENTE' AND cierre_diario_id IS NULL;

  UPDATE fsj.asiento_contralor
  SET cierre_diario_id = v_cierre.id
  WHERE tenant_id = p_tenant_id AND fecha_asiento = p_fecha AND estado = 'VIGENTE' AND cierre_diario_id IS NULL;

  PERFORM set_config('fsj.cierre', 'off', true);

  RETURN v_cierre;
END;
$$;

COMMENT ON FUNCTION fsj.cierre_diario_firmar(uuid, date, uuid, uuid, text, text) IS
  'M13a signing transaction: INV-C01, C02 (links every VIGENTE asiento AND asiento_contralor of the jornada), C05 (hash_lote V2 over both, version_formato=2 -- migration 0018 header), C18, C19 (recetario AND contralor unsigned rows block later jornadas -- migration 0018 M2), C20, U04. Grant EXECUTE only -- fsj_app has no direct INSERT on fsj.cierre_diario.';

-- ============================================================================
-- B3. libro_rubricado: rubric fields nullable, NULL -> value once (DP-38).
-- ============================================================================
ALTER TABLE fsj.libro_rubricado ALTER COLUMN numero DROP NOT NULL;
ALTER TABLE fsj.libro_rubricado ALTER COLUMN fecha_rubrica DROP NOT NULL;
-- expediente_rubrica was already nullable (0014).

COMMENT ON COLUMN fsj.libro_rubricado.numero IS
  'Official rubric number issued by the health authority. NULL until actually known -- NEVER invented (DP-38: the physical rubric model is pending with the Asociacion de Farmacias; this libro is the pharmacy''s own digital book). NULL -> value once, then frozen.';
COMMENT ON COLUMN fsj.libro_rubricado.fecha_rubrica IS
  'Official rubric date. NULL until actually known -- never invented (DP-38). NULL -> value once, then frozen.';
COMMENT ON COLUMN fsj.libro_rubricado.expediente_rubrica IS
  'Official rubric expediente. NULL until actually known -- never invented (DP-38). NULL -> value once, then frozen.';

GRANT UPDATE (numero, fecha_rubrica, expediente_rubrica) ON fsj.libro_rubricado TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.libro_rubricado_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.registrado_por_id IS DISTINCT FROM OLD.registrado_por_id
     OR NEW.registrado_en IS DISTINCT FROM OLD.registrado_en
  THEN
    RAISE EXCEPTION 'INV-LIB-001: libro_rubricado rows are immutable except numero/fecha_rubrica/expediente_rubrica/fecha_cierre (each NULL -> value, once)' USING ERRCODE = 'P0001';
  END IF;

  -- DP-38: official rubric data may be filled in once it is actually
  -- issued, but never rewritten or erased afterwards.
  IF OLD.numero IS NOT NULL AND NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'INV-LIB-001: libro_rubricado.numero cannot change once set' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.fecha_rubrica IS NOT NULL AND NEW.fecha_rubrica IS DISTINCT FROM OLD.fecha_rubrica THEN
    RAISE EXCEPTION 'INV-LIB-001: libro_rubricado.fecha_rubrica cannot change once set' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.expediente_rubrica IS NOT NULL AND NEW.expediente_rubrica IS DISTINCT FROM OLD.expediente_rubrica THEN
    RAISE EXCEPTION 'INV-LIB-001: libro_rubricado.expediente_rubrica cannot change once set' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.fecha_cierre IS NOT NULL AND NEW.fecha_cierre IS DISTINCT FROM OLD.fecha_cierre THEN
    RAISE EXCEPTION 'INV-LIB-001: libro_rubricado.fecha_cierre cannot change once set' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON TABLE fsj.libro_rubricado IS
  'The pharmacy''s own digital libro (one open per tenant+tipo). numero/fecha_rubrica/expediente_rubrica are official rubric data: created NULL, set once when actually issued, never invented (DP-38, migration 0018 B3). No folios (DP-38).';

-- ============================================================================
-- M3 prerequisite: contador_correlativo gets a forbid_delete trigger like
-- every other legal table (deleting a counter row is never legal -- its
-- libro can't be deleted either), which also makes it discoverable by the
-- structural derivation below.
-- ============================================================================
DROP TRIGGER IF EXISTS trg_contador_correlativo_forbid_delete ON fsj.contador_correlativo;
CREATE TRIGGER trg_contador_correlativo_forbid_delete
  BEFORE DELETE ON fsj.contador_correlativo
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- ============================================================================
-- M1 + M3. fsj.v_grants_legal: structurally derived table set (every fsj
-- table carrying a forbid_update_delete / forbid_delete trigger), plus
-- INSERT/TRUNCATE privileges. DROP + CREATE (column list changes).
-- ============================================================================
DROP VIEW IF EXISTS fsj.v_grants_legal;

CREATE VIEW fsj.v_grants_legal
WITH (security_invoker = true) AS
SELECT
  c.relname::text AS tabla,
  (SELECT array_agg(DISTINCT p.proname::text ORDER BY p.proname::text)
   FROM pg_trigger t
   JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
     AND p.pronamespace = 'fsj'::regnamespace
     AND p.proname IN ('forbid_update_delete', 'forbid_delete'))::text[] AS protecciones,
  has_table_privilege('fsj_app', c.oid, 'INSERT') AS insert_permitido,
  has_table_privilege('fsj_app', c.oid, 'DELETE') AS delete_permitido,
  has_table_privilege('fsj_app', c.oid, 'TRUNCATE') AS truncate_permitido,
  coalesce(
    (SELECT array_agg(a.attname::text ORDER BY a.attname)
     FROM pg_attribute a
     WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege('fsj_app', c.oid, a.attnum, 'UPDATE')),
    ARRAY[]::text[]
  )::text[] AS columnas_update
FROM pg_class c
WHERE c.relnamespace = 'fsj'::regnamespace
  AND c.relkind = 'r'
  AND EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
      AND p.pronamespace = 'fsj'::regnamespace
      AND p.proname IN ('forbid_update_delete', 'forbid_delete')
  );

COMMENT ON VIEW fsj.v_grants_legal IS
  'INV-X01. Every fsj table protected by a forbid_update_delete/forbid_delete trigger (derived from pg_trigger, not a hardcoded list -- migration 0018 M3), with what fsj_app may INSERT/DELETE/TRUNCATE/UPDATE on it, read from the Postgres catalogs. See tests/db/grants-finales.test.ts.';

GRANT SELECT ON fsj.v_grants_legal TO fsj_app;

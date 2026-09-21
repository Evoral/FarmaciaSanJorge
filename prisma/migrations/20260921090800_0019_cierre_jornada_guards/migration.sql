-- 0019_cierre_jornada_guards
--
-- Closes two confirmed holes in the M13a cierre diario logic built by
-- migrations 0014/0015/0018 (docs/specs/libro-recetario-y-contralor.md).
-- 0014/0015/0018 are already applied and are NOT edited in place (Prisma
-- checksums); everything here is CREATE OR REPLACE FUNCTION / CREATE
-- TRIGGER on top of them.
--
--   HOLE 1 (INV-C03 only protected movimiento_stock). Migration 0015 gave
--   fsj.movimiento_stock a BEFORE INSERT guard that rejects a write into an
--   already-signed jornada (INV-C03), but fsj.asiento_recetario and
--   fsj.asiento_contralor had no equivalent guard: an INSERT into either
--   table could be dated (via their own BEFORE INSERT "preparar" triggers,
--   fecha_asiento := fsj.jornada_actual(tenant_id)) into a jornada that
--   already has a fsj.cierre_diario row. Such a row could never be linked
--   to a cierre (fsj.cierre_diario_firmar only links VIGENTE rows with
--   cierre_diario_id IS NULL of the SIGNED fecha, and it never re-opens a
--   cierre to backfill a stray later row) -- silently breaking INV-C02
--   ("every VIGENTE asiento AND asiento_contralor of the jornada is linked
--   to its cierre").
--
--   Fix: a SECOND "BEFORE INSERT" trigger on each table, dedicated to this
--   one check (INV-C03), kept separate from the existing "preparar"
--   triggers (fsj.asiento_recetario_preparar / fsj.asiento_contralor_preparar)
--   rather than folded into them -- same "one invariant, one well-named
--   trigger function" convention 0015 used for movimiento_stock (see its
--   header). Postgres fires same-event BEFORE triggers on a table in
--   alphabetical order by trigger name (documented behavior); the existing
--   trigger that assigns NEW.fecha_asiento is trg_asiento_recetario_preparar
--   / trg_asiento_contralor_preparar (both start with "preparar"), so the
--   new triggers are named trg_..._validar_jornada_cerrada ("validar" >
--   "preparar" alphabetically) to guarantee they run AFTER fecha_asiento has
--   already been assigned by "preparar" -- checked explicitly by the
--   ordering assertion in tests/db/cierre-diario.test.ts.
--
--   anulacion_asiento and the rectificativo flow are UNCHANGED and already
--   correct: an anulacion of an asiento in a signed jornada is already
--   rejected by INV-L02 (migration 0014's trg_asiento_recetario_validar_update
--   / fsj.anulacion_asiento_validar); a rectificativo is itself an INSERT
--   into fsj.asiento_recetario with fecha_asiento assigned to TODAY's
--   jornada by the SAME "preparar" trigger, so it is naturally covered by
--   the new guard below -- rejected with INV-C03 only if TODAY is already
--   signed, exactly per spec.
--
--   HOLE 2 (fsj.cierre_diario_firmar accepted any p_fecha, including a
--   FUTURE one). Signing a future date would make INV-C03 (above) reject
--   every stock movement and every asiento of that day from the moment it
--   is signed until the calendar catches up to it -- a self-inflicted,
--   unrecoverable lockout (a cierre_diario row can never be deleted or
--   un-linked, INV-C04).
--
--   Fix: fsj.cierre_diario_firmar now rejects p_fecha > fsj.jornada_actual
--   (p_tenant_id) with a new INV-C21 ("a future jornada cannot be signed").
--
--   *** DP-18b OPEN -- READ BEFORE TOUCHING THIS FUNCTION AGAIN ***
--   Signing TODAY (p_fecha = fsj.jornada_actual(p_tenant_id)) is
--   DELIBERATELY still allowed here -- whether same-day signing should be
--   permitted at all is a pending business decision (DP-18b), not something
--   this migration resolves. The task instruction for this migration is
--   explicit: do not forbid it, only document the consequence. Consequence,
--   spelled out because it is easy to miss: the instant a jornada is
--   signed, INV-C03 (above) starts rejecting every FURTHER
--   movimiento_stock / asiento_recetario / asiento_contralor dated into
--   that same jornada -- so signing today, today, means no more
--   preparaciones can be registered for the rest of today. Whoever resolves
--   DP-18b (allow / forbid / restrict same-day signing) only needs to touch
--   this ONE function (the INV-C21 condition below), exactly like migration
--   0018's fsj.cierre_diario_calcular_fuera_de_termino note for DP-18.
--
-- Everything below is reproduced from the CURRENT (migration 0018)
-- definitions, since 0014/0015/0018 are not edited in place.

-- ============================================================================
-- HOLE 1a. fsj.asiento_recetario: BEFORE INSERT guard, INV-C03.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_recetario_validar_jornada_cerrada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fsj.cierre_diario
    WHERE tenant_id = NEW.tenant_id AND fecha = NEW.fecha_asiento
  ) THEN
    RAISE EXCEPTION 'INV-C03: cannot register an asiento_recetario -- jornada % is already signed', NEW.fecha_asiento
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.asiento_recetario_validar_jornada_cerrada() IS
  'INV-C03 (migration 0019): rejects an asiento_recetario INSERT (SISTEMA or RECTIFICATIVO alike) whose fecha_asiento already has a fsj.cierre_diario row. Runs AFTER trg_asiento_recetario_preparar in the BEFORE INSERT chain (Postgres fires same-event BEFORE triggers alphabetically; "validar_jornada_cerrada" > "preparar") so NEW.fecha_asiento is already assigned. See migration 0019 header for why this closes an INV-C02 hole.';

CREATE TRIGGER trg_asiento_recetario_validar_jornada_cerrada
  BEFORE INSERT ON fsj.asiento_recetario
  FOR EACH ROW EXECUTE FUNCTION fsj.asiento_recetario_validar_jornada_cerrada();

-- ============================================================================
-- HOLE 1b. fsj.asiento_contralor: same guard, same reasoning.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_contralor_validar_jornada_cerrada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fsj.cierre_diario
    WHERE tenant_id = NEW.tenant_id AND fecha = NEW.fecha_asiento
  ) THEN
    RAISE EXCEPTION 'INV-C03: cannot register an asiento_contralor -- jornada % is already signed', NEW.fecha_asiento
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.asiento_contralor_validar_jornada_cerrada() IS
  'INV-C03 (migration 0019): rejects an asiento_contralor INSERT whose fecha_asiento already has a fsj.cierre_diario row. Runs AFTER trg_asiento_contralor_preparar in the BEFORE INSERT chain (Postgres fires same-event BEFORE triggers alphabetically; "validar_jornada_cerrada" > "preparar") so NEW.fecha_asiento is already assigned. See migration 0019 header for why this closes an INV-C02 hole.';

CREATE TRIGGER trg_asiento_contralor_validar_jornada_cerrada
  BEFORE INSERT ON fsj.asiento_contralor
  FOR EACH ROW EXECUTE FUNCTION fsj.asiento_contralor_validar_jornada_cerrada();

-- ============================================================================
-- HOLE 2. fsj.cierre_diario_firmar: INV-C21, a future jornada cannot be
-- signed. Reproduced in full from migration 0018 (M2 + B2 version), with
-- ONLY the new check inserted right after INV-C01. DP-18b is OPEN -- see
-- the migration header above before changing the condition below.
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

  -- INV-C21 (migration 0019, HOLE 2): a future jornada can never be signed
  -- -- signing today is deliberately still allowed here (DP-18b open, see
  -- migration 0019 header for the consequence: from the moment today is
  -- signed, INV-C03 rejects any further movement/asiento dated today).
  IF p_fecha > fsj.jornada_actual(p_tenant_id) THEN
    RAISE EXCEPTION 'INV-C21: cannot sign % -- it is a future jornada (tenant %''s current jornada is %)', p_fecha, p_tenant_id, fsj.jornada_actual(p_tenant_id)
      USING ERRCODE = 'P0001';
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
  'M13a signing transaction: INV-C01, C02 (links every VIGENTE asiento AND asiento_contralor of the jornada), C05 (hash_lote V2 over both, version_formato=2 -- migration 0018 header), C18, C19 (recetario AND contralor unsigned rows block later jornadas -- migration 0018 M2), C20, C21 (migration 0019: a future jornada cannot be signed -- same-day signing is deliberately still allowed, DP-18b OPEN, see migration 0019 header for the consequence), U04. Grant EXECUTE only -- fsj_app has no direct INSERT on fsj.cierre_diario.';

-- 0022_dt_usuario_activo
--
-- FASE 3 point 3.9 review finding M1: two confirmed holes let a
-- SUSPENDIDO (or PENDIENTE_ACTIVACION/BAJA) user act as, or count as, a
-- vigente Director Tecnico:
--
--   HOLE A. `designarDirectorTecnico` (modules/directores-tecnicos) checks
--   nothing about `usuario.estado`, and migration 0005's INV-DT-001 trigger
--   (`fsj.designacion_dt_validar_rol`) checks only the DIRECTOR_TECNICO
--   role, not `estado`. The "solo usuarios ACTIVO" filter in
--   `listUsuariosElegibles` (designacion-repository.ts) is UI-only -- a
--   crafted call to the command (or a direct INSERT, as these DB tests do)
--   can designate a SUSPENDIDO user, and, via the TITULAR non-overlap
--   EXCLUDE constraint (designacion_dt_titular_no_solapa), lock the
--   tenant's TITULAR slot to an account that cannot even log in.
--
--   HOLE B. `fsj.es_dt_vigente(p_usuario, p_fecha)` (migration 0005) also
--   ignores `usuario.estado`: it answers "did usuario X hold a designation
--   covering fecha Y", with no notion of whether X is currently able to
--   act at all. Its only two callers both evaluate it at the moment a LIVE
--   actor performs an action right now (confirmed below), so a SUSPENDIDO
--   DT with an old, still-open designation could authorize things today
--   that only an ACTIVO DT should be able to.
--
-- `fsj.es_dt_vigente` callers checked (grep across prisma/migrations/*.sql
-- for "es_dt_vigente(" -- these are the only two; cierre_diario_firmar,
-- below, does NOT go through this function, it has its own inline query):
--
--   1. `fsj.movimiento_stock_validar_ajuste()` (migration 0008, redefined
--      by migration 0014 point 9 to use `fsj.jornada_actual` instead of
--      `current_date` -- CURRENT body is 0014's). INV-U05: an AJUSTE's
--      `autorizado_por_id` must be `fsj.es_dt_vigente(autorizado_por_id,
--      fsj.jornada_actual(tenant_id))` -- i.e. vigente TODAY, checked at
--      the instant the AJUSTE movimiento is inserted. This IS "a live actor
--      performing an action now" -- requiring ACTIVO-now is correct. Not
--      touched by this migration: it only calls `fsj.es_dt_vigente`, whose
--      behavior changes underneath it via CREATE OR REPLACE below.
--
--   2. `fsj.anulacion_asiento_validar()` (migration 0014). INV-U05: an
--      anulacion's `autorizado_por_id` must be `fsj.es_dt_vigente(NEW.
--      autorizado_por_id, fsj.jornada_actual(NEW.tenant_id))` -- same
--      shape, checked at the instant the anulacion_asiento row is
--      inserted. Also "a live actor acting now". Not touched here for the
--      same reason as (1).
--
-- `fsj.cierre_diario_firmar` (migration 0015, redefined in full by
-- migration 0019 for INV-C21 -- 0019 is the CURRENT body, reproduced below)
-- does its OWN direct query against fsj.designacion_director_tecnico for
-- INV-U04 instead of calling fsj.es_dt_vigente -- it must be fixed
-- separately, in the same spirit: signing a cierre is exactly "a live actor
-- (the DT) acting right now", so requiring the signer be ACTIVO-now is the
-- same correct rule. Fixed below by CREATE OR REPLACE, current body
-- reproduced verbatim from migration 0019 plus the one added condition
-- (see that function's section below).
--
-- Fix, part 1 (HOLE A): fsj.designacion_dt_validar_rol (INV-DT-001, DB
-- half of "designate") now ALSO requires the designated usuario be ACTIVO,
-- raised as a DISTINCT code, INV-DT-005, so the app layer (and any test)
-- can tell "wrong role" (INV-DT-001) apart from "not active" (INV-DT-005).
--
-- Fix, part 2 (HOLE B): fsj.es_dt_vigente now ALSO requires the usuario be
-- ACTIVO **right now** (not merely "at p_fecha") -- see the function's own
-- updated COMMENT below for the precise semantics this now documents.
--
-- Fix, part 3: fsj.cierre_diario_firmar's own INV-U04 query gets the same
-- ACTIVO-now condition, reusing the existing INV-U04 code (it is the same
-- invariant -- "vigente" now also means "and currently ACTIVO" -- not a
-- new one).
--
-- App-layer companion (same task, not part of this migration):
-- `designarDirectorTecnico` (modules/directores-tecnicos/application/
-- designar-director-tecnico.ts) now also does a fresh ACTIVO read inside
-- its transaction, so a rejected designation shows a clear Spanish message
-- before ever reaching this trigger -- this migration's INV-DT-005 remains
-- the real, DB-enforced guarantee regardless of that app-side check.

-- ============================================================================
-- Part 1 (HOLE A): fsj.designacion_dt_validar_rol -- INV-DT-001 unchanged,
-- INV-DT-005 added. Reproduced in full from migration 0005 (not edited in
-- place, Prisma checksums) plus the new check.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.designacion_dt_validar_rol()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM fsj.usuario_rol ur
    JOIN fsj.rol r ON r.id = ur.rol_id
    WHERE ur.tenant_id = NEW.tenant_id
      AND ur.usuario_id = NEW.usuario_id
      AND r.codigo = 'DIRECTOR_TECNICO'
  ) THEN
    RAISE EXCEPTION 'INV-DT-001: user % does not have role DIRECTOR_TECNICO', NEW.usuario_id
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-DT-005 (migration 0022, FASE 3 point 3.9 finding M1): the
  -- designated usuario must also be ACTIVO at designation time. A
  -- SUSPENDIDO/BAJA/PENDIENTE_ACTIVACION user holding the role could
  -- otherwise be designated and, via designacion_dt_titular_no_solapa (the
  -- TITULAR non-overlap EXCLUDE constraint, migration 0005), lock the
  -- tenant's TITULAR slot to an account that cannot even log in.
  IF NOT EXISTS (
    SELECT 1 FROM fsj.usuario u
    WHERE u.tenant_id = NEW.tenant_id
      AND u.id = NEW.usuario_id
      AND u.estado = 'ACTIVO'
  ) THEN
    RAISE EXCEPTION 'INV-DT-005: user % is not ACTIVO', NEW.usuario_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.designacion_dt_validar_rol() IS
  'INV-DT-001 (role DIRECTOR_TECNICO) and INV-DT-005 (migration 0022: usuario.estado = ACTIVO), both checked at INSERT time only -- usuario_id is immutable afterwards (INV-DT-003).';

-- ============================================================================
-- Part 2 (HOLE B): fsj.es_dt_vigente -- adds "AND usuario currently ACTIVO"
-- to the existing vigency-at-p_fecha check. Reproduced in full from
-- migration 0005 plus the new join/condition.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.es_dt_vigente(p_usuario uuid, p_fecha date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM fsj.designacion_director_tecnico d
    JOIN fsj.usuario u ON u.id = d.usuario_id AND u.tenant_id = d.tenant_id
    WHERE d.usuario_id = p_usuario
      AND d.vigente_desde <= p_fecha
      AND (d.vigente_hasta IS NULL OR d.vigente_hasta >= p_fecha)
      AND u.estado = 'ACTIVO'
  );
$$;

COMMENT ON FUNCTION fsj.es_dt_vigente(uuid, date) IS
  'INV-U04 (migration 0022 semantics): true iff the usuario is currently ACTIVO (checked against fsj.usuario.estado AT CALL TIME, i.e. "now" -- NOT p_fecha) AND held a designation covering p_fecha. Used by M08/M10/M11/M13 to gate an action a LIVE actor performs right now (e.g. authorizing an AJUSTE or an anulacion today, or signing a jornada) -- every current caller evaluates this at the instant that live actor acts, which is exactly why requiring ACTIVO-now (not ACTIVO-at-p_fecha) is correct; see migration 0022 header for the full caller list. Relies on RLS for tenant scoping (SECURITY INVOKER, the default, plus FORCE ROW LEVEL SECURITY from fsj.setup_tenant_table on both fsj.designacion_director_tecnico and fsj.usuario) -- returns false with no app.tenant_id set, by construction.';

-- ============================================================================
-- Part 3: fsj.cierre_diario_firmar -- adds the same ACTIVO-now condition to
-- its own inline INV-U04 query (it does not call fsj.es_dt_vigente).
-- Reproduced in full from migration 0019 (the migration that last
-- redefined it, for INV-C21) plus the one added condition below, inside
-- the INV-U04 SELECT. DP-18b is still OPEN -- see migration 0019's header
-- before touching the INV-C21 block again; it is unchanged here.
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

  -- INV-U04. Migration 0022 adds "AND u.estado = 'ACTIVO'" (the DT signing
  -- a cierre must be ACTIVO right now, same reasoning as fsj.es_dt_vigente's
  -- updated comment above) -- everything else in this SELECT is unchanged
  -- from migration 0015/0019.
  SELECT d.matricula INTO v_matricula
  FROM fsj.designacion_director_tecnico d
  JOIN fsj.usuario u ON u.id = d.usuario_id AND u.tenant_id = d.tenant_id
  WHERE d.tenant_id = p_tenant_id
    AND d.id = p_designacion_id
    AND d.usuario_id = p_director_tecnico_id
    AND d.vigente_desde <= p_fecha
    AND (d.vigente_hasta IS NULL OR d.vigente_hasta >= p_fecha)
    AND u.estado = 'ACTIVO';

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
  'M13a signing transaction: INV-C01, C02 (links every VIGENTE asiento AND asiento_contralor of the jornada), C05 (hash_lote V2 over both, version_formato=2 -- migration 0018 header), C18, C19 (recetario AND contralor unsigned rows block later jornadas -- migration 0018 M2), C20, C21 (migration 0019: a future jornada cannot be signed -- same-day signing is deliberately still allowed, DP-18b OPEN, see migration 0019 header for the consequence), U04 (migration 0022: the signing DT must also be ACTIVO right now). Grant EXECUTE only -- fsj_app has no direct INSERT on fsj.cierre_diario.';

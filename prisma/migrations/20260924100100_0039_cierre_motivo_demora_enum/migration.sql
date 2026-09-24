-- 0039_cierre_motivo_demora_enum
--
-- FASE 10, point 10.1 (M13a). DP-18c RESUELTA (user decision, 2026-09-24):
-- `motivo_demora` values are exactly `AUSENCIA_DT`, `FALLA_SISTEMA`,
-- `FARMACIA_CERRADA`, `OTRO` -- migration 0015 left it as free text
-- precisely because DP-18c was open (see that migration's header).
--
-- `fsj.cierre_diario` (migration 0015) and `fsj.cierre_diario_firmar`
-- (last redefined by migration 0019) are NOT edited in place -- everything
-- below is CREATE TYPE / ALTER TABLE / CREATE OR REPLACE on top of them.
--
-- Data mapping for existing rows (task instruction): a `motivo_demora` that
-- does not match one of the three specific reasons becomes `OTRO`; if
-- `motivo_demora_detalle` is empty, the ORIGINAL free text is preserved
-- there first, so no information is lost. Rows with `motivo_demora IS NULL`
-- are untouched.
--
-- GOTCHA (verified, per task instruction to check): `fsj.cierre_diario` has
-- a BEFORE UPDATE trigger (trg_cierre_diario_validar_update, migration 0015)
-- that enforces INV-C04 (immutable except fecha_impresion/impreso_por_id) --
-- it fires on the plain UPDATE this migration needs to backfill
-- motivo_demora_detalle, so that trigger is disabled for the duration of
-- that one statement and re-enabled immediately after. The SUBSEQUENT
-- `ALTER TABLE ... ALTER COLUMN ... TYPE` below is a table rewrite, which
-- Postgres performs WITHOUT firing row-level UPDATE triggers at all (this
-- is standard documented Postgres behavior, confirmed here so nobody has to
-- re-verify it later) -- it needs no trigger juggling.

-- ============================================================================
-- 1. The enum type.
-- ============================================================================
CREATE TYPE fsj.motivo_demora AS ENUM ('AUSENCIA_DT', 'FALLA_SISTEMA', 'FARMACIA_CERRADA', 'OTRO');

COMMENT ON TYPE fsj.motivo_demora IS
  'DP-18c RESUELTA (migration 0039). Reasons a cierre_diario signature can be fuera_de_termino (INV-C18). OTRO requires motivo_demora_detalle (see cierre_diario_motivo_demora_otro_detalle_check).';

-- ============================================================================
-- 2. Backfill motivo_demora_detalle for rows that are about to become OTRO
--    and have no detalle yet -- BEFORE the column is retyped, while
--    motivo_demora is still the original free text. Trigger disabled only
--    for this one statement (see migration header).
-- ============================================================================
ALTER TABLE fsj.cierre_diario DISABLE TRIGGER trg_cierre_diario_validar_update;

UPDATE fsj.cierre_diario
SET motivo_demora_detalle = motivo_demora
WHERE motivo_demora IS NOT NULL
  AND motivo_demora NOT IN ('AUSENCIA_DT', 'FALLA_SISTEMA', 'FARMACIA_CERRADA', 'OTRO')
  AND (motivo_demora_detalle IS NULL OR btrim(motivo_demora_detalle) = '');

ALTER TABLE fsj.cierre_diario ENABLE TRIGGER trg_cierre_diario_validar_update;

-- ============================================================================
-- 3. Retype the column. A table rewrite -- no row-level triggers fire (see
--    migration header). Any value already matching a real enum label is
--    kept as-is; everything else (including the ones just backfilled above)
--    maps to OTRO.
-- ============================================================================
ALTER TABLE fsj.cierre_diario
  ALTER COLUMN motivo_demora TYPE fsj.motivo_demora
  USING (
    CASE
      WHEN motivo_demora IS NULL THEN NULL
      WHEN motivo_demora IN ('AUSENCIA_DT', 'FALLA_SISTEMA', 'FARMACIA_CERRADA', 'OTRO') THEN motivo_demora::fsj.motivo_demora
      ELSE 'OTRO'::fsj.motivo_demora
    END
  );

-- ============================================================================
-- 4. OTRO always carries a non-empty detalle (task instruction).
-- ============================================================================
ALTER TABLE fsj.cierre_diario
  ADD CONSTRAINT cierre_diario_motivo_demora_otro_detalle_check
  CHECK (motivo_demora <> 'OTRO' OR btrim(coalesce(motivo_demora_detalle, '')) <> '');

-- ============================================================================
-- 5. fsj.cierre_diario_firmar: reproduced in full from migration 0019 (its
--    CURRENT definition), with the ONLY change being the explicit cast of
--    p_motivo_demora (still a plain text parameter -- signature stays
--    compatible) into fsj.motivo_demora on INSERT. An invalid value (not
--    one of the 4 labels) is rejected by Postgres itself with a plain
--    "invalid input value for enum" error -- the application validates the
--    motivo against this exact enum with zod before ever calling this
--    function, so that path is defensive only.
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

  -- INV-C21 (migration 0019). Same-day signing is deliberately still
  -- allowed (DP-18b), see migration 0019 header.
  IF p_fecha > fsj.jornada_actual(p_tenant_id) THEN
    RAISE EXCEPTION 'INV-C21: cannot sign % -- it is a future jornada (tenant %''s current jornada is %)', p_fecha, p_tenant_id, fsj.jornada_actual(p_tenant_id)
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-C19: strictly chronological. No unsigned VIGENTE asiento -- recetario
  -- OR contralor -- before p_fecha, and no cierre already exists for a
  -- LATER fecha.
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

  -- INV-C18 (DP-18 RESUELTA, migration 0038: plazo_firma_dias).
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

  -- DP-18c (migration 0039): motivo_demora is now fsj.motivo_demora, cast
  -- explicitly here -- the parameter itself stays plain text for signature
  -- compatibility.
  INSERT INTO fsj.cierre_diario (
    tenant_id, fecha, director_tecnico_id, designacion_id, matricula_dt,
    cantidad_asientos, hash_lote, version_formato, fuera_de_termino, motivo_demora, motivo_demora_detalle
  ) VALUES (
    p_tenant_id, p_fecha, p_director_tecnico_id, p_designacion_id, v_matricula,
    v_cantidad, v_hash_lote, 2, v_fuera, p_motivo_demora::fsj.motivo_demora, p_motivo_demora_detalle
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
  'M13a signing transaction: INV-C01, C02 (links every VIGENTE asiento AND asiento_contralor of the jornada), C05 (hash_lote V2 over both, version_formato=2), C18 (plazo_firma_dias, DP-18 RESUELTA -- migration 0038), C19 (recetario AND contralor unsigned rows block later jornadas), C20, C21 (a future jornada cannot be signed -- same-day signing is deliberately still allowed, DP-18b), U04. p_motivo_demora is cast to fsj.motivo_demora on INSERT (DP-18c RESUELTA -- migration 0039). Grant EXECUTE only -- fsj_app has no direct INSERT on fsj.cierre_diario.';

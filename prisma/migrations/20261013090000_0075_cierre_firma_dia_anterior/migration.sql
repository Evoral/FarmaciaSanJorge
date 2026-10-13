-- 0075_cierre_firma_dia_anterior
--
-- DP-18b REVISED (user decision, 2026-10-13): the DT signs the cierre diario
-- of the PREVIOUS jornada, never the one in progress. Supersedes migration
-- 0019's "same-day signing is deliberately still allowed".
--
-- 1. fsj.cierre_diario_firmar: INV-C21 now rejects p_fecha >= jornada_actual
--    (was p_fecha > jornada_actual). Reproduced in full from migration 0039,
--    the last one that redefined it, with two changes: the INV-C21 block, and
--    migration 0022's ACTIVO-now condition in the INV-U04 query, which 0039
--    dropped by copying 0019's body instead of 0022's.
-- 2. fsj.cierre_diario_calcular_fuera_de_termino: the term now starts the day
--    after the jornada. fuera_de_termino iff jornada_actual > p_fecha + 1 +
--    plazo_firma_dias -- with the default 0, signing on the next day is on
--    time and any later day is out of term.
--
-- CREATE OR REPLACE keeps every existing grant. Existing cierre_diario rows
-- are untouched (fuera_de_termino is a stored snapshot).

-- ============================================================================
-- 1. fsj.cierre_diario_firmar
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

  -- INV-U04, with migration 0022's "DT must be ACTIVO right now" condition
  -- restored (0039 reproduced 0019's body and silently dropped it).
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

  -- INV-C21 (migration 0075, DP-18b revised): only a PAST jornada can be
  -- signed -- the cierre diario is done the day after. Rejects today and
  -- any future jornada.
  IF p_fecha >= fsj.jornada_actual(p_tenant_id) THEN
    RAISE EXCEPTION 'INV-C21: cannot sign % -- only a jornada before the current one can be signed (tenant %''s current jornada is %)', p_fecha, p_tenant_id, fsj.jornada_actual(p_tenant_id)
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
  'M13a signing transaction: INV-C01, C02 (links every VIGENTE asiento AND asiento_contralor of the jornada), C05 (hash_lote V2 over both, version_formato=2), C18 (plazo_firma_dias counted from the day after the jornada -- migration 0075), C19 (recetario AND contralor unsigned rows block later jornadas), C20, C21 (only a jornada before the current one can be signed -- DP-18b revised, migration 0075), U04 (DT vigente on p_fecha AND ACTIVO now -- migration 0022). p_motivo_demora is cast to fsj.motivo_demora on INSERT (DP-18c RESUELTA -- migration 0039). Grant EXECUTE only -- fsj_app has no direct INSERT on fsj.cierre_diario.';

-- ============================================================================
-- 2. fsj.cierre_diario_calcular_fuera_de_termino
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.cierre_diario_calcular_fuera_de_termino(p_tenant_id uuid, p_fecha date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT fsj.jornada_actual(p_tenant_id) > (
    p_fecha + 1 + COALESCE(
      (SELECT valor::int FROM fsj.parametro WHERE tenant_id = p_tenant_id AND clave = 'plazo_firma_dias'),
      0
    )
  );
$$;

COMMENT ON FUNCTION fsj.cierre_diario_calcular_fuera_de_termino(uuid, date) IS
  'Migration 0075: fuera_de_termino iff the tenant''s CURRENT jornada is later than p_fecha + 1 + plazo_firma_dias (per-tenant parameter, fsj.parametro, default 0 when unset). The jornada is signed the day after, so with plazo 0 only the next day is on time.';

UPDATE fsj.parametro
SET descripcion = 'Dias corridos de gracia, despues del dia siguiente a la jornada, para firmar el cierre diario en termino (0 = solo el dia siguiente) -- DP-18'
WHERE clave = 'plazo_firma_dias';

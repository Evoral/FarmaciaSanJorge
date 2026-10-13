-- Rollback of 0075_cierre_firma_dia_anterior. Apply as a NEW forward
-- migration, AFTER deploying the code that lets the DT sign the jornada in
-- progress again (docs/rollbacks/cierre-firma-dia-anterior.md).
--
-- Restores migration 0039's fsj.cierre_diario_firmar (same-day signing
-- allowed) and migration 0038's fsj.cierre_diario_calcular_fuera_de_termino
-- (term counted from the jornada itself). NOTE: 0039's body lacks migration
-- 0022's ACTIVO-now condition in INV-U04; this restores that exact state.
-- No data is lost: cierre_diario rows keep their stored fuera_de_termino.

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

CREATE OR REPLACE FUNCTION fsj.cierre_diario_calcular_fuera_de_termino(p_tenant_id uuid, p_fecha date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT fsj.jornada_actual(p_tenant_id) > (
    p_fecha + COALESCE(
      (SELECT valor::int FROM fsj.parametro WHERE tenant_id = p_tenant_id AND clave = 'plazo_firma_dias'),
      0
    )
  );
$$;

COMMENT ON FUNCTION fsj.cierre_diario_calcular_fuera_de_termino(uuid, date) IS
  'DP-18 RESUELTA (migration 0038): fuera_de_termino iff the tenant''s CURRENT jornada is later than p_fecha + plazo_firma_dias (per-tenant parameter, fsj.parametro, default 0 when unset). Isolated here so a future change to the grace-period rule only touches this one function.';

UPDATE fsj.parametro
SET descripcion = 'Plazo, en dias corridos desde la fecha de la jornada, dentro del cual la firma del cierre diario se considera en termino -- DP-18, FASE 10 punto 10.1'
WHERE clave = 'plazo_firma_dias';

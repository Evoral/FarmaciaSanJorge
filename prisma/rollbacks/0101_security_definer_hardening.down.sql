-- Rollback of migration 0101: restores fsj.cierre_diario_firmar exactly as
-- migration 0097 left it (no tenant guard) and drops the fixed search_path of
-- fsj.lote_archivo_recetas_asignar_numero.

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

  -- INV-L26 (migration 0097): the numbers of every libro with an asiento (any estado) on or before this jornada are
  -- now on a signed sheet, so its first number is fixed for good.
  UPDATE fsj.libro_rubricado l
  SET numeracion_fijada_cierre_id = v_cierre.id
  WHERE l.tenant_id = p_tenant_id
    AND l.numeracion_fijada_cierre_id IS NULL
    AND (
      EXISTS (SELECT 1 FROM fsj.asiento_recetario a WHERE a.tenant_id = l.tenant_id AND a.libro_id = l.id AND a.fecha_asiento <= p_fecha)
      OR EXISTS (SELECT 1 FROM fsj.asiento_contralor a WHERE a.tenant_id = l.tenant_id AND a.libro_id = l.id AND a.fecha_asiento <= p_fecha)
    );

  PERFORM set_config('fsj.cierre', 'off', true);

  RETURN v_cierre;
END;
$$;

COMMENT ON FUNCTION fsj.cierre_diario_firmar(uuid, date, uuid, uuid, text, text) IS
  'M13a signing transaction: INV-C01, C02 (links every VIGENTE asiento AND asiento_contralor of the jornada), C05 (hash_lote V2 over both, version_formato=2), C18 (plazo_firma_dias counted from the day after the jornada -- migration 0075), C19 (recetario AND contralor unsigned rows block later jornadas), C20, C21 (only a jornada before the current one can be signed -- DP-18b revised, migration 0075), U04 (DT vigente on p_fecha AND ACTIVO now -- migration 0022), L26 (fixes numero_inicial of every libro with an asiento on or before the jornada -- migration 0097). p_motivo_demora is cast to fsj.motivo_demora on INSERT (DP-18c RESUELTA -- migration 0039). Grant EXECUTE only -- fsj_app has no direct INSERT on fsj.cierre_diario.';

ALTER FUNCTION fsj.lote_archivo_recetas_asignar_numero() RESET search_path;

-- EXECUTE back to PUBLIC on every fsj routine except the five that never had it.
-- The explicit fsj_app grants added by 0101 stay: they are a subset of PUBLIC.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'fsj'
      AND p.proname NOT IN ('usuario_resolve_login', 'sesion_resolve_tenant', 'seed_roles_tenant', 'seed_acciones_con_pin', 'libro_configurar_numeracion')
  LOOP
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO PUBLIC', r.sig);
  END LOOP;
END;
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA fsj REVOKE EXECUTE ON ROUTINES FROM fsj_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON ROUTINES TO PUBLIC;

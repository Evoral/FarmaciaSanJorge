-- Rollback of 0097_libro_numeracion_inicial (apply as a NEW forward migration).
-- Restores the previous bodies of fsj.libro_rubricado_validar_update (0018), fsj.asiento_recetario_validar_update
-- (0082), fsj.asiento_contralor_validar_update (0014), fsj.cierre_diario_firmar (0075) and fsj.verificar_cadena
-- (0087), drops fsj.libro_configurar_numeracion and the two libro_rubricado columns.
--
-- Refused while any libro has a numero_inicial other than 1: the restored fsj.verificar_cadena expects every chain
-- to start at 1, so those libros would report a broken chain at Nº 1. Asientos renumbered while the feature was live
-- keep their numbers and hashes (they are consistent with numero_inicial = 1 only if it was 1).
-- The code must be reverted too (docs/rollbacks/numeracion-inicial-libro.md).

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.libro_rubricado WHERE numero_inicial <> 1) THEN
    RAISE EXCEPTION 'Rollback 0097 refused: some libro_rubricado has numero_inicial <> 1 (its chain would no longer verify)';
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS fsj.libro_configurar_numeracion(uuid, uuid, bigint);

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
     OR NEW.receta_id IS DISTINCT FROM OLD.receta_id
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
        -- Re-anchored hole: skip it only when a registered re-anchor matches it exactly.
        IF v_rec.numero_correlativo > v_esperado AND EXISTS (
          SELECT 1 FROM fsj.libro_reanclaje r
          WHERE r.tenant_id = p_tenant AND r.libro_id = p_libro
            AND r.numero_esperado = v_esperado
            AND r.desde_numero = v_rec.numero_correlativo
            AND r.hash_anterior_aceptado = v_rec.hash_anterior
        ) THEN
          v_esperado := v_rec.numero_correlativo;
          v_prev := v_rec.hash_anterior;
        ELSE
          RETURN v_esperado;
        END IF;
      END IF;

      v_hash_esperado := CASE v_rec.version_hash
        WHEN 4 THEN fsj.asiento_recetario_hash_v4(v_rec)
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
        IF v_con.numero_correlativo > v_esperado AND EXISTS (
          SELECT 1 FROM fsj.libro_reanclaje r
          WHERE r.tenant_id = p_tenant AND r.libro_id = p_libro
            AND r.numero_esperado = v_esperado
            AND r.desde_numero = v_con.numero_correlativo
            AND r.hash_anterior_aceptado = v_con.hash_anterior
        ) THEN
          v_esperado := v_con.numero_correlativo;
          v_prev := v_con.hash_anterior;
        ELSE
          RETURN v_esperado;
        END IF;
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
  'Recomputes the hash chain of one libro. asiento_recetario rows: recomputed with the function matching their OWN stored version_hash (1/2/3 -- migration 0034; 4 -- migration 0082, por-receta SISTEMA). asiento_contralor rows: unchanged V1/V2 trial (migration 0018). A hole in the numbering is skipped ONLY when a fsj.libro_reanclaje row (migration 0087) matches it exactly. Returns the first broken numero_correlativo, or NULL if intact. SECURITY INVOKER: RLS scopes it to the caller''s tenant.';

ALTER TABLE fsj.libro_rubricado
  DROP CONSTRAINT IF EXISTS libro_rubricado_numeracion_fijada_cierre_fkey,
  DROP CONSTRAINT IF EXISTS libro_rubricado_numero_inicial_check,
  DROP COLUMN IF EXISTS numeracion_fijada_cierre_id,
  DROP COLUMN IF EXISTS numero_inicial;

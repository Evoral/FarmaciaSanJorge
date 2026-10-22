-- 0097_libro_numeracion_inicial
--
-- User decision (2026-10-22): a pharmacy moving to the digital libro either starts its numbering from 1 or continues
-- the physical book's numbering. Each libro (recetario and each libro contralor) gets a configurable FIRST number,
-- which stays changeable until the first signed cierre that covers the libro's asientos fixes it for good.
--
--   - fsj.libro_rubricado.numero_inicial (default 1): the number of the libro's first asiento.
--   - fsj.libro_rubricado.numeracion_fijada_cierre_id: the cierre that fixed it. Set ONLY by fsj.cierre_diario_firmar,
--     once, for every unfixed libro that has an asiento (any estado) dated on or before the signed jornada -- those
--     numbers are now on a signed, printable sheet.
--   - fsj.libro_configurar_numeracion: the ONLY way to change numero_inicial. While the libro is not fixed it
--     renumbers its existing asientos (shift by the difference) and recomputes the whole hash chain and the counter.
--     Nothing is signed yet, so no hash_lote covers these rows. Refused once fixed, if the libro has a re-anchor
--     (fsj.libro_reanclaje stores numbers), or if its chain does not verify (rehashing would launder altered rows).
--   - INV-L26: numero_inicial and the numbering of the asientos change only through that function, only while
--     numeracion_fijada_cierre_id IS NULL, and only on rows not linked to a cierre (fsj.renumera GUC, same pattern
--     as fsj.cierre / fsj.anula).
--   - fsj.verificar_cadena: the chain now starts at numero_inicial instead of 1.
--
-- docs/specs/libro-recetario-y-contralor.md ("Numeración inicial"). Rollback:
-- prisma/rollbacks/0097_libro_numeracion_inicial.down.sql (as a NEW forward migration), docs/rollbacks/numeracion-inicial-libro.md.

-- ============================================================================
-- 1. Columns + backfill (before the new update guard, which only lets fsj.cierre_diario_firmar fix a libro).
-- ============================================================================
ALTER TABLE fsj.libro_rubricado
  ADD COLUMN IF NOT EXISTS numero_inicial bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS numeracion_fijada_cierre_id uuid;

ALTER TABLE fsj.libro_rubricado
  ADD CONSTRAINT libro_rubricado_numero_inicial_check CHECK (numero_inicial >= 1),
  ADD CONSTRAINT libro_rubricado_numeracion_fijada_cierre_fkey
    FOREIGN KEY (tenant_id, numeracion_fijada_cierre_id) REFERENCES fsj.cierre_diario (tenant_id, id);

COMMENT ON COLUMN fsj.libro_rubricado.numero_inicial IS
  'Migration 0097. Number of the libro''s first asiento (1, or the next number of the physical book). Changes only through fsj.libro_configurar_numeracion while numeracion_fijada_cierre_id IS NULL (INV-L26).';
COMMENT ON COLUMN fsj.libro_rubricado.numeracion_fijada_cierre_id IS
  'Migration 0097. The first signed cierre covering an asiento of this libro: from then on numero_inicial is immutable. Set once, only by fsj.cierre_diario_firmar.';

-- Libros that already have an asiento in a signed jornada are fixed by the earliest such cierre.
UPDATE fsj.libro_rubricado l
SET numeracion_fijada_cierre_id = (
  SELECT c.id
  FROM fsj.cierre_diario c
  WHERE c.tenant_id = l.tenant_id
    AND (
      EXISTS (SELECT 1 FROM fsj.asiento_recetario a WHERE a.tenant_id = l.tenant_id AND a.libro_id = l.id AND a.fecha_asiento <= c.fecha)
      OR EXISTS (SELECT 1 FROM fsj.asiento_contralor a WHERE a.tenant_id = l.tenant_id AND a.libro_id = l.id AND a.fecha_asiento <= c.fecha)
    )
  ORDER BY c.fecha
  LIMIT 1
)
WHERE l.numeracion_fijada_cierre_id IS NULL;

-- ============================================================================
-- 2. fsj.libro_rubricado_validar_update: 0018 body + INV-L26.
-- ============================================================================
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

  -- INV-L26 (migration 0097).
  IF NEW.numero_inicial IS DISTINCT FROM OLD.numero_inicial THEN
    IF OLD.numeracion_fijada_cierre_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-L26: the numbering of libro % is fixed since its first signed cierre', OLD.id USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(current_setting('fsj.renumera', true), '') <> 'on' THEN
      RAISE EXCEPTION 'INV-L26: libro_rubricado.numero_inicial can only change via fsj.libro_configurar_numeracion()' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.numeracion_fijada_cierre_id IS DISTINCT FROM OLD.numeracion_fijada_cierre_id THEN
    IF OLD.numeracion_fijada_cierre_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-L26: libro_rubricado.numeracion_fijada_cierre_id cannot change once set' USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(current_setting('fsj.cierre', true), '') <> 'on' THEN
      RAISE EXCEPTION 'INV-L26: libro_rubricado.numeracion_fijada_cierre_id can only be set by fsj.cierre_diario_firmar()' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. fsj.asiento_recetario_validar_update: 0082 body; numero_correlativo / hash_anterior / hash_integridad may
--    change only during a renumbering (INV-L26), on a row no cierre covers, in a libro not yet fixed.
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

  IF NEW.numero_correlativo IS DISTINCT FROM OLD.numero_correlativo
     OR NEW.hash_integridad IS DISTINCT FROM OLD.hash_integridad
     OR NEW.hash_anterior IS DISTINCT FROM OLD.hash_anterior
  THEN
    IF coalesce(current_setting('fsj.renumera', true), '') <> 'on'
       OR OLD.cierre_diario_id IS NOT NULL
       OR NEW.cierre_diario_id IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM fsj.libro_rubricado l
         WHERE l.tenant_id = OLD.tenant_id AND l.id = OLD.libro_id AND l.numeracion_fijada_cierre_id IS NOT NULL
       )
    THEN
      RAISE EXCEPTION 'INV-L26: asiento_recetario numbering and hashes change only via fsj.libro_configurar_numeracion(), before the libro''s first signed cierre' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.libro_id IS DISTINCT FROM OLD.libro_id
     OR NEW.fecha_asiento IS DISTINCT FROM OLD.fecha_asiento
     OR NEW.origen IS DISTINCT FROM OLD.origen
     OR NEW.preparacion_id IS DISTINCT FROM OLD.preparacion_id
     OR NEW.receta_id IS DISTINCT FROM OLD.receta_id
     OR NEW.asiento_original_id IS DISTINCT FROM OLD.asiento_original_id
     OR NEW.paciente_texto IS DISTINCT FROM OLD.paciente_texto
     OR NEW.medico_texto IS DISTINCT FROM OLD.medico_texto
     OR NEW.formula_texto IS DISTINCT FROM OLD.formula_texto
     OR NEW.version_hash IS DISTINCT FROM OLD.version_hash
     OR NEW.registrado_por_id IS DISTINCT FROM OLD.registrado_por_id
  THEN
    RAISE EXCEPTION 'INV-L01: asiento_recetario rows are immutable except cierre_diario_id (once) and estado VIGENTE->ANULADO' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 4. fsj.asiento_contralor_validar_update: 0014 body, same INV-L26 exception.
-- ============================================================================
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

  IF NEW.numero_correlativo IS DISTINCT FROM OLD.numero_correlativo
     OR NEW.hash_integridad IS DISTINCT FROM OLD.hash_integridad
     OR NEW.hash_anterior IS DISTINCT FROM OLD.hash_anterior
  THEN
    IF coalesce(current_setting('fsj.renumera', true), '') <> 'on'
       OR OLD.cierre_diario_id IS NOT NULL
       OR NEW.cierre_diario_id IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM fsj.libro_rubricado l
         WHERE l.tenant_id = OLD.tenant_id AND l.id = OLD.libro_id AND l.numeracion_fijada_cierre_id IS NOT NULL
       )
    THEN
      RAISE EXCEPTION 'INV-L26: asiento_contralor numbering and hashes change only via fsj.libro_configurar_numeracion(), before the libro''s first signed cierre' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.libro_id IS DISTINCT FROM OLD.libro_id
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
     OR NEW.registrado_por_id IS DISTINCT FROM OLD.registrado_por_id
  THEN
    RAISE EXCEPTION 'INV-L01: asiento_contralor rows are immutable except cierre_diario_id (NULL -> value, once)' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 5. fsj.libro_configurar_numeracion.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.libro_configurar_numeracion(p_tenant_id uuid, p_libro_id uuid, p_numero_inicial bigint)
RETURNS TABLE (numero_inicial_anterior bigint, asientos_renumerados integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_libro     fsj.libro_rubricado%ROWTYPE;
  v_delta     bigint;
  v_prev      text := fsj.hash_genesis();
  v_hash      text;
  v_id        uuid;
  v_rec       fsj.asiento_recetario%ROWTYPE;
  v_con       fsj.asiento_contralor%ROWTYPE;
  v_ids_v1    uuid[] := ARRAY[]::uuid[];
  v_cantidad  integer := 0;
BEGIN
  IF p_tenant_id IS DISTINCT FROM fsj.current_tenant_id() THEN
    RAISE EXCEPTION 'INV-L26: tenant % is not the current tenant', p_tenant_id USING ERRCODE = 'P0001';
  END IF;
  IF p_numero_inicial IS NULL OR p_numero_inicial < 1 THEN
    RAISE EXCEPTION 'INV-L26: numero_inicial must be >= 1 (got %)', p_numero_inicial USING ERRCODE = 'P0001';
  END IF;

  -- Same lock fsj.cierre_diario_firmar takes first: no cierre can fix this libro halfway through.
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text));
  -- Same lock every new asiento of this libro takes (fsj.contador_correlativo_tomar).
  PERFORM 1 FROM fsj.contador_correlativo WHERE tenant_id = p_tenant_id AND libro_id = p_libro_id FOR UPDATE;

  SELECT * INTO v_libro FROM fsj.libro_rubricado WHERE tenant_id = p_tenant_id AND id = p_libro_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-L03: libro % not found for tenant %', p_libro_id, p_tenant_id USING ERRCODE = 'P0001';
  END IF;
  IF v_libro.fecha_cierre IS NOT NULL THEN
    RAISE EXCEPTION 'INV-L26: libro % is closed', p_libro_id USING ERRCODE = 'P0001';
  END IF;
  IF v_libro.numeracion_fijada_cierre_id IS NOT NULL THEN
    RAISE EXCEPTION 'INV-L26: the numbering of libro % is fixed since its first signed cierre', p_libro_id USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM fsj.libro_reanclaje WHERE tenant_id = p_tenant_id AND libro_id = p_libro_id) THEN
    RAISE EXCEPTION 'INV-L26: libro % has a re-anchored chain and cannot be renumbered', p_libro_id USING ERRCODE = 'P0001';
  END IF;

  v_delta := p_numero_inicial - v_libro.numero_inicial;
  IF v_delta = 0 THEN
    RETURN QUERY SELECT v_libro.numero_inicial, 0;
    RETURN;
  END IF;

  -- Rehashing rewrites every hash: on a broken chain it would cover the altered rows with fresh, valid hashes and
  -- silence the integrity alert. Only an intact chain can be renumbered.
  IF fsj.verificar_cadena(p_tenant_id, p_libro_id) IS NOT NULL THEN
    RAISE EXCEPTION 'INV-L26: libro % has a broken hash chain and cannot be renumbered', p_libro_id USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('fsj.renumera', 'on', true);

  IF v_libro.tipo = 'RECETARIO' THEN
    -- Pass 1: shift the numbers, farthest row first, so no row lands on a number still in use (UNIQUE per libro).
    FOR v_id IN
      SELECT id FROM fsj.asiento_recetario
      WHERE tenant_id = p_tenant_id AND libro_id = p_libro_id
      ORDER BY CASE WHEN v_delta > 0 THEN -numero_correlativo ELSE numero_correlativo END
    LOOP
      UPDATE fsj.asiento_recetario SET numero_correlativo = numero_correlativo + v_delta WHERE tenant_id = p_tenant_id AND id = v_id;
      v_cantidad := v_cantidad + 1;
    END LOOP;

    -- Pass 2: rebuild the chain in order, each row with the hash function of its own version_hash.
    FOR v_rec IN
      SELECT * FROM fsj.asiento_recetario WHERE tenant_id = p_tenant_id AND libro_id = p_libro_id ORDER BY numero_correlativo
    LOOP
      v_rec.hash_anterior := v_prev;
      v_hash := CASE v_rec.version_hash
        WHEN 4 THEN fsj.asiento_recetario_hash_v4(v_rec)
        WHEN 3 THEN fsj.asiento_recetario_hash_v3(v_rec)
        WHEN 2 THEN fsj.asiento_recetario_hash_v2(v_rec)
        ELSE fsj.asiento_recetario_hash_v1(v_rec)
      END;
      UPDATE fsj.asiento_recetario SET hash_anterior = v_prev, hash_integridad = v_hash WHERE tenant_id = p_tenant_id AND id = v_rec.id;
      v_prev := v_hash;
    END LOOP;
  ELSE
    -- Contralor rows carry no hash version: detect V1 rows (pre-0018) BEFORE their numbers change.
    FOR v_con IN
      SELECT * FROM fsj.asiento_contralor WHERE tenant_id = p_tenant_id AND libro_id = p_libro_id
    LOOP
      IF v_con.hash_integridad IS DISTINCT FROM fsj.asiento_contralor_hash_v2(v_con) THEN
        v_ids_v1 := v_ids_v1 || v_con.id;
      END IF;
    END LOOP;

    FOR v_id IN
      SELECT id FROM fsj.asiento_contralor
      WHERE tenant_id = p_tenant_id AND libro_id = p_libro_id
      ORDER BY CASE WHEN v_delta > 0 THEN -numero_correlativo ELSE numero_correlativo END
    LOOP
      UPDATE fsj.asiento_contralor SET numero_correlativo = numero_correlativo + v_delta WHERE tenant_id = p_tenant_id AND id = v_id;
      v_cantidad := v_cantidad + 1;
    END LOOP;

    FOR v_con IN
      SELECT * FROM fsj.asiento_contralor WHERE tenant_id = p_tenant_id AND libro_id = p_libro_id ORDER BY numero_correlativo
    LOOP
      v_con.hash_anterior := v_prev;
      v_hash := CASE WHEN v_con.id = ANY (v_ids_v1) THEN fsj.asiento_contralor_hash_v1(v_con) ELSE fsj.asiento_contralor_hash_v2(v_con) END;
      UPDATE fsj.asiento_contralor SET hash_anterior = v_prev, hash_integridad = v_hash WHERE tenant_id = p_tenant_id AND id = v_con.id;
      v_prev := v_hash;
    END LOOP;
  END IF;

  -- The counter moves with the rows: next number = new last + 1, chained to the new last hash (genesis if empty).
  UPDATE fsj.contador_correlativo
  SET ultimo_valor = ultimo_valor + v_delta, ultimo_hash = v_prev
  WHERE tenant_id = p_tenant_id AND libro_id = p_libro_id;

  UPDATE fsj.libro_rubricado SET numero_inicial = p_numero_inicial WHERE tenant_id = p_tenant_id AND id = p_libro_id;

  PERFORM set_config('fsj.renumera', 'off', true);

  RETURN QUERY SELECT v_libro.numero_inicial, v_cantidad;
END;
$$;

COMMENT ON FUNCTION fsj.libro_configurar_numeracion(uuid, uuid, bigint) IS
  'Migration 0097 (INV-L26). Sets the first number of an open, not yet fixed libro. Renumbers its existing asientos by the difference, recomputes their hash chain and the counter. Refused once fsj.cierre_diario_firmar has fixed the libro, when the libro has a re-anchor, or when its chain does not verify. Takes the cierre advisory lock and the counter row lock.';

REVOKE ALL ON FUNCTION fsj.libro_configurar_numeracion(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.libro_configurar_numeracion(uuid, uuid, bigint) TO fsj_app;

-- ============================================================================
-- 6. fsj.cierre_diario_firmar: 0075 body + fixes the numbering of every libro it makes printable (INV-L26).
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

-- ============================================================================
-- 7. fsj.verificar_cadena: 0087 body; the chain starts at the libro's numero_inicial.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.verificar_cadena(p_tenant uuid, p_libro uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = fsj, extensions
AS $$
DECLARE
  v_tipo          fsj.tipo_libro;
  v_esperado      bigint;
  v_prev          text := fsj.hash_genesis();
  v_v2_visto      boolean := false;
  v_rec           fsj.asiento_recetario%ROWTYPE;
  v_con           fsj.asiento_contralor%ROWTYPE;
  v_hash_esperado text;
  v_ult_valor     bigint;
  v_ult_hash      text;
BEGIN
  SELECT tipo, numero_inicial INTO v_tipo, v_esperado FROM fsj.libro_rubricado WHERE tenant_id = p_tenant AND id = p_libro;
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
  'Recomputes the hash chain of one libro, starting at its numero_inicial (migration 0097). asiento_recetario rows: recomputed with the function matching their OWN stored version_hash (1/2/3 -- migration 0034; 4 -- migration 0082, por-receta SISTEMA). asiento_contralor rows: unchanged V1/V2 trial (migration 0018). A hole in the numbering is skipped ONLY when a fsj.libro_reanclaje row (migration 0087) matches it exactly. Returns the first broken numero_correlativo, or NULL if intact. SECURITY INVOKER: RLS scopes it to the caller''s tenant.';

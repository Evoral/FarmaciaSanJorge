-- 0114 -- An elaborated lot follows the vencimiento of the active drugs it was made from
-- (change openspec/changes/lotes-elaborados/, spec elaboracion-lote EL5; user decision 2026-11-02).
--
-- A lot elaborated from partidas of clase DROGA has no vencimiento of its own: it takes the earliest vencimiento
-- vigente among them (insumos and excipientes do not bound it), a reanálisis of one of them moves it, and marking one
-- as vencida discards it (the app's marcarPartidaVencida, same transaction). A lot that consumed no DROGA keeps the
-- 0111 rule (its own vencimiento; insumos only).
--
--   1. fsj.lote_sigue_a_drogas(tenant, partida): the partida is a lot elaborated from at least one DROGA partida.
--      fsj.lotes_elaborados_dependientes(tenant, partida): every lot that follows the partida, transitively (a
--      dilución of a dilución). Invoker functions (RLS applies); the app reads them too.
--   2. fsj.elaboracion_lote_validar (latest body: 0111) -- INV-EL4 is now an equality: the produced fecha_vencimiento
--      IS the earliest vencimiento vigente among the consumed DROGA partidas.
--   3. fsj.lote_elaborado_seguir_vencimiento(tenant, partida): re-derives the vigente vencimiento of the lots elaborated
--      from the partida, then of theirs. Called only by fsj.reanalisis_partida_aplicar (EXECUTE revoked from fsj_app).
--   4. fsj.reanalisis_partida_aplicar (latest body: 0074) -- after moving the partida, the lots that follow it move.
--      They get no fsj.reanalisis_partida row of their own: the source's row is the history.
--   5. fsj.reanalisis_partida_validar (latest body: 0074) -- INV-S22 now also refuses a lot that follows its drugs
--      (the drug is re-analysed instead), and accepts a DROGA partida without saldo while a lot that follows it still
--      has saldo (the drug was used up in the dilución, the dilución is still in use).
--
-- Lots elaborated before this migration keep their date until one of their drugs is re-analysed.
--
-- *** APPLY 0114 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0114_vencimiento_lote_elaborado.down.sql (as a NEW forward migration).

-- ============================================================================
-- 1. Which lots follow which partida.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.lote_sigue_a_drogas(p_tenant_id uuid, p_partida_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = fsj, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM fsj.elaboracion_lote el
    JOIN fsj.movimiento_stock m ON m.tenant_id = el.tenant_id AND m.elaboracion_lote_id = el.id AND m.tipo::text = 'EGRESO_ELABORACION'
    JOIN fsj.partida p ON p.tenant_id = m.tenant_id AND p.id = m.partida_id
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    WHERE el.tenant_id = p_tenant_id AND el.partida_id = p_partida_id AND d.clase = 'DROGA'
  );
$$;

COMMENT ON FUNCTION fsj.lote_sigue_a_drogas(uuid, uuid) IS
  '0114 (EL5). True when the partida is a lot elaborated from at least one partida of clase DROGA: its vencimiento follows them and it is never re-analysed itself.';

CREATE OR REPLACE FUNCTION fsj.lotes_elaborados_dependientes(p_tenant_id uuid, p_partida_id uuid)
RETURNS TABLE (partida_id uuid)
LANGUAGE sql
STABLE
SET search_path = fsj, extensions
AS $$
  WITH RECURSIVE dependientes (partida_id) AS (
    SELECT el.partida_id
    FROM fsj.movimiento_stock m
    JOIN fsj.partida p ON p.tenant_id = m.tenant_id AND p.id = m.partida_id
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id AND d.clase = 'DROGA'
    JOIN fsj.elaboracion_lote el ON el.tenant_id = m.tenant_id AND el.id = m.elaboracion_lote_id
    WHERE m.tenant_id = p_tenant_id AND m.partida_id = p_partida_id AND m.tipo::text = 'EGRESO_ELABORACION'
    UNION
    SELECT el.partida_id
    FROM dependientes dep
    JOIN fsj.movimiento_stock m ON m.tenant_id = p_tenant_id AND m.partida_id = dep.partida_id AND m.tipo::text = 'EGRESO_ELABORACION'
    JOIN fsj.partida p ON p.tenant_id = m.tenant_id AND p.id = m.partida_id
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id AND d.clase = 'DROGA'
    JOIN fsj.elaboracion_lote el ON el.tenant_id = m.tenant_id AND el.id = m.elaboracion_lote_id
  )
  SELECT partida_id FROM dependientes;
$$;

COMMENT ON FUNCTION fsj.lotes_elaborados_dependientes(uuid, uuid) IS
  '0114 (EL5). Every lot whose vencimiento follows the partida: elaborated from it when it is a DROGA partida, and the lots elaborated from those, transitively.';

-- ============================================================================
-- 2. INV-EL4 as an equality (latest body: 0111; only the egreso query and the INV-EL4 block change).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.elaboracion_lote_validar(p_tenant_id uuid, p_elaboracion_lote_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_lote               fsj.elaboracion_lote%ROWTYPE;
  v_partida            fsj.partida%ROWTYPE;
  v_ingresos           integer;
  v_ingresos_partida   integer;
  v_ingreso_total      numeric;
  v_egresos            integer;
  v_egresos_propios    integer;
  v_egresos_droga      integer;
  v_activo_consumido   numeric;
  v_activo_producido   numeric;
  v_vencimiento_drogas date;
  v_tolerancia         constant numeric := 0.0001;
BEGIN
  SELECT * INTO v_lote FROM fsj.elaboracion_lote WHERE tenant_id = p_tenant_id AND id = p_elaboracion_lote_id;
  SELECT * INTO v_partida FROM fsj.partida WHERE tenant_id = p_tenant_id AND id = v_lote.partida_id;

  IF v_partida.origen::text <> 'ELABORACION_PROPIA' THEN
    RAISE EXCEPTION 'INV-EL1: elaboracion_lote % produces partida % of origen % (expected ELABORACION_PROPIA)', v_lote.id, v_partida.id, v_partida.origen
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-EL1: one ingreso, on the produced partida, equal to its cantidad_inicial.
  SELECT count(*), count(*) FILTER (WHERE m.partida_id = v_partida.id), coalesce(sum(m.cantidad), 0)
    INTO v_ingresos, v_ingresos_partida, v_ingreso_total
  FROM fsj.movimiento_stock m
  WHERE m.tenant_id = p_tenant_id AND m.elaboracion_lote_id = v_lote.id AND m.tipo::text = 'INGRESO_ELABORACION';

  IF v_ingresos <> 1 OR v_ingresos_partida <> 1 OR v_ingreso_total <> v_partida.cantidad_inicial THEN
    RAISE EXCEPTION 'INV-EL1: elaboracion_lote % must have exactly one INGRESO_ELABORACION on its partida % equal to cantidad_inicial % (found % ingresos, % on the partida, totalling %)',
      v_lote.id, v_partida.id, v_partida.cantidad_inicial, v_ingresos, v_ingresos_partida, v_ingreso_total
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-EL2: at least one egreso, none from the produced partida.
  SELECT count(*),
         count(*) FILTER (WHERE m.partida_id = v_partida.id),
         count(*) FILTER (WHERE p.droga_id = v_partida.droga_id),
         coalesce(sum(m.cantidad * coalesce(p.potencia_declarada, 100) / 100) FILTER (WHERE p.droga_id = v_partida.droga_id), 0),
         min(p.fecha_vencimiento_vigente) FILTER (WHERE d.clase = 'DROGA')
    INTO v_egresos, v_egresos_propios, v_egresos_droga, v_activo_consumido, v_vencimiento_drogas
  FROM fsj.movimiento_stock m
  JOIN fsj.partida p ON p.tenant_id = m.tenant_id AND p.id = m.partida_id
  JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
  WHERE m.tenant_id = p_tenant_id AND m.elaboracion_lote_id = v_lote.id AND m.tipo::text = 'EGRESO_ELABORACION';

  IF v_egresos = 0 OR v_egresos_propios <> 0 THEN
    RAISE EXCEPTION 'INV-EL2: elaboracion_lote % must consume at least one partida and never its own produced partida (found % egresos, % from the produced partida)',
      v_lote.id, v_egresos, v_egresos_propios
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-EL3: a DILUCION consumes its own droga and holds exactly the active consumed; a FORMULA lot never consumes
  -- its own droga.
  IF v_lote.tipo = 'DILUCION' THEN
    v_activo_producido := v_partida.cantidad_inicial * coalesce(v_partida.potencia_declarada, 100) / 100;
    IF v_egresos_droga = 0 OR abs(v_activo_producido - v_activo_consumido) >= v_tolerancia THEN
      RAISE EXCEPTION 'INV-EL3: dilución % must hold the active it consumed of droga % (consumed %, produced %)',
        v_lote.id, v_partida.droga_id, v_activo_consumido, v_activo_producido
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_egresos_droga <> 0 THEN
    RAISE EXCEPTION 'INV-EL3: elaboracion_lote % (FORMULA) consumes its own droga %', v_lote.id, v_partida.droga_id
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-EL4 (0114): the lot expires exactly when the first consumed DROGA partida does; insumos do not bound it.
  -- Without a DROGA consumed it keeps its own date (NULL allowed only for an insumo, 0064).
  IF v_vencimiento_drogas IS NOT NULL AND v_partida.fecha_vencimiento IS DISTINCT FROM v_vencimiento_drogas THEN
    RAISE EXCEPTION 'INV-EL4: partida % expires % but the first consumed droga expires % (an elaborated lot takes its date)',
      v_partida.id, coalesce(v_partida.fecha_vencimiento::text, 'never'), v_vencimiento_drogas
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION fsj.elaboracion_lote_validar(uuid, uuid) IS
  'INV-EL1..EL4 (0111): by commit time an elaboration has one INGRESO_ELABORACION on its ELABORACION_PROPIA partida equal to cantidad_inicial, at least one EGRESO_ELABORACION and none from that partida; a DILUCION holds the active it consumed of its droga (tolerance 10^-4), a FORMULA lot never consumes its own droga. 0114: the produced vencimiento IS the earliest vencimiento vigente of the consumed DROGA partidas.';

-- ============================================================================
-- 3. The lots follow their drugs (only from a reanálisis).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.lote_elaborado_seguir_vencimiento(p_tenant_id uuid, p_partida_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = fsj, extensions
AS $$
DECLARE
  v_lote uuid;
BEGIN
  FOR v_lote IN
    SELECT DISTINCT el.partida_id
    FROM fsj.movimiento_stock m
    JOIN fsj.partida p ON p.tenant_id = m.tenant_id AND p.id = m.partida_id
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id AND d.clase = 'DROGA'
    JOIN fsj.elaboracion_lote el ON el.tenant_id = m.tenant_id AND el.id = m.elaboracion_lote_id
    WHERE m.tenant_id = p_tenant_id AND m.partida_id = p_partida_id AND m.tipo::text = 'EGRESO_ELABORACION'
  LOOP
    UPDATE fsj.partida lote
    SET fecha_vencimiento_vigente = (
      SELECT min(p.fecha_vencimiento_vigente)
      FROM fsj.elaboracion_lote el
      JOIN fsj.movimiento_stock m ON m.tenant_id = el.tenant_id AND m.elaboracion_lote_id = el.id AND m.tipo::text = 'EGRESO_ELABORACION'
      JOIN fsj.partida p ON p.tenant_id = m.tenant_id AND p.id = m.partida_id
      JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id AND d.clase = 'DROGA'
      WHERE el.tenant_id = p_tenant_id AND el.partida_id = v_lote
    )
    WHERE lote.tenant_id = p_tenant_id AND lote.id = v_lote;

    PERFORM fsj.lote_elaborado_seguir_vencimiento(p_tenant_id, v_lote);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION fsj.lote_elaborado_seguir_vencimiento(uuid, uuid) IS
  '0114 (EL5). Re-derives fecha_vencimiento_vigente of every lot elaborated from the partida (the earliest vigente among its consumed DROGA partidas), then of the lots elaborated from those. Runs only inside fsj.reanalisis_partida_aplicar, under its fsj.reanalisis flag (INV-S23).';

REVOKE EXECUTE ON FUNCTION fsj.lote_elaborado_seguir_vencimiento(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fsj.lote_elaborado_seguir_vencimiento(uuid, uuid) FROM fsj_app;

-- ============================================================================
-- 4. A reanálisis moves the lots that follow the partida (latest body: 0074).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.reanalisis_partida_aplicar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
BEGIN
  PERFORM set_config('fsj.reanalisis', 'on', true);
  UPDATE fsj.partida
  SET fecha_vencimiento_vigente = NEW.fecha_reanalisis
  WHERE tenant_id = NEW.tenant_id AND id = NEW.partida_id;
  PERFORM fsj.lote_elaborado_seguir_vencimiento(NEW.tenant_id, NEW.partida_id);
  PERFORM set_config('fsj.reanalisis', 'off', true);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.reanalisis_partida_aplicar() IS
  'INV-S23 (0074): moves partida.fecha_vencimiento_vigente to the reanálisis date, under the transaction-local flag fsj.reanalisis that fsj.partida_validar_update() requires. 0114: then the lots elaborated from it follow (fsj.lote_elaborado_seguir_vencimiento).';

-- ============================================================================
-- 5. INV-S22 (latest body: 0074).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.reanalisis_partida_validar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_clase       fsj.clase_droga;
  v_saldo       numeric;
  v_vigente     date;
  v_jornada     date;
BEGIN
  -- Same row lock every stock write takes first (ajuste, confirmación): a
  -- concurrent ajuste/egreso and this reanálisis serialize.
  SELECT d.clase, p.cantidad_disponible, p.fecha_vencimiento_vigente
    INTO v_clase, v_saldo, v_vigente
  FROM fsj.partida p
  JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
  WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.partida_id
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-S22: partida % not found', NEW.partida_id USING ERRCODE = 'P0001';
  END IF;

  IF v_clase IS DISTINCT FROM 'DROGA' OR v_vigente IS NULL THEN
    RAISE EXCEPTION 'INV-S22: only a partida of a droga (clase DROGA) can be re-analysed' USING ERRCODE = 'P0001';
  END IF;

  -- 0114: an elaborated lot follows its drugs; the drug is re-analysed instead.
  IF fsj.lote_sigue_a_drogas(NEW.tenant_id, NEW.partida_id) THEN
    RAISE EXCEPTION 'INV-S22: partida % is an elaborated lot that follows the vencimiento of its drugs: re-analyse them', NEW.partida_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 0114: without saldo it is still re-analysable while a lot elaborated from it has saldo.
  IF v_saldo <= 0 AND NOT EXISTS (
    SELECT 1
    FROM fsj.lotes_elaborados_dependientes(NEW.tenant_id, NEW.partida_id) dep
    JOIN fsj.partida l ON l.tenant_id = NEW.tenant_id AND l.id = dep.partida_id
    WHERE l.cantidad_disponible > 0
  ) THEN
    RAISE EXCEPTION 'INV-S22: partida % has no saldo (terminal): it can not be re-analysed', NEW.partida_id USING ERRCODE = 'P0001';
  END IF;

  v_jornada := fsj.jornada_actual(NEW.tenant_id);
  IF NEW.fecha_reanalisis <= v_jornada THEN
    RAISE EXCEPTION 'INV-S22: fecha_reanalisis % must be after the jornada %', NEW.fecha_reanalisis, v_jornada USING ERRCODE = 'P0001';
  END IF;

  IF NOT fsj.es_dt_vigente(NEW.registrado_por_id, v_jornada) THEN
    RAISE EXCEPTION 'INV-S22: registrado_por_id % is not a DT vigente today', NEW.registrado_por_id USING ERRCODE = 'P0001';
  END IF;

  NEW.fecha_vencimiento_anterior := v_vigente;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.reanalisis_partida_validar() IS
  'INV-S22 (0074): a reanálisis needs a DROGA partida with saldo (saldo 0 is terminal), a fecha_reanalisis strictly after fsj.jornada_actual(tenant), and a DT vigente (fsj.es_dt_vigente) as registrado_por_id. Sets fecha_vencimiento_anterior from the partida. 0114: never on a lot that follows its drugs (fsj.lote_sigue_a_drogas); saldo 0 is accepted while a lot elaborated from it has saldo.';

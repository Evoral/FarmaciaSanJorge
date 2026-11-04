-- Rollback of 0114_vencimiento_lote_elaborado (apply as a NEW forward migration). The code must be reverted too.
-- Restores the 0111 INV-EL4 (never later than a consumed partida) and the 0074 reanálisis bodies, then drops the 0114
-- functions. Vencimientos already moved by a reanálisis of a source drug stay as they are; from now on those lots are
-- re-analysed on their own again.

-- 0111 body.
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
  v_vencimiento_minimo date;
  v_alguno_vence       boolean;
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
         min(p.fecha_vencimiento_vigente),
         bool_or(p.fecha_vencimiento_vigente IS NOT NULL)
    INTO v_egresos, v_egresos_propios, v_egresos_droga, v_activo_consumido, v_vencimiento_minimo, v_alguno_vence
  FROM fsj.movimiento_stock m
  JOIN fsj.partida p ON p.tenant_id = m.tenant_id AND p.id = m.partida_id
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

  -- INV-EL4: never later than a consumed partida's vencimiento vigente (consumed ones without one do not bound it).
  IF v_alguno_vence AND (v_partida.fecha_vencimiento IS NULL OR v_partida.fecha_vencimiento > v_vencimiento_minimo) THEN
    RAISE EXCEPTION 'INV-EL4: partida % expires % but a consumed partida expires % (it can expire earlier, never later)',
      v_partida.id, coalesce(v_partida.fecha_vencimiento::text, 'never'), v_vencimiento_minimo
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;
COMMENT ON FUNCTION fsj.elaboracion_lote_validar(uuid, uuid) IS
  'INV-EL1..EL4 (0111): by commit time an elaboration has one INGRESO_ELABORACION on its ELABORACION_PROPIA partida equal to cantidad_inicial, at least one EGRESO_ELABORACION and none from that partida; a DILUCION holds the active it consumed of its droga (tolerance 10^-4), a FORMULA lot never consumes its own droga; the produced vencimiento is never later than a consumed one.';

-- 0074 bodies.
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

  PERFORM set_config('fsj.reanalisis', 'off', true);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.reanalisis_partida_aplicar() IS
  'INV-S23 (0074): moves partida.fecha_vencimiento_vigente to the reanálisis date, under the transaction-local flag fsj.reanalisis that fsj.partida_validar_update() requires.';

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

  IF v_saldo <= 0 THEN
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
  'INV-S22 (0074): a reanálisis needs a DROGA partida with saldo (saldo 0 is terminal), a fecha_reanalisis strictly after fsj.jornada_actual(tenant), and a DT vigente (fsj.es_dt_vigente) as registrado_por_id. Sets fecha_vencimiento_anterior from the partida.';

DROP FUNCTION IF EXISTS fsj.lote_elaborado_seguir_vencimiento(uuid, uuid);
DROP FUNCTION IF EXISTS fsj.lotes_elaborados_dependientes(uuid, uuid);
DROP FUNCTION IF EXISTS fsj.lote_sigue_a_drogas(uuid, uuid);

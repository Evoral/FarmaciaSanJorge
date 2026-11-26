-- Rollback of 0134_unidad_internacional_stock (apply as a NEW forward migration).
-- Restores fsj.elaboracion_lote_validar to its 0114 body and drops relevamiento_fila.actividad_declarada.

-- 1. Restore fsj.elaboracion_lote_validar to 0114 definition
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

-- 2. Drop relevamiento_fila.actividad_declarada
ALTER TABLE fsj.relevamiento_fila
  DROP CONSTRAINT IF EXISTS relevamiento_fila_potencia_o_actividad_check,
  DROP CONSTRAINT IF EXISTS relevamiento_fila_actividad_declarada_check,
  DROP COLUMN IF EXISTS actividad_declarada;

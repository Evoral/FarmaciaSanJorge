-- Rollback of 0100_existencia_inicial (apply as a NEW forward migration).
-- Only possible while NO existencia inicial partida exists: those partidas (and their INGRESO_INICIAL movements,
-- egresos, asientos) are stock the pharmacy is using, and movimiento_stock / partida are append-only. With any of
-- them present this script aborts; see docs/rollbacks/existencia-inicial.md. The enum value INGRESO_INICIAL stays
-- (Postgres cannot drop an enum value); with no row using it, it is inert.
-- The code must be reverted too (docs/rollbacks/existencia-inicial.md).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.partida WHERE origen = 'EXISTENCIA_INICIAL') THEN
    RAISE EXCEPTION 'Rollback 0100: existencia inicial partidas exist -- cannot drop the feature without losing stock';
  END IF;
END $$;

-- Bodies as before 0100 (0014 / 0074 / 0008).
CREATE OR REPLACE FUNCTION fsj.movimiento_stock_validar_contralor(p_tenant_id uuid, p_movimiento_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_mov          fsj.movimiento_stock%ROWTYPE;
  v_activacion   timestamptz;
  v_tipo_control fsj.tipo_control;
BEGIN
  SELECT * INTO v_mov FROM fsj.movimiento_stock WHERE tenant_id = p_tenant_id AND id = p_movimiento_id;

  SELECT fecha_activacion_contralor INTO v_activacion FROM fsj.tenant WHERE id = p_tenant_id;
  IF v_activacion IS NULL OR v_mov.registrado_en < v_activacion THEN
    RETURN;
  END IF;

  SELECT d.tipo_control INTO v_tipo_control
  FROM fsj.partida p
  JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
  WHERE p.tenant_id = p_tenant_id AND p.id = v_mov.partida_id;

  IF v_tipo_control IS NULL OR v_tipo_control = 'NINGUNO' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM fsj.asiento_contralor WHERE tenant_id = p_tenant_id AND movimiento_stock_id = p_movimiento_id) THEN
    RAISE EXCEPTION 'INV-L08: movimiento_stock % on controlled droga (tipo_control %) requires a matching asiento_contralor', p_movimiento_id, v_tipo_control
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;
COMMENT ON FUNCTION fsj.movimiento_stock_validar_contralor(uuid, uuid) IS NULL;

CREATE OR REPLACE FUNCTION fsj.movimiento_stock_aplicar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_delta               numeric;
  v_fecha_vencimiento    date;
BEGIN
  IF NEW.tipo = 'INGRESO_COMPRA' THEN
    v_delta := NEW.cantidad;
  ELSE
    v_delta := -NEW.cantidad;
  END IF;

  IF NEW.tipo = 'EGRESO_PREPARACION' THEN
    SELECT fecha_vencimiento_vigente INTO v_fecha_vencimiento
    FROM fsj.partida WHERE id = NEW.partida_id;

    IF v_fecha_vencimiento < fsj.jornada_actual(NEW.tenant_id) THEN
      RAISE EXCEPTION 'INV-S10: cannot register EGRESO_PREPARACION against expired partida % (fecha_vencimiento_vigente %)',
        NEW.partida_id, v_fecha_vencimiento
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM set_config('fsj.mov', 'on', true);

  UPDATE fsj.partida
  SET cantidad_disponible = cantidad_disponible + v_delta,
      fecha_apertura = CASE
        WHEN NEW.tipo = 'EGRESO_PREPARACION' AND fecha_apertura IS NULL THEN NEW.registrado_en
        ELSE fecha_apertura
      END
  WHERE id = NEW.partida_id;

  PERFORM set_config('fsj.mov', 'off', true);

  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION fsj.movimiento_stock_aplicar() IS
  'INV-S01/S04, INV-S16/S17, INV-S10. 0014: fsj.jornada_actual(tenant_id) instead of current_date. 0074: INV-S10 reads partida.fecha_vencimiento_vigente (the latest reanálisis, else fecha_vencimiento).';

CREATE OR REPLACE FUNCTION fsj.partida_validar_ingreso_compra(p_tenant_id uuid, p_partida_id uuid, p_cantidad_inicial numeric)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_total numeric;
BEGIN
  SELECT count(*), coalesce(sum(cantidad), 0)
    INTO v_count, v_total
  FROM fsj.movimiento_stock
  WHERE tenant_id = p_tenant_id AND partida_id = p_partida_id AND tipo = 'INGRESO_COMPRA';

  IF v_count <> 1 OR v_total <> p_cantidad_inicial THEN
    RAISE EXCEPTION 'INV-STK-002: partida % must have exactly one INGRESO_COMPRA movement equal to cantidad_inicial (found % movement(s) totalling %, expected %)',
      p_partida_id, v_count, v_total, p_cantidad_inicial
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;
COMMENT ON FUNCTION fsj.partida_validar_ingreso_compra(uuid, uuid, numeric) IS NULL;

DROP TRIGGER IF EXISTS trg_partida_validar_existencia_inicial ON fsj.partida;
DROP FUNCTION IF EXISTS fsj.partida_validar_existencia_inicial();
DROP FUNCTION IF EXISTS fsj.relevamiento_inicial_abierto(uuid);
DROP FUNCTION IF EXISTS fsj.relevamiento_inicial_fecha_limite(uuid);

REVOKE UPDATE (relevamiento_inicial_cerrado_en, relevamiento_inicial_cerrado_por_id) ON fsj.tenant FROM fsj_app;
DROP TRIGGER IF EXISTS trg_tenant_validar_relevamiento_inicial ON fsj.tenant;
DROP FUNCTION IF EXISTS fsj.tenant_validar_relevamiento_inicial();
ALTER TABLE fsj.tenant
  DROP CONSTRAINT IF EXISTS tenant_relevamiento_inicial_cierre_completo,
  DROP CONSTRAINT IF EXISTS tenant_relevamiento_inicial_cerrado_por_fkey;
ALTER TABLE fsj.tenant
  DROP COLUMN IF EXISTS relevamiento_inicial_cerrado_en,
  DROP COLUMN IF EXISTS relevamiento_inicial_cerrado_por_id;

DROP INDEX IF EXISTS fsj.uq_partida_lote_sin_proveedor;
ALTER TABLE fsj.partida DROP CONSTRAINT IF EXISTS partida_proveedor_obligatorio;
ALTER TABLE fsj.partida ALTER COLUMN proveedor_id SET NOT NULL;
ALTER TABLE fsj.partida DROP COLUMN IF EXISTS origen;
DROP TYPE IF EXISTS fsj.origen_partida;

-- The fsj.parametro row dias_relevamiento_inicial, if any, is left in place: nothing reads it any more.

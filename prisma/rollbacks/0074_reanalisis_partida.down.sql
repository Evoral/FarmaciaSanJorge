-- Rollback of 0074_reanalisis_partida. Apply as a NEW forward migration,
-- AFTER deploying the code that no longer reads fecha_vencimiento_vigente /
-- fsj.reanalisis_partida (docs/rollbacks/reanalisis-partida.md).
--
-- Every reanálisis is lost with the table: a re-analysed partida goes back to
-- its ORIGINAL fecha_vencimiento, so one whose original date already passed
-- is blocked again (INV-S10) until it is zeroed with a VENCIMIENTO ajuste.
-- Export the history first (see the rollback doc).

-- 7. v_stock_droga: back to its 0071 body (it reads the column dropped below).
CREATE OR REPLACE VIEW fsj.v_stock_droga
WITH (security_invoker = true) AS
SELECT
  d.tenant_id,
  d.id AS droga_id,
  coalesce(
    sum(greatest(p.cantidad_disponible - r.reservado, 0))
      FILTER (WHERE p.fecha_vencimiento IS NULL OR p.fecha_vencimiento >= fsj.jornada_actual(d.tenant_id)),
    0
  ) AS stock_disponible
FROM fsj.droga d
LEFT JOIN fsj.partida p ON p.tenant_id = d.tenant_id AND p.droga_id = d.id
LEFT JOIN LATERAL (
  SELECT coalesce(sum(rs.cantidad), 0) AS reservado
  FROM fsj.reserva_stock rs
  JOIN fsj.preparacion rp ON rp.tenant_id = rs.tenant_id AND rp.id = rs.preparacion_id
  WHERE rs.tenant_id = p.tenant_id AND rs.partida_id = p.id AND rp.estado = 'INICIADA'
) r ON true
GROUP BY d.tenant_id, d.id;

COMMENT ON VIEW fsj.v_stock_droga IS
  'M06/M07. stock_disponible = SUM over non-expired partidas (fecha_vencimiento NULL -- does not expire, 0064 -- or >= fsj.jornada_actual(tenant_id), 0025) of cantidad_disponible minus the stock reserved by INICIADA preparaciones (fsj.reserva_stock, 0071), never below 0 per partida. Do not sum in the application when this view exists (plan §9 M07 "NO HACER").';

-- 6. movimiento_stock_aplicar: back to its 0014 body.
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
    SELECT fecha_vencimiento INTO v_fecha_vencimiento
    FROM fsj.partida WHERE id = NEW.partida_id;

    IF v_fecha_vencimiento < fsj.jornada_actual(NEW.tenant_id) THEN
      RAISE EXCEPTION 'INV-S10: cannot register EGRESO_PREPARACION against expired partida % (fecha_vencimiento %)',
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
  'INV-S01/S04, INV-S16/S17, INV-S10. Updated by migration 0014 to use fsj.jornada_actual(tenant_id) instead of current_date -- see migration 0014 header point 9.';

-- 3-5. The reanálisis table, its triggers and functions.
DROP TABLE IF EXISTS fsj.reanalisis_partida;
DROP FUNCTION IF EXISTS fsj.reanalisis_partida_aplicar();
DROP FUNCTION IF EXISTS fsj.reanalisis_partida_validar();

-- 2. partida_validar_update: back to its 0008 body.
CREATE OR REPLACE FUNCTION fsj.partida_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cantidad_disponible IS DISTINCT FROM OLD.cantidad_disponible
     AND coalesce(current_setting('fsj.mov', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S01: partida.cantidad_disponible can only be changed by a movimiento_stock insert'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.fecha_apertura IS NOT NULL AND NEW.fecha_apertura IS DISTINCT FROM OLD.fecha_apertura THEN
    RAISE EXCEPTION 'INV-S17: partida.fecha_apertura cannot change once set'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.fecha_apertura IS NULL AND NEW.fecha_apertura IS NOT NULL
     AND coalesce(current_setting('fsj.mov', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S16: partida.fecha_apertura can only be set by a movimiento_stock insert'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- 1. The column and its initialiser.
DROP TRIGGER IF EXISTS trg_partida_inicializar_vencimiento_vigente ON fsj.partida;
DROP FUNCTION IF EXISTS fsj.partida_inicializar_vencimiento_vigente();
ALTER TABLE fsj.partida DROP COLUMN IF EXISTS fecha_vencimiento_vigente;

COMMENT ON COLUMN fsj.partida.fecha_vencimiento IS
  '0064. NULL = does not expire -- allowed only for an insumo (droga.clase <> DROGA, trg_partida_validar_vencimiento). Insert-only for fsj_app.';

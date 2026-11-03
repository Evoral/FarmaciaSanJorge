-- Rollback of 0111_lotes_elaborados (apply as a NEW forward migration).
-- Only possible while NO elaboration exists: an ELABORACION_PROPIA partida and its movements are stock the pharmacy
-- is using, and movimiento_stock / partida are append-only. With any of them present this script aborts; see
-- docs/rollbacks/lotes-elaborados.md. The enum values ELABORACION_PROPIA, INGRESO_ELABORACION and EGRESO_ELABORACION
-- stay (Postgres cannot drop an enum value); with no row using them, they are inert.
-- Fórmulas are lost. The code must be reverted too (docs/rollbacks/lotes-elaborados.md).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.partida WHERE origen::text = 'ELABORACION_PROPIA')
     OR EXISTS (SELECT 1 FROM fsj.elaboracion_lote) THEN
    RAISE EXCEPTION 'Rollback 0111: elaborated partidas exist -- cannot drop the feature without losing stock';
  END IF;
END $$;

-- Permiso and its role / PIN rows.
DELETE FROM fsj.rol_permiso rp
USING fsj.permiso p
WHERE rp.permiso_id = p.id
  AND p.codigo = 'stock.lote.elaborar';

DELETE FROM fsj.accion_con_pin a
USING fsj.permiso p
WHERE a.permiso_id = p.id
  AND p.codigo = 'stock.lote.elaborar';

DELETE FROM fsj.permiso WHERE codigo = 'stock.lote.elaborar';

-- v_stock_droga as 0074 (a column cannot be dropped with CREATE OR REPLACE).
DROP VIEW fsj.v_stock_droga;
CREATE VIEW fsj.v_stock_droga
WITH (security_invoker = true) AS
SELECT
  d.tenant_id,
  d.id AS droga_id,
  coalesce(
    sum(greatest(p.cantidad_disponible - r.reservado, 0))
      FILTER (WHERE p.fecha_vencimiento_vigente IS NULL OR p.fecha_vencimiento_vigente >= fsj.jornada_actual(d.tenant_id)),
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
  'M06/M07. stock_disponible = SUM over non-expired partidas (fecha_vencimiento_vigente -- the latest reanálisis, else fecha_vencimiento, 0074 -- NULL, does not expire, 0064, or >= fsj.jornada_actual(tenant_id), 0025) of cantidad_disponible minus the stock reserved by INICIADA preparaciones (fsj.reserva_stock, 0071), never below 0 per partida. Do not sum in the application when this view exists (plan §9 M07 "NO HACER").';

GRANT SELECT ON fsj.v_stock_droga TO fsj_app;

-- Bodies as 0100.
CREATE OR REPLACE FUNCTION fsj.partida_validar_ingreso_compra(p_tenant_id uuid, p_partida_id uuid, p_cantidad_inicial numeric)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_origen     fsj.origen_partida;
  v_tipo       text;
  v_count      integer;
  v_total      numeric;
  v_otros      integer;
BEGIN
  SELECT origen INTO v_origen FROM fsj.partida WHERE tenant_id = p_tenant_id AND id = p_partida_id;
  v_tipo := CASE WHEN v_origen = 'EXISTENCIA_INICIAL' THEN 'INGRESO_INICIAL' ELSE 'INGRESO_COMPRA' END;

  SELECT count(*) FILTER (WHERE tipo::text = v_tipo),
         coalesce(sum(cantidad) FILTER (WHERE tipo::text = v_tipo), 0),
         count(*) FILTER (WHERE tipo::text IN ('INGRESO_COMPRA', 'INGRESO_INICIAL') AND tipo::text <> v_tipo)
    INTO v_count, v_total, v_otros
  FROM fsj.movimiento_stock
  WHERE tenant_id = p_tenant_id AND partida_id = p_partida_id;

  IF v_count <> 1 OR v_total <> p_cantidad_inicial OR v_otros <> 0 THEN
    RAISE EXCEPTION 'INV-STK-002/INV-S25: partida % (origen %) must have exactly one % movement equal to cantidad_inicial and no other ingreso (found % totalling %, % of the other type, expected %)',
      p_partida_id, v_origen, v_tipo, v_count, v_total, v_otros, p_cantidad_inicial
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;
COMMENT ON FUNCTION fsj.partida_validar_ingreso_compra(uuid, uuid, numeric) IS
  'INV-STK-002 (0008), INV-S25 (0100): by commit time a partida has exactly one ingreso equal to cantidad_inicial, of its origen''s type (COMPRA -> INGRESO_COMPRA, EXISTENCIA_INICIAL -> INGRESO_INICIAL), and none of the other.';

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
  IF NEW.tipo::text IN ('INGRESO_COMPRA', 'INGRESO_INICIAL') THEN
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
  'INV-S01/S04, INV-S16/S17, INV-S10. 0014: fsj.jornada_actual(tenant_id) instead of current_date. 0074: INV-S10 reads partida.fecha_vencimiento_vigente (the latest reanálisis, else fecha_vencimiento). 0100: INGRESO_INICIAL adds, like INGRESO_COMPRA.';

-- Elaboration objects.
DROP TRIGGER IF EXISTS trg_movimiento_stock_elaboracion_lote_validar ON fsj.movimiento_stock;
ALTER TABLE fsj.movimiento_stock
  DROP CONSTRAINT IF EXISTS movimiento_stock_elaboracion_lote_check,
  DROP CONSTRAINT IF EXISTS movimiento_stock_elaboracion_lote_fkey;
DROP INDEX IF EXISTS fsj.idx_movimiento_stock_elaboracion_lote;
ALTER TABLE fsj.movimiento_stock DROP COLUMN IF EXISTS elaboracion_lote_id;

DROP TABLE IF EXISTS fsj.elaboracion_lote;
DROP FUNCTION IF EXISTS fsj.trg_elaboracion_lote_check();
DROP FUNCTION IF EXISTS fsj.elaboracion_lote_validar(uuid, uuid);
DROP TABLE IF EXISTS fsj.formula_elaboracion_componente;
DROP TABLE IF EXISTS fsj.formula_elaboracion;
DROP FUNCTION IF EXISTS fsj.formula_elaboracion_validar_nivel();
DROP TYPE IF EXISTS fsj.tipo_elaboracion;

-- partida constraints as 0100.
ALTER TABLE fsj.partida DROP CONSTRAINT IF EXISTS partida_elaborada_sin_compra;
ALTER TABLE fsj.partida DROP CONSTRAINT IF EXISTS partida_proveedor_obligatorio;
ALTER TABLE fsj.partida
  ADD CONSTRAINT partida_proveedor_obligatorio CHECK (proveedor_id IS NOT NULL OR origen = 'EXISTENCIA_INICIAL');

COMMENT ON COLUMN fsj.partida.origen IS
  '0100: COMPRA (a purchase, INGRESO_COMPRA) or EXISTENCIA_INICIAL (stock counted at the relevamiento inicial, INGRESO_INICIAL, proveedor optional). Insert-only.';

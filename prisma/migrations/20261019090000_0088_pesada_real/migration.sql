-- 0088 -- Pesada real (docs/specs/pesada-real.md).
--
-- The lab weighs by hand: what the balance shows never matches the computed
-- cantidad_a_pesar exactly. The "Marcar como preparada" form now records the
-- REAL weighed (physical) quantity of every non-manual línea, and the stock,
-- the contralor and the libro use it instead of the theoretical one.
--
--   1. reserva_stock.cantidad_real / pesada_autorizada_por_id: the línea's real
--      weighing (línea unit, repeated on each of its rows, like cantidad_manual)
--      and the DT who authorized it when it falls outside the tolerance.
--   2. fsj.pesada_real: written at the confirmation ("Imprimir etiquetas"), one
--      row per non-manual línea weighed for real: esperada, real, the allowed
--      margen and, outside it, the DT co-firma (a DT vigente, like INV-U05).
--      Immutable.
--   3. INV-S12 (fsj.linea_pesaje_validar_consumo, 0073): a non-manual línea with
--      a pesada_real row must consume exactly that PHYSICAL quantity; without
--      one (confirmed before 0088, or a path that sends none) the 0073 rule
--      (active consumption = cantidad_a_pesar) is unchanged.
--   4. Parameter tolerancia_pesada_porcentaje = 5 for every existing tenant.
--
-- *** APPLY 0088 TOGETHER WITH THE CODE THAT WRITES pesada_real (same deploy). ***
-- Old code + 0088: no pesada_real rows, the 0073 rule applies -- unchanged.
-- New code without 0088: the INSERT into fsj.pesada_real fails.
-- Rollback: prisma/rollbacks/0088_pesada_real.down.sql (as a NEW forward migration).

-- ============================================================================
-- 1. reserva_stock: the línea's real weighing
-- ============================================================================
ALTER TABLE fsj.reserva_stock
  ADD COLUMN cantidad_real numeric,
  ADD COLUMN pesada_autorizada_por_id uuid,
  ADD CONSTRAINT reserva_stock_cantidad_real_check CHECK (cantidad_real IS NULL OR cantidad_real > 0),
  ADD CONSTRAINT reserva_stock_pesada_autorizada_por_fkey FOREIGN KEY (tenant_id, pesada_autorizada_por_id) REFERENCES fsj.usuario (tenant_id, id);

COMMENT ON COLUMN fsj.reserva_stock.cantidad_real IS
  '0088. Non-manual líneas: the real weighed (physical) quantity, in the LÍNEA''s unit (same value on every row of the línea).';
COMMENT ON COLUMN fsj.reserva_stock.pesada_autorizada_por_id IS
  '0088. The DT who co-signed a cantidad_real outside the tolerance (same value on every row of the línea).';

-- ============================================================================
-- 2. fsj.pesada_real
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.pesada_real (
  id                 uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  preparacion_id     uuid        NOT NULL,
  linea_pesaje_id    uuid        NOT NULL,
  cantidad_esperada  numeric     NOT NULL,   -- physical, purity-corrected, línea unit
  cantidad_real      numeric     NOT NULL,   -- what the balance showed, línea unit
  margen             numeric     NOT NULL,   -- allowed |real - esperada|, línea unit
  autorizado_por_id  uuid,                   -- DT co-firma, required outside the margen
  registrado_por_id  uuid        NOT NULL,
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pesada_real_tenant_id_key UNIQUE (tenant_id, id),
  -- A línea is consumed by ONE confirmation (INV-S12 sums every egreso of the línea).
  CONSTRAINT pesada_real_linea_key UNIQUE (tenant_id, linea_pesaje_id),
  CONSTRAINT pesada_real_preparacion_fkey FOREIGN KEY (tenant_id, preparacion_id) REFERENCES fsj.preparacion (tenant_id, id),
  CONSTRAINT pesada_real_linea_fkey FOREIGN KEY (tenant_id, linea_pesaje_id) REFERENCES fsj.linea_pesaje (tenant_id, id),
  CONSTRAINT pesada_real_autorizado_por_fkey FOREIGN KEY (tenant_id, autorizado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT pesada_real_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT pesada_real_cantidades_check CHECK (cantidad_esperada > 0 AND cantidad_real > 0 AND margen >= 0),
  CONSTRAINT pesada_real_tolerancia_check CHECK (abs(cantidad_real - cantidad_esperada) <= margen OR autorizado_por_id IS NOT NULL)
);

COMMENT ON TABLE fsj.pesada_real IS
  'Migration 0088. The real weighing of a non-manual línea de pesaje, written at its confirmation. Outside the margen it needs a DT vigente''s co-firma. INV-S12 compares the línea''s physical consumption with cantidad_real. Immutable.';

SELECT fsj.setup_tenant_table('fsj.pesada_real');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.pesada_real FROM fsj_app;

CREATE TRIGGER trg_pesada_real_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.pesada_real
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

CREATE TRIGGER trg_pesada_real_zz_inv_u07_insert
  BEFORE INSERT ON fsj.pesada_real
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');

-- The co-firma half of INV-U05 (same simplification as 0008: server date).
CREATE OR REPLACE FUNCTION fsj.pesada_real_validar_autorizacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.autorizado_por_id IS NOT NULL AND NOT fsj.es_dt_vigente(NEW.autorizado_por_id, current_date) THEN
    RAISE EXCEPTION 'INV-U05: pesada_real autorizado_por_id % is not a DT vigente today', NEW.autorizado_por_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pesada_real_validar_autorizacion
  BEFORE INSERT ON fsj.pesada_real
  FOR EACH ROW EXECUTE FUNCTION fsj.pesada_real_validar_autorizacion();

-- ============================================================================
-- 3. INV-S12: a línea weighed for real consumes exactly cantidad_real
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.linea_pesaje_validar_consumo(p_tenant_id uuid, p_linea_pesaje_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_manual          boolean;
  v_cantidad        numeric;
  v_unidad_linea    uuid;
  v_unidad_stock    uuid;
  v_cantidad_stock  numeric;
  v_real            numeric;
  v_real_stock      numeric;
  v_sum             numeric;
  v_sum_activo      numeric;
  v_tolerancia      constant numeric := 0.0001;
BEGIN
  SELECT l.es_enrase_manual, l.cantidad_a_pesar, l.unidad_medida_id, d.unidad_base_id
    INTO v_manual, v_cantidad, v_unidad_linea, v_unidad_stock
  FROM fsj.linea_pesaje l
  JOIN fsj.droga d ON d.tenant_id = l.tenant_id AND d.id = l.droga_id
  WHERE l.tenant_id = p_tenant_id AND l.id = p_linea_pesaje_id;

  SELECT coalesce(sum(cantidad), 0),
         coalesce(sum(cantidad * coalesce(potencia_aplicada, 100) / 100), 0)
    INTO v_sum, v_sum_activo
  FROM fsj.movimiento_stock
  WHERE tenant_id = p_tenant_id AND linea_pesaje_id = p_linea_pesaje_id AND tipo = 'EGRESO_PREPARACION';

  IF v_manual THEN
    IF v_sum <= 0 THEN
      RAISE EXCEPTION 'INV-S12: manual-enrase linea_pesaje % must have a positive registered consumption (found %)', p_linea_pesaje_id, v_sum
        USING ERRCODE = 'P0001';
    END IF;
    RETURN;
  END IF;

  SELECT cantidad_real INTO v_real
  FROM fsj.pesada_real
  WHERE tenant_id = p_tenant_id AND linea_pesaje_id = p_linea_pesaje_id;

  IF FOUND THEN
    -- 0088: the PHYSICAL consumption is the real weighing (línea unit -> droga's unidad base).
    v_real_stock := fsj.convertir(v_real, v_unidad_linea, v_unidad_stock);
    IF abs(v_sum - v_real_stock) >= v_tolerancia THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % physical consumption must equal its pesada real % (% in the droga''s unidad base; found %)', p_linea_pesaje_id, v_real, v_real_stock, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- 0073 rule, unchanged: movimiento_stock.cantidad is in the droga's unidad base; cantidad_a_pesar in the línea's unit.
    v_cantidad_stock := fsj.convertir(v_cantidad, v_unidad_linea, v_unidad_stock);
    IF v_sum_activo < v_cantidad_stock OR v_sum_activo - v_cantidad_stock >= v_tolerancia THEN
      RAISE EXCEPTION 'INV-S12: linea_pesaje % active consumption must equal cantidad_a_pesar % (% in the droga''s unidad base; found % active, % physical)', p_linea_pesaje_id, v_cantidad, v_cantidad_stock, v_sum_activo, v_sum
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- 4. Parameter for every existing tenant
-- ============================================================================
INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT
  t.id,
  'tolerancia_pesada_porcentaje',
  'NUMERO',
  '5',
  'Desvio maximo, en porcentaje, entre la pesada real y la esperada; fuera de el se pide la co-firma del Director Tecnico -- docs/specs/pesada-real.md'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;

-- 0100_existencia_inicial
--
-- docs/specs/existencia-inicial.md. The stock a pharmacy already holds the day it starts using the system enters as
-- partidas of origin EXISTENCIA_INICIAL, with their own ingreso type INGRESO_INICIAL, while the tenant's
-- relevamiento inicial is open.
--
--   - fsj.origen_partida (COMPRA | EXISTENCIA_INICIAL) and fsj.partida.origen, default COMPRA (every existing row).
--     Insert-only: no UPDATE grant.
--   - fsj.tipo_movimiento gains INGRESO_INICIAL. It ADDS saldo, like INGRESO_COMPRA (DP-21b extended): every other
--     tipo still subtracts. The new value is only referenced inside plpgsql bodies (evaluated at run time), never in
--     a constraint, so adding it in this same transaction is safe.
--   - partida.proveedor_id is nullable ONLY for EXISTENCIA_INICIAL (partida_proveedor_obligatorio). Lote uniqueness
--     without proveedor: one partida per (tenant, droga, lote) among the NULL-proveedor rows (uq_partida_lote_sin_
--     proveedor), alongside partida_lote_unico. The composite FK is MATCH SIMPLE: a NULL proveedor_id skips it.
--   - INV-STK-002 (fsj.partida_validar_ingreso_compra) now requires exactly one ingreso of the partida's own type:
--     INGRESO_COMPRA for COMPRA, INGRESO_INICIAL for EXISTENCIA_INICIAL, and none of the other (INV-S25).
--   - INV-S24: an EXISTENCIA_INICIAL partida can only be inserted while fsj.relevamiento_inicial_abierto(tenant):
--     not closed by the DT AND (no signed cierre yet OR jornada actual <= first signed cierre's fecha +
--     dias_relevamiento_inicial, parametro, default 30, capped at 90 -- three months, whatever the row says).
--   - fsj.tenant.relevamiento_inicial_cerrado_en / _por_id: the DT's explicit close. Both NULL or both set, written
--     once (INV-S26), by a DT vigente at the tenant's jornada. Column-level UPDATE grant, as 0098.
--   - INV-L08 (fsj.movimiento_stock_validar_contralor): an INGRESO_INICIAL never needs a contralor asiento -- the
--     droga's APERTURA (saldo of the manual libro) already accounts for that physical stock.
--
-- Additive for old code: existing partidas are COMPRA with a proveedor; nothing writes INGRESO_INICIAL.
-- Rollback: prisma/rollbacks/0100_existencia_inicial.down.sql (as a NEW forward migration),
-- docs/rollbacks/existencia-inicial.md.

ALTER TYPE fsj.tipo_movimiento ADD VALUE IF NOT EXISTS 'INGRESO_INICIAL';

DO $$ BEGIN
  CREATE TYPE fsj.origen_partida AS ENUM ('COMPRA', 'EXISTENCIA_INICIAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE fsj.partida
  ADD COLUMN IF NOT EXISTS origen fsj.origen_partida NOT NULL DEFAULT 'COMPRA';

ALTER TABLE fsj.partida ALTER COLUMN proveedor_id DROP NOT NULL;

ALTER TABLE fsj.partida
  ADD CONSTRAINT partida_proveedor_obligatorio CHECK (proveedor_id IS NOT NULL OR origen = 'EXISTENCIA_INICIAL');

CREATE UNIQUE INDEX IF NOT EXISTS uq_partida_lote_sin_proveedor
  ON fsj.partida (tenant_id, droga_id, lote)
  WHERE proveedor_id IS NULL;

COMMENT ON COLUMN fsj.partida.origen IS
  '0100: COMPRA (a purchase, INGRESO_COMPRA) or EXISTENCIA_INICIAL (stock counted at the relevamiento inicial, INGRESO_INICIAL, proveedor optional). Insert-only.';

-- ============================================================================
-- Relevamiento inicial: the DT's explicit close on the tenant.
-- ============================================================================
ALTER TABLE fsj.tenant
  ADD COLUMN IF NOT EXISTS relevamiento_inicial_cerrado_en timestamptz(6),
  ADD COLUMN IF NOT EXISTS relevamiento_inicial_cerrado_por_id uuid;

ALTER TABLE fsj.tenant
  ADD CONSTRAINT tenant_relevamiento_inicial_cierre_completo CHECK (
    (relevamiento_inicial_cerrado_en IS NULL) = (relevamiento_inicial_cerrado_por_id IS NULL)
  ),
  ADD CONSTRAINT tenant_relevamiento_inicial_cerrado_por_fkey
    FOREIGN KEY (id, relevamiento_inicial_cerrado_por_id) REFERENCES fsj.usuario (tenant_id, id);

COMMENT ON COLUMN fsj.tenant.relevamiento_inicial_cerrado_en IS
  '0100: when the DT closed the relevamiento inicial (docs/specs/existencia-inicial.md R7). Written once, never reopened (INV-S26).';
COMMENT ON COLUMN fsj.tenant.relevamiento_inicial_cerrado_por_id IS
  '0100: the DT vigente who closed the relevamiento inicial. Written once with relevamiento_inicial_cerrado_en (INV-S26).';

CREATE OR REPLACE FUNCTION fsj.tenant_validar_relevamiento_inicial()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.relevamiento_inicial_cerrado_en IS NOT DISTINCT FROM OLD.relevamiento_inicial_cerrado_en
     AND NEW.relevamiento_inicial_cerrado_por_id IS NOT DISTINCT FROM OLD.relevamiento_inicial_cerrado_por_id THEN
    RETURN NEW;
  END IF;

  IF OLD.relevamiento_inicial_cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'INV-S26: the relevamiento inicial of tenant % is already closed and never reopens', NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT fsj.es_dt_vigente(NEW.relevamiento_inicial_cerrado_por_id, fsj.jornada_actual(NEW.id)) THEN
    RAISE EXCEPTION 'INV-S26: only a DT vigente can close the relevamiento inicial (usuario %)', NEW.relevamiento_inicial_cerrado_por_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION fsj.tenant_validar_relevamiento_inicial() IS
  'INV-S26 (0100): the relevamiento inicial is closed once, by a DT vigente at the tenant''s jornada, and never reopens.';

DROP TRIGGER IF EXISTS trg_tenant_validar_relevamiento_inicial ON fsj.tenant;
CREATE TRIGGER trg_tenant_validar_relevamiento_inicial
  BEFORE UPDATE OF relevamiento_inicial_cerrado_en, relevamiento_inicial_cerrado_por_id ON fsj.tenant
  FOR EACH ROW EXECUTE FUNCTION fsj.tenant_validar_relevamiento_inicial();

GRANT UPDATE (relevamiento_inicial_cerrado_en, relevamiento_inicial_cerrado_por_id) ON fsj.tenant TO fsj_app;

-- ============================================================================
-- R6, computed (no job). SECURITY INVOKER: as fsj_app, RLS scopes tenant /
-- cierre_diario / parametro to the caller's tenant.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.relevamiento_inicial_fecha_limite(p_tenant_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_primer_cierre date;
  v_dias          integer;
BEGIN
  SELECT min(fecha) INTO v_primer_cierre FROM fsj.cierre_diario WHERE tenant_id = p_tenant_id;
  IF v_primer_cierre IS NULL THEN
    RETURN NULL;
  END IF;

  -- A missing or malformed row reads as the default (same fallback as the app's parametro readers).
  SELECT CASE WHEN valor ~ '^[0-9]+$' THEN valor::integer END INTO v_dias
  FROM fsj.parametro WHERE tenant_id = p_tenant_id AND clave = 'dias_relevamiento_inicial';

  -- Capped at three months even if the row was written around the app's validation: existencia inicial is an
  -- onboarding door, never a standing one.
  RETURN v_primer_cierre + least(coalesce(v_dias, 30), 90);
END;
$$;
COMMENT ON FUNCTION fsj.relevamiento_inicial_fecha_limite(uuid) IS
  '0100 (docs/specs/existencia-inicial.md R6): the last jornada of the relevamiento inicial = first signed cierre diario''s fecha + dias_relevamiento_inicial (default 30, at most 90). NULL while no cierre is signed.';

CREATE OR REPLACE FUNCTION fsj.relevamiento_inicial_abierto(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_limite date;
BEGIN
  IF (SELECT relevamiento_inicial_cerrado_en FROM fsj.tenant WHERE id = p_tenant_id) IS NOT NULL THEN
    RETURN false;
  END IF;
  v_limite := fsj.relevamiento_inicial_fecha_limite(p_tenant_id);
  RETURN v_limite IS NULL OR fsj.jornada_actual(p_tenant_id) <= v_limite;
END;
$$;
COMMENT ON FUNCTION fsj.relevamiento_inicial_abierto(uuid) IS
  '0100 (docs/specs/existencia-inicial.md R6): true while the DT has not closed the relevamiento inicial and the jornada actual is not past fsj.relevamiento_inicial_fecha_limite (NULL = no cierre signed yet).';

CREATE OR REPLACE FUNCTION fsj.partida_validar_existencia_inicial()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.origen = 'EXISTENCIA_INICIAL' AND NOT fsj.relevamiento_inicial_abierto(NEW.tenant_id) THEN
    RAISE EXCEPTION 'INV-S24: the relevamiento inicial of tenant % is closed -- no new existencia inicial partida', NEW.tenant_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION fsj.partida_validar_existencia_inicial() IS
  'INV-S24 (0100): an EXISTENCIA_INICIAL partida is inserted only while fsj.relevamiento_inicial_abierto(tenant).';

DROP TRIGGER IF EXISTS trg_partida_validar_existencia_inicial ON fsj.partida;
CREATE TRIGGER trg_partida_validar_existencia_inicial
  BEFORE INSERT ON fsj.partida
  FOR EACH ROW EXECUTE FUNCTION fsj.partida_validar_existencia_inicial();

-- ============================================================================
-- INV-STK-002 / INV-S25: exactly one ingreso, of the partida's own type.
-- Same signature as 0008 (trg_partida_check_ingreso_compra keeps calling it).
-- ============================================================================
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

-- ============================================================================
-- movimiento_stock_aplicar: INGRESO_INICIAL adds, like INGRESO_COMPRA.
-- Body otherwise identical to 0074.
-- ============================================================================
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

-- ============================================================================
-- INV-L08: an INGRESO_INICIAL never needs a contralor asiento (R8). Body
-- otherwise identical to 0014.
-- ============================================================================
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

  IF v_mov.tipo::text = 'INGRESO_INICIAL' THEN
    RETURN;
  END IF;

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
COMMENT ON FUNCTION fsj.movimiento_stock_validar_contralor(uuid, uuid) IS
  'INV-L08 (0014). 0100: an INGRESO_INICIAL is exempt -- the droga''s APERTURA asiento already holds that stock (docs/specs/existencia-inicial.md R8).';

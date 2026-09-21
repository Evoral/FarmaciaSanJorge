-- 0008_partidas_movimientos_stock
--
-- FASE 1, point 1.8: fsj.partida + fsj.movimiento_stock (M07) -- the core
-- of the stock subsystem. Depends on 0006 (unidad_medida, unused directly
-- here) and 0007 (fsj.droga, fsj.proveedor) and 0005 (fsj.es_dt_vigente).
--
-- DP-21b RESUELTA: there are NO positive stock adjustments. Every AJUSTE
-- decreases the balance; a surplus is handled by creating a NEW partida
-- instead. This falls out structurally below: fsj.movimiento_stock_aplicar()
-- only ever ADDS for tipo = 'INGRESO_COMPRA' and SUBTRACTS for every other
-- tipo (EGRESO_PREPARACION, AJUSTE) -- there is no "positive AJUSTE" code
-- path to begin with.
--
-- Left OUT of this migration on purpose, per point 1.8 scope:
--   - linea_pesaje_id on movimiento_stock (S12/S13/S19/S20, the split
--     across partidas) -- depends on linea_pesaje, which arrives in 1.10.
--     Added in migration 1.12 together with the deferred constraint
--     trigger that validates the split.
--   - preparacion_id has NO foreign key yet -- fsj.preparacion arrives in
--     1.11. The column exists (required by INV-S09) but is unconstrained
--     until then.
--   - INV-C03 (no movements against a jornada that already has a
--     CierreDiario) -- fsj.cierre_diario does not exist until 1.13.
--   - S11 (SELECT ... FOR UPDATE lock ordering), S14/S15/S18 (partida
--     proposal/desvio), S21 (never absorb arqueo differences in an egreso)
--     are [APP] concerns (FASE 8), not DB schema.

-- ============================================================================
-- Enums: tipo_movimiento, motivo_ajuste (M07)
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.tipo_movimiento AS ENUM ('INGRESO_COMPRA', 'EGRESO_PREPARACION', 'AJUSTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE fsj.motivo_ajuste AS ENUM ('ROTURA', 'DERRAME', 'VENCIMIENTO', 'PREPARACION_DESCARTADA', 'DIFERENCIA_ARQUEO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================================
-- partida (M07) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.partida (
  id                          uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id                   uuid NOT NULL,
  droga_id                    uuid NOT NULL,
  proveedor_id                uuid NOT NULL,
  lote                        text NOT NULL,
  -- Per unidad base of the droga -- PROPUESTA, plan §9 M07.
  costo_unitario              numeric NOT NULL,
  cantidad_inicial            numeric NOT NULL,
  -- INV-S01/S04: written ONLY by fsj.movimiento_stock_aplicar() (see
  -- below) -- starts at 0, raised to cantidad_inicial by the mandatory
  -- INGRESO_COMPRA in the same transaction as the INSERT.
  cantidad_disponible         numeric NOT NULL DEFAULT 0,
  fecha_ingreso               timestamptz NOT NULL DEFAULT now(),
  fecha_vencimiento           date NOT NULL,
  -- INV-S16/S17: written ONLY by fsj.movimiento_stock_aplicar(), on the
  -- first EGRESO_PREPARACION. Never reverts to NULL, never changes again.
  fecha_apertura              timestamptz,
  -- S18 [APP]: motive required when the pharmacist opens an ADDITIONAL
  -- partida while another one for the same droga is still open. Free-form,
  -- app-writable (no DB-level trigger enforces "when required" -- FASE 8).
  motivo_apertura_adicional   text,
  PRIMARY KEY (id),
  CONSTRAINT partida_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT partida_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  CONSTRAINT partida_proveedor_fkey FOREIGN KEY (tenant_id, proveedor_id) REFERENCES fsj.proveedor (tenant_id, id),
  -- PROPUESTA, plan §9 M07.
  CONSTRAINT partida_lote_unico UNIQUE (tenant_id, droga_id, proveedor_id, lote),
  CONSTRAINT partida_costo_check CHECK (costo_unitario >= 0),
  CONSTRAINT partida_cantidad_inicial_check CHECK (cantidad_inicial > 0), -- implies INV-S07-adjacent positivity for the batch itself
  -- INV-S02 (>= 0) and INV-S03 (<= cantidad_inicial) together.
  CONSTRAINT partida_cantidad_disponible_check CHECK (cantidad_disponible >= 0 AND cantidad_disponible <= cantidad_inicial)
);

COMMENT ON TABLE fsj.partida IS
  'M07. cantidad_disponible is the ONLY place stock lives (INV-S01, see fsj.droga/fsj.v_stock_droga below) and is written exclusively by fsj.movimiento_stock_aplicar() (INV-S01/S04) -- see the GRANT and trigger below for how that is enforced against fsj_app AND against any other direct UPDATE.';

SELECT fsj.setup_tenant_table('fsj.partida');

-- fsj_app may correct costo_unitario (DT/ADM, DP-13 pending on exactly who
-- and what else it affects -- plan §7 stock.partida.costo.corregir) and
-- motivo_apertura_adicional (S18, [APP]). cantidad_disponible and
-- fecha_apertura are DELIBERATELY EXCLUDED -- see comment above and the
-- trigger below (INV-S01/S04, INV-S16/S17).
GRANT UPDATE (costo_unitario, motivo_apertura_adicional) ON fsj.partida TO fsj_app;

CREATE TRIGGER trg_partida_forbid_delete
  BEFORE DELETE ON fsj.partida
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- ============================================================================
-- INV-S01/S04 (defense in depth) + INV-S16/S17: reject any UPDATE of
-- cantidad_disponible or fecha_apertura that did not come from
-- fsj.movimiento_stock_aplicar() (identified by the transaction-local flag
-- fsj.mov = 'on', set only by that function). Covers fsj_app (which has no
-- column grant on these two columns to begin with) AND fsj_owner/any other
-- role that might otherwise bypass the grant.
-- ============================================================================
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

  -- INV-S17: once set, fecha_apertura never changes again (not even via
  -- the movimiento trigger).
  IF OLD.fecha_apertura IS NOT NULL AND NEW.fecha_apertura IS DISTINCT FROM OLD.fecha_apertura THEN
    RAISE EXCEPTION 'INV-S17: partida.fecha_apertura cannot change once set'
      USING ERRCODE = 'P0001';
  END IF;

  -- INV-S16: the NULL -> value transition itself is also trigger-only.
  IF OLD.fecha_apertura IS NULL AND NEW.fecha_apertura IS NOT NULL
     AND coalesce(current_setting('fsj.mov', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S16: partida.fecha_apertura can only be set by a movimiento_stock insert'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_partida_validar_update
  BEFORE UPDATE ON fsj.partida
  FOR EACH ROW EXECUTE FUNCTION fsj.partida_validar_update();

-- ============================================================================
-- movimiento_stock (M07) -- tenant-scoped, fully immutable (INV-S06)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.movimiento_stock (
  id                  uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  partida_id          uuid NOT NULL, -- INV-S05
  tipo                fsj.tipo_movimiento NOT NULL,
  cantidad            numeric NOT NULL, -- INV-S07 (> 0) via check below
  -- FK added in 1.11 (fsj.preparacion does not exist yet). Required
  -- (non-FK) for EGRESO_PREPARACION by the check below (INV-S09).
  preparacion_id      uuid,
  motivo_ajuste       fsj.motivo_ajuste,
  observacion         text,
  registrado_por_id   uuid NOT NULL, -- INV-U06
  autorizado_por_id   uuid,          -- INV-U06/INV-S08: required only for AJUSTE
  -- S14/S15/S18 [APP]: true when the operator deviated from the proposed
  -- partida split. Not enforced here (no "proposal" concept exists at the
  -- DB layer) -- just a place for the app to record it, audited alongside.
  desvio_propuesta    boolean NOT NULL DEFAULT false,
  registrado_en       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT movimiento_stock_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT movimiento_stock_partida_fkey FOREIGN KEY (tenant_id, partida_id) REFERENCES fsj.partida (tenant_id, id),
  CONSTRAINT movimiento_stock_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT movimiento_stock_autorizado_por_fkey FOREIGN KEY (tenant_id, autorizado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT movimiento_stock_cantidad_check CHECK (cantidad > 0), -- INV-S07
  -- INV-S08 (NOT NULL half; the "authorizer is a DT vigente" half is a
  -- trigger below, since it needs to query another table).
  CONSTRAINT movimiento_stock_ajuste_check CHECK (
    tipo <> 'AJUSTE' OR (motivo_ajuste IS NOT NULL AND autorizado_por_id IS NOT NULL)
  ),
  CONSTRAINT movimiento_stock_egreso_check CHECK (
    tipo <> 'EGRESO_PREPARACION' OR preparacion_id IS NOT NULL
  ) -- INV-S09
);

COMMENT ON TABLE fsj.movimiento_stock IS
  'M07. INV-S06: fully immutable (trigger + no UPDATE/DELETE grant below). DP-21b RESUELTA: AJUSTE always subtracts -- see fsj.movimiento_stock_aplicar(). preparacion_id has no FK yet (fsj.preparacion arrives in 1.11); linea_pesaje_id (S12/S13/S19/S20) is added in 1.12.';

SELECT fsj.setup_tenant_table('fsj.movimiento_stock');

-- INV-S06: no UPDATE/DELETE/TRUNCATE, ever -- movements are immutable
-- facts. (ALTER DEFAULT PRIVILEGES only ever grants SELECT/INSERT, so this
-- REVOKE is defense-in-depth/explicit intent, same convention as
-- registro_auditoria in migration 0003.)
REVOKE UPDATE, DELETE, TRUNCATE ON fsj.movimiento_stock FROM fsj_app;

CREATE TRIGGER trg_movimiento_stock_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.movimiento_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- ============================================================================
-- INV-S08 (DT-vigency half) / INV-U05: an AJUSTE's autorizado_por_id must
-- be a DT vigente TODAY. Needs fsj.es_dt_vigente() (migration 0005), hence
-- a trigger rather than a plain CHECK. Guards on autorizado_por_id IS NOT
-- NULL so a NULL autorizador (rejected separately by
-- movimiento_stock_ajuste_check above) does not also raise this error.
--
-- NOTE (documented simplification): uses current_date (server date), not
-- the tenant's jornada in its own timezone (shared/time/jornada.ts) --
-- jornada-aware business dates are wired up starting FASE 2. Revisit this
-- trigger once a SQL-callable jornada helper exists.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.movimiento_stock_validar_ajuste()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tipo = 'AJUSTE'
     AND NEW.autorizado_por_id IS NOT NULL
     AND NOT fsj.es_dt_vigente(NEW.autorizado_por_id, current_date) THEN
    RAISE EXCEPTION 'INV-U05: AJUSTE autorizado_por_id % is not a DT vigente today', NEW.autorizado_por_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_movimiento_stock_validar_ajuste
  BEFORE INSERT ON fsj.movimiento_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.movimiento_stock_validar_ajuste();

-- ============================================================================
-- fsj.movimiento_stock_aplicar(): THE ONLY writer of
-- partida.cantidad_disponible / partida.fecha_apertura (INV-S01/S04,
-- INV-S16/S17). SECURITY DEFINER so it can write those columns even though
-- fsj_app has no UPDATE grant on them (see the partida GRANT above).
--
-- DP-21b RESUELTA: INGRESO_COMPRA adds; every other tipo (EGRESO_PREPARACION,
-- AJUSTE) subtracts. There is no branch that adds for AJUSTE.
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
  IF NEW.tipo = 'INGRESO_COMPRA' THEN
    v_delta := NEW.cantidad;
  ELSE
    -- EGRESO_PREPARACION and AJUSTE: DP-21b, always subtract.
    v_delta := -NEW.cantidad;
  END IF;

  -- INV-S10 (DB-level reinforcement; [APP] is the primary gate that
  -- proposes only non-expired partidas -- FASE 8): an EGRESO_PREPARACION
  -- cannot be booked against an already-expired partida.
  IF NEW.tipo = 'EGRESO_PREPARACION' THEN
    SELECT fecha_vencimiento INTO v_fecha_vencimiento
    FROM fsj.partida WHERE id = NEW.partida_id;

    IF v_fecha_vencimiento < current_date THEN
      RAISE EXCEPTION 'INV-S10: cannot register EGRESO_PREPARACION against expired partida % (fecha_vencimiento %)',
        NEW.partida_id, v_fecha_vencimiento
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM set_config('fsj.mov', 'on', true);

  UPDATE fsj.partida
  SET cantidad_disponible = cantidad_disponible + v_delta,
      -- INV-S16: first EGRESO_PREPARACION opens the partida. INV-S17
      -- (never changes again) is additionally enforced by
      -- trg_partida_validar_update, which this UPDATE also passes through.
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
  'INV-S01/S04, INV-S16/S17, INV-S10 (DB reinforcement), DP-21b. The CHECK constraints on fsj.partida (cantidad_disponible >= 0 AND <= cantidad_inicial -- INV-S02/S03) fire as part of this UPDATE and roll back the whole INSERT (and its transaction) on insufficient stock or an over-large ingreso.';

CREATE TRIGGER trg_movimiento_stock_aplicar
  AFTER INSERT ON fsj.movimiento_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.movimiento_stock_aplicar();

-- ============================================================================
-- INV-STK-002 [PROPUESTA]: every partida must have EXACTLY ONE
-- INGRESO_COMPRA movement, equal to cantidad_inicial, by commit time.
-- Deferred constraint trigger on partida, same pattern as INV-U02
-- (usuario_rol, migration 0002) -- the app is expected to INSERT the
-- partida (cantidad_disponible defaults to 0) and its INGRESO_COMPRA in
-- the same transaction; this is what makes that mandatory rather than a
-- convention.
-- ============================================================================
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

CREATE OR REPLACE FUNCTION fsj.trg_partida_check_ingreso_compra()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.partida_validar_ingreso_compra(NEW.tenant_id, NEW.id, NEW.cantidad_inicial);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_partida_ingreso_compra_obligatorio
  AFTER INSERT ON fsj.partida
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_partida_check_ingreso_compra();

-- ============================================================================
-- fsj.v_stock_droga: SUM of cantidad_disponible across NON-EXPIRED
-- partidas, per droga (plan §9 M06 "stockDisponible() = SUM(partidas no
-- vencidas)"). security_invoker = true so RLS is evaluated against the
-- CALLING role (fsj_app), not the view owner -- required for INV-T01 to
-- hold through the view (Postgres >= 15, which Supabase runs).
-- ============================================================================
CREATE OR REPLACE VIEW fsj.v_stock_droga
WITH (security_invoker = true) AS
SELECT
  d.tenant_id,
  d.id AS droga_id,
  coalesce(sum(p.cantidad_disponible) FILTER (WHERE p.fecha_vencimiento >= current_date), 0) AS stock_disponible
FROM fsj.droga d
LEFT JOIN fsj.partida p ON p.tenant_id = d.tenant_id AND p.droga_id = d.id
GROUP BY d.tenant_id, d.id;

COMMENT ON VIEW fsj.v_stock_droga IS
  'M06/M07. stock_disponible = SUM(partida.cantidad_disponible) over non-expired partidas only (fecha_vencimiento >= current_date). Do not sum in the application when this view exists (plan §9 M07 "NO HACER").';

GRANT SELECT ON fsj.v_stock_droga TO fsj_app;

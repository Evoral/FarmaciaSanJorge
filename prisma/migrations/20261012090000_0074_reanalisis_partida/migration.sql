-- 0074_reanalisis_partida
--
-- docs/specs/reanalisis-partida.md. A partida of a DROGA (droga.clase =
-- 'DROGA') whose expiry is reached can be re-analysed by the Director
-- Técnico (titular or suplente vigente): the analysis sets a new date, the
-- "fecha de reanálisis", from which the partida can be used again. The
-- original fecha_vencimiento is NEVER overwritten: every reanálisis is an
-- immutable, append-only row, and the partida's EFFECTIVE expiry (the
-- "vencimiento vigente") is the date of its latest reanálisis, else its
-- fecha_vencimiento. Insumos (clase <> 'DROGA') can not be re-analysed.
--
--   1. fsj.partida.fecha_vencimiento_vigente (date, NULL = does not expire,
--      same as fecha_vencimiento for an insumo, 0064): DENORMALIZED effective
--      expiry, written only by triggers (same pattern as cantidad_disponible,
--      0008): initialised from fecha_vencimiento on INSERT, moved by every
--      reanálisis INSERT. Backfilled = fecha_vencimiento. Every expiry check
--      reads it (INV-S10 here, v_stock_droga here, the app's SQL).
--   2. fsj.partida_validar_update (0008) now also rejects (INV-S23) any change
--      of fecha_vencimiento (the original date is a fact, never rewritten) and
--      any change of fecha_vencimiento_vigente that does not come from
--      fsj.reanalisis_partida_aplicar() (transaction-local flag
--      fsj.reanalisis = 'on', same mechanism as fsj.mov). The rest of the
--      0008 body is reproduced unchanged.
--   3. fsj.reanalisis_partida: tenant-scoped (fsj.setup_tenant_table: RLS
--      enabled + forced, tenant_isolation, forbid_tenant_id_change), fully
--      immutable (no UPDATE/DELETE grant + forbid_update_delete trigger).
--      fecha_vencimiento_anterior is set by the trigger (never from input):
--      the vigente date the reanálisis replaced, for the history.
--   4. trg_reanalisis_partida_validar (BEFORE INSERT, INV-S22): locks the
--      partida, then rejects unless the partida is of a DROGA, still has
--      saldo (saldo 0 is terminal: a partida "marcada como vencida" by its
--      VENCIMIENTO ajuste, or fully consumed, can never regain stock --
--      DP-21b), the date is strictly after fsj.jornada_actual(tenant) and
--      registrado_por_id is a DT vigente at that jornada (fsj.es_dt_vigente,
--      INV-U04/U05 -- the same rule the AJUSTE's autorizado_por_id meets).
--   5. trg_reanalisis_partida_aplicar (AFTER INSERT, SECURITY DEFINER): moves
--      partida.fecha_vencimiento_vigente to the new date.
--   6. fsj.movimiento_stock_aplicar (latest body: 0014) -- INV-S10 now reads
--      fecha_vencimiento_vigente. Body otherwise unchanged.
--   7. fsj.v_stock_droga (latest body: 0071) -- the non-expired filter now
--      reads fecha_vencimiento_vigente. Body otherwise unchanged.
--
-- Existing checks re-read: no other SQL object evaluates a partida's expiry
-- (grep of every migration for fecha_vencimiento: 0008/0014 INV-S10, 0025/
-- 0064/0071 v_stock_droga, 0064 trg_partida_validar_vencimiento -- INSERT
-- only, unchanged; preparacion.fecha_vencimiento is the preparado's own date,
-- unrelated).
--
-- Numbering: 0073 (20261008150000_0073_consumo_linea_en_unidad_base_droga)
-- is the highest at the time of writing -- re-check before applying.
--
-- *** APPLY 0074 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0074_reanalisis_partida.down.sql (as a NEW
-- forward migration) -- docs/rollbacks/reanalisis-partida.md.

-- ============================================================================
-- 1. partida.fecha_vencimiento_vigente + backfill (the backfill runs BEFORE
--    partida_validar_update starts guarding the column, below).
-- ============================================================================
ALTER TABLE fsj.partida ADD COLUMN IF NOT EXISTS fecha_vencimiento_vigente date;

UPDATE fsj.partida
SET fecha_vencimiento_vigente = fecha_vencimiento
WHERE fecha_vencimiento_vigente IS DISTINCT FROM fecha_vencimiento;

COMMENT ON COLUMN fsj.partida.fecha_vencimiento_vigente IS
  '0074. Effective expiry ("vencimiento vigente"): the fecha_reanalisis of the latest fsj.reanalisis_partida row, else fecha_vencimiento. NULL = does not expire (an insumo, 0064). Written ONLY by triggers (trg_partida_inicializar_vencimiento_vigente on INSERT, fsj.reanalisis_partida_aplicar on a reanálisis); INV-S23. Every expiry check (INV-S10, v_stock_droga, the app) reads this column, never fecha_vencimiento.';

COMMENT ON COLUMN fsj.partida.fecha_vencimiento IS
  '0064/0074. The ORIGINAL expiry printed on the lot. NULL = does not expire -- allowed only for an insumo (droga.clase <> DROGA, trg_partida_validar_vencimiento). Insert-only, never changes (INV-S23): a reanálisis moves fecha_vencimiento_vigente instead.';

-- ============================================================================
-- 1b. On INSERT, the vigente date IS the original one (whatever the client sent).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.partida_inicializar_vencimiento_vigente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.fecha_vencimiento_vigente := NEW.fecha_vencimiento;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.partida_inicializar_vencimiento_vigente() IS
  '0074. A new partida starts with fecha_vencimiento_vigente = fecha_vencimiento (never taken from the INSERT itself).';

DROP TRIGGER IF EXISTS trg_partida_inicializar_vencimiento_vigente ON fsj.partida;
CREATE TRIGGER trg_partida_inicializar_vencimiento_vigente
  BEFORE INSERT ON fsj.partida
  FOR EACH ROW EXECUTE FUNCTION fsj.partida_inicializar_vencimiento_vigente();

-- ============================================================================
-- 2. partida_validar_update (0008 body + INV-S23).
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

  -- INV-S23 (0074): the original expiry is never rewritten; the vigente one
  -- only moves through a reanálisis.
  IF NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento THEN
    RAISE EXCEPTION 'INV-S23: partida.fecha_vencimiento cannot change (a reanálisis is recorded in fsj.reanalisis_partida)'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.fecha_vencimiento_vigente IS DISTINCT FROM OLD.fecha_vencimiento_vigente
     AND coalesce(current_setting('fsj.reanalisis', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INV-S23: partida.fecha_vencimiento_vigente can only be changed by a reanalisis_partida insert'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.partida_validar_update() IS
  'INV-S01/S04, INV-S16/S17 (0008) and INV-S23 (0074): cantidad_disponible / fecha_apertura only through fsj.movimiento_stock_aplicar(), fecha_vencimiento never, fecha_vencimiento_vigente only through fsj.reanalisis_partida_aplicar().';

-- ============================================================================
-- 3. reanalisis_partida -- tenant-scoped, append-only.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.reanalisis_partida (
  id                          uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id                   uuid        NOT NULL,
  partida_id                  uuid        NOT NULL,
  -- The new vigente expiry ("fecha de reanálisis"), strictly after the jornada (INV-S22).
  fecha_reanalisis            date        NOT NULL,
  -- Set by trg_reanalisis_partida_validar from the partida (never from input).
  fecha_vencimiento_anterior  date        NOT NULL,
  motivo                      text,
  -- Certificado de análisis / número de protocolo (free text).
  respaldo                    text,
  -- The DT vigente who registered it (INV-S22, fsj.es_dt_vigente).
  registrado_por_id           uuid        NOT NULL,
  registrado_en               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT reanalisis_partida_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT reanalisis_partida_partida_fkey FOREIGN KEY (tenant_id, partida_id) REFERENCES fsj.partida (tenant_id, id),
  CONSTRAINT reanalisis_partida_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT reanalisis_partida_motivo_check CHECK (motivo IS NULL OR length(btrim(motivo)) > 0),
  CONSTRAINT reanalisis_partida_respaldo_check CHECK (respaldo IS NULL OR length(btrim(respaldo)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_reanalisis_partida_partida ON fsj.reanalisis_partida (tenant_id, partida_id, registrado_en);

COMMENT ON TABLE fsj.reanalisis_partida IS
  '0074 (docs/specs/reanalisis-partida.md). One row per reanálisis of a DROGA partida: the new vigente expiry (fecha_reanalisis), the one it replaced, motivo and respaldo, and the DT vigente who registered it. Immutable (INV-IMMUTABLE). Its AFTER INSERT trigger moves partida.fecha_vencimiento_vigente. fsj_app: SELECT/INSERT only.';

SELECT fsj.setup_tenant_table('fsj.reanalisis_partida');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.reanalisis_partida FROM fsj_app;

DROP TRIGGER IF EXISTS trg_reanalisis_partida_forbid_update_delete ON fsj.reanalisis_partida;
CREATE TRIGGER trg_reanalisis_partida_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.reanalisis_partida
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- ============================================================================
-- 4. INV-S22: who / which partida / which date.
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

DROP TRIGGER IF EXISTS trg_reanalisis_partida_validar ON fsj.reanalisis_partida;
CREATE TRIGGER trg_reanalisis_partida_validar
  BEFORE INSERT ON fsj.reanalisis_partida
  FOR EACH ROW EXECUTE FUNCTION fsj.reanalisis_partida_validar();

-- ============================================================================
-- 5. The ONLY writer of partida.fecha_vencimiento_vigente after its INSERT.
--    SECURITY DEFINER: fsj_app has no UPDATE grant on the column.
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

  PERFORM set_config('fsj.reanalisis', 'off', true);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.reanalisis_partida_aplicar() IS
  'INV-S23 (0074): moves partida.fecha_vencimiento_vigente to the reanálisis date, under the transaction-local flag fsj.reanalisis that fsj.partida_validar_update() requires.';

DROP TRIGGER IF EXISTS trg_reanalisis_partida_aplicar ON fsj.reanalisis_partida;
CREATE TRIGGER trg_reanalisis_partida_aplicar
  AFTER INSERT ON fsj.reanalisis_partida
  FOR EACH ROW EXECUTE FUNCTION fsj.reanalisis_partida_aplicar();

-- ============================================================================
-- 6. INV-S10 on the vigente date (latest body: migration 0014).
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

-- ============================================================================
-- 7. v_stock_droga on the vigente date (latest body: migration 0071).
-- ============================================================================
CREATE OR REPLACE VIEW fsj.v_stock_droga
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

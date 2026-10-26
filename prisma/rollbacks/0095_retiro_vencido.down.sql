-- Rollback of 0095_retiro_vencido (apply as a NEW forward migration), AFTER reverting the code
-- (docs/rollbacks/retiro-vencido.md) and BEFORE prisma/rollbacks/0094_estado_retiro_vencido.down.sql.
--
-- Restores INV-R08 as 0086 defined it and INV-ARC-006 as 0051 defined it, drops the preparada_en clock (trigger,
-- function, column) and the dias_retiro_vencido parametro rows.
--
-- Refused while a receta is in RETIRO_VENCIDO: the restored INV-R08 has no way out of that estado except ANULADA, so
-- those recetas must be moved back to PREPARADA first (see the rollback doc). preparada_en is NOT recoverable once
-- the column is dropped (the clock of the PREPARADA recetas goes with it).

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM fsj.receta WHERE estado = 'RETIRO_VENCIDO') THEN
    RAISE EXCEPTION '0095 rollback refused: recetas in RETIRO_VENCIDO exist (move them back to PREPARADA first, see docs/rollbacks/retiro-vencido.md)';
  END IF;
END $do$;

-- 1. The clock.
DROP TRIGGER IF EXISTS trg_receta_preparada_en ON fsj.receta;
DROP FUNCTION IF EXISTS fsj.receta_marcar_preparada_en();
ALTER TABLE fsj.receta DROP COLUMN IF EXISTS preparada_en;

-- 2. INV-R08 exactly as migration 0086 defined it.
CREATE OR REPLACE FUNCTION fsj.receta_validar_transicion_estado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = OLD.estado THEN
    RETURN NEW;
  END IF;

  -- 0086: an entrega registered by mistake is reverted. Only to PREPARADA, only once its entrega row was moved to
  -- fsj.entrega_anulada (same transaction), and never for an archived receta.
  IF OLD.estado IN ('ENTREGADA', 'ENVIADA_PEND_FIRMA') AND NEW.estado = 'PREPARADA' THEN
    IF EXISTS (SELECT 1 FROM fsj.entrega e WHERE e.tenant_id = NEW.tenant_id AND e.receta_id = NEW.id) THEN
      RAISE EXCEPTION 'INV-R08: receta % cannot go back to PREPARADA while it still has an entrega', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.lote_archivo_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-R08: receta % is in a lote de archivo: its entrega cannot be reverted', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.estado IN ('ENTREGADA', 'ANULADA') THEN
    RAISE EXCEPTION 'INV-R08: invalid receta state transition % -> % (% is terminal)', OLD.estado, NEW.estado, OLD.estado
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.estado = 'ANULADA' THEN
    -- Anulacion is reachable from any non-terminal state (spec section 1).
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.estado = 'PENDIENTE_PREPARACION' AND NEW.estado = 'EN_PREPARACION')
    OR (OLD.estado = 'EN_PREPARACION' AND NEW.estado = 'PREPARADA')
    OR (OLD.estado = 'PREPARADA' AND NEW.estado IN ('ENTREGADA', 'ENVIADA_PEND_FIRMA'))
    OR (OLD.estado = 'ENVIADA_PEND_FIRMA' AND NEW.estado = 'ENTREGADA')
  ) THEN
    RAISE EXCEPTION 'INV-R08: invalid receta state transition % -> %', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_transicion_estado() IS
  'INV-R08 + openspec/specs/libro-recetario-y-contralor/spec.md section 1. No backwards transitions, except (0086, openspec/specs/anular-entrega/spec.md) ENTREGADA/ENVIADA_PEND_FIRMA -> PREPARADA once the entrega was moved to fsj.entrega_anulada and the receta is not archived; ANULADA reachable from any non-terminal state; ENTREGADA (otherwise) and ANULADA terminal.';

-- 3. INV-ARC-006 / INV-ARC-007 exactly as migration 0051 defined it.
CREATE OR REPLACE FUNCTION fsj.receta_validar_archivo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lote_incluye_controladas boolean;
  v_receta_es_controlada     boolean;
BEGIN
  IF NEW.lote_archivo_id IS DISTINCT FROM OLD.lote_archivo_id AND NEW.lote_archivo_id IS NOT NULL THEN
    IF NEW.estado NOT IN ('ENTREGADA', 'ANULADA') THEN
      RAISE EXCEPTION 'INV-ARC-006: receta % can only be archived when ENTREGADA/ANULADA', NEW.id
        USING ERRCODE = 'P0001';
    END IF;

    -- INV-ARC-007 (migration 0042): the target lote must already reflect
    -- this receta's controlled/common nature.
    SELECT incluye_controladas INTO v_lote_incluye_controladas
    FROM fsj.lote_archivo_recetas
    WHERE tenant_id = NEW.tenant_id AND id = NEW.lote_archivo_id;

    SELECT EXISTS (
      SELECT 1
      FROM fsj.item_receta ir
      JOIN fsj.componente_item_receta c ON c.tenant_id = ir.tenant_id AND c.item_receta_id = ir.id
      JOIN fsj.droga d ON d.tenant_id = c.tenant_id AND d.id = c.droga_id
      WHERE ir.tenant_id = NEW.tenant_id AND ir.receta_id = NEW.id AND d.es_controlada = true
    ) INTO v_receta_es_controlada;

    IF v_receta_es_controlada AND NOT coalesce(v_lote_incluye_controladas, false) THEN
      RAISE EXCEPTION 'INV-ARC-007: receta % uses a controlled droga and cannot be assigned to lote % (incluye_controladas = false)', NEW.id, NEW.lote_archivo_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF OLD.lote_archivo_id IS NOT NULL AND NEW.lote_archivo_id IS DISTINCT FROM OLD.lote_archivo_id THEN
    RAISE EXCEPTION 'INV-ARC-006: receta.lote_archivo_id cannot change once set' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_archivo() IS
  'INV-ARC-006 (migrations 0016/0051) + INV-ARC-007 (migration 0042): lote_archivo_id is only settable once ENTREGADA/ANULADA (the receta fisica condition was dropped with the column, migration 0051), frozen once set, and a controlled receta can only join a lote with incluye_controladas = true.';

COMMENT ON COLUMN fsj.receta.lote_archivo_id IS
  'M15, deferred from migration 0011. INV-ARC-006: only settable (trg_receta_validar_archivo) when the receta is ENTREGADA or ANULADA; frozen once set.';

-- 4. The parametro rows (the registry entry goes with the code).
DELETE FROM fsj.parametro WHERE clave = 'dias_retiro_vencido';

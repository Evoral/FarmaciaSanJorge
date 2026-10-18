-- 0086_anular_entrega
--
-- docs/specs/anular-entrega.md (user decision 2026-10-17): the mostrador can revert an entrega registered by mistake
-- (wrong receta picked). The receta goes back from ENTREGADA / ENVIADA_PEND_FIRMA to PREPARADA and reappears in
-- /entregas; the right one is then delivered as usual.
--
-- Design: the entrega row is MOVED to a new insert-only history table, fsj.entrega_anulada (copy + motivo + who/when),
-- and deleted from fsj.entrega. fsj.entrega keeps "at most one entrega per receta" (entrega_receta_unica) and the
-- Prisma 1:1 Receta.entrega relation, so no reader of the entrega changes. Chosen over an "anulada" flag on
-- fsj.entrega, which would turn the unique into a partial one and the relation into a list everywhere.
--
--   1. fsj.entrega_anulada: insert-only (forbid_update_delete), tenant-scoped (RLS), SELECT/INSERT by default
--      privileges.
--   2. DELETE on fsj.entrega: granted to fsj_app, but trg_entrega_forbid_delete (0016) is replaced by a guard that
--      only lets a row go once its entrega_anulada copy exists (INV-ENT-004). Same "write the proof first, in the
--      same transaction" order as INV-ENT-002.
--   3. INV-R08 (latest definition: 0061): ENTREGADA / ENVIADA_PEND_FIRMA -> PREPARADA is now valid, and only that
--      backward move, only while the receta has no entrega row (it was moved in step 2 of the same transaction) and
--      is not in a lote de archivo. Every other rule of 0061 is unchanged.
--
-- The receta's payment is not touched here (INV-R13/INV-R14 unchanged): a PREPARADA receta may be unpaid, so the app
-- may clear the flag AFTER the estado UPDATE.
--
-- Numbering: 0085 (20261017120000_0085_unificar_permiso_entregas) is the highest at the time of writing.
-- *** APPLY 0086 BEFORE DEPLOYING THE CODE THAT USES IT. The previous code is unaffected by it. ***
-- Rollback: prisma/rollbacks/0086_anular_entrega.down.sql (as a NEW forward migration).

-- ============================================================================
-- 1. fsj.entrega_anulada
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.entrega_anulada (
  id                    uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  -- The deleted fsj.entrega row's id (no FK: that row is gone).
  entrega_id            uuid NOT NULL,
  receta_id             uuid NOT NULL,
  modalidad             fsj.modalidad_entrega NOT NULL,
  entregada_por_id      uuid NOT NULL,
  entregada_en          timestamptz NOT NULL,
  firma_recibida        boolean NOT NULL,
  firma_recibida_en     timestamptz,
  fecha_archivo_receta  date,
  motivo                text NOT NULL,
  anulada_por_id        uuid NOT NULL,
  anulada_en            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT entrega_anulada_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT entrega_anulada_entrega_unica UNIQUE (tenant_id, entrega_id),
  CONSTRAINT entrega_anulada_receta_fkey FOREIGN KEY (tenant_id, receta_id) REFERENCES fsj.receta (tenant_id, id),
  CONSTRAINT entrega_anulada_entregada_por_fkey FOREIGN KEY (tenant_id, entregada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT entrega_anulada_anulada_por_fkey FOREIGN KEY (tenant_id, anulada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT entrega_anulada_motivo_check CHECK (length(btrim(motivo)) > 0)
);

CREATE INDEX IF NOT EXISTS entrega_anulada_receta_idx ON fsj.entrega_anulada (tenant_id, receta_id);

COMMENT ON TABLE fsj.entrega_anulada IS
  '0086 (docs/specs/anular-entrega.md). History of entregas reverted by mistake: a copy of the fsj.entrega row plus motivo and who/when. Insert-only.';

SELECT fsj.setup_tenant_table('fsj.entrega_anulada');

CREATE TRIGGER trg_entrega_anulada_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.entrega_anulada
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- ============================================================================
-- 2. DELETE on fsj.entrega, only after its history copy (INV-ENT-004).
-- ============================================================================
DROP TRIGGER IF EXISTS trg_entrega_forbid_delete ON fsj.entrega;

CREATE OR REPLACE FUNCTION fsj.entrega_validar_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fsj.entrega_anulada ea WHERE ea.tenant_id = OLD.tenant_id AND ea.entrega_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'INV-ENT-004: entrega % can only be deleted once its fsj.entrega_anulada copy exists', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION fsj.entrega_validar_delete() IS
  'INV-ENT-004 (migration 0086, docs/specs/anular-entrega.md): an entrega row is deleted only by "anular entrega", which INSERTs its fsj.entrega_anulada copy first in the same transaction. Replaces 0016''s trg_entrega_forbid_delete.';

CREATE TRIGGER trg_entrega_validar_delete
  BEFORE DELETE ON fsj.entrega
  FOR EACH ROW EXECUTE FUNCTION fsj.entrega_validar_delete();

GRANT DELETE ON fsj.entrega TO fsj_app;

-- ============================================================================
-- 3. INV-R08: the one backward move, back to PREPARADA.
-- ============================================================================
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
  'INV-R08 + docs/specs/libro-recetario-y-contralor.md section 1. No backwards transitions, except (0086, docs/specs/anular-entrega.md) ENTREGADA/ENVIADA_PEND_FIRMA -> PREPARADA once the entrega was moved to fsj.entrega_anulada and the receta is not archived; ANULADA reachable from any non-terminal state; ENTREGADA (otherwise) and ANULADA terminal.';

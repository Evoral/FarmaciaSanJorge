-- Rollback of 0086_anular_entrega (apply as a NEW forward migration).
-- Restores 0061's INV-R08 (ENTREGADA terminal again), 0016's trg_entrega_forbid_delete and revokes DELETE on
-- fsj.entrega. fsj.entrega_anulada is KEPT on purpose: it is the only record of the entregas already reverted
-- (dropping it loses history). Recetas already reverted stay as they are now (PREPARADA, or delivered again).
-- The code must be reverted too (modules/entregas anular-entrega + its UI on /recetas/[id]).

REVOKE DELETE ON fsj.entrega FROM fsj_app;

DROP TRIGGER IF EXISTS trg_entrega_validar_delete ON fsj.entrega;
DROP FUNCTION IF EXISTS fsj.entrega_validar_delete();

CREATE TRIGGER trg_entrega_forbid_delete
  BEFORE DELETE ON fsj.entrega
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

CREATE OR REPLACE FUNCTION fsj.receta_validar_transicion_estado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = OLD.estado THEN
    RETURN NEW;
  END IF;

  IF OLD.estado IN ('ENTREGADA', 'ANULADA') THEN
    RAISE EXCEPTION 'INV-R08: invalid receta state transition % -> % (% is terminal)', OLD.estado, NEW.estado, OLD.estado
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.estado = 'ANULADA' THEN
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
  'INV-R08 + docs/specs/libro-recetario-y-contralor.md section 1. No backwards transitions; ANULADA reachable from any non-terminal state; ENTREGADA/ANULADA terminal. 0061: LISTA_PARA_RETIRAR removed -- PREPARADA goes straight to ENTREGADA or ENVIADA_PEND_FIRMA.';

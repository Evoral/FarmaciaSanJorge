-- 0050_receta_anulacion_libro_guard
--
-- New invariant INV-R12: a receta cannot become ANULADA while any of its
-- items has a CONFIRMADA preparacion whose SISTEMA asiento_recetario is
-- still in effect -- VIGENTE and not corrected by a RECTIFICATIVO, i.e. NOT
-- "sin efecto" under D2 REVISED (docs/specs/libro-recetario-y-contralor.md
-- §1). Otherwise the receta would say ANULADA while the legal libro still
-- records its preparacion. The legal path is to anular/rectificar the
-- asiento (DT co-signature); once every item is "sin efecto", D2's own
-- auto-anulacion (modules/libro/infrastructure/receta-coupling-repository.ts)
-- sets ANULADA -- which this trigger lets through, since by then no
-- asiento is in effect (the anulacion_asiento / RECTIFICATIVO insert
-- happens earlier in that same transaction).
--
-- DB backstop only, same posture as INV-R11 (migration 0030): the app
-- refuses first with a clear message (modules/recetas/application/anular-receta.ts,
-- modules/recetas/domain/anulacion.ts). The "sin efecto" condition below
-- must stay equal to receta-coupling-repository.ts's ASIENTO_SIN_EFECTO.
--
-- Deliberately NOT here: a preparacion still INICIADA also blocks a direct
-- anulacion in the app, but it is not an inconsistency of the libro yet
-- (no asiento exists), so it stays [APP].

CREATE OR REPLACE FUNCTION fsj.receta_validar_anulacion_libro()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'ANULADA' AND OLD.estado IS DISTINCT FROM 'ANULADA' AND EXISTS (
    SELECT 1
    FROM fsj.item_receta ir
    JOIN fsj.preparacion p ON p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado = 'CONFIRMADA'
    JOIN fsj.asiento_recetario a ON a.tenant_id = p.tenant_id AND a.preparacion_id = p.id AND a.origen = 'SISTEMA'
    WHERE ir.tenant_id = NEW.tenant_id AND ir.receta_id = NEW.id
      AND NOT (
        a.estado = 'ANULADO'
        OR EXISTS (SELECT 1 FROM fsj.asiento_recetario r WHERE r.tenant_id = a.tenant_id AND r.asiento_original_id = a.id)
      )
  ) THEN
    RAISE EXCEPTION 'INV-R12: receta % cannot be ANULADA while an asiento_recetario of its preparaciones is still in effect', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_anulacion_libro() IS
  'INV-R12 (new, migration 0050). No receta ANULADA while a CONFIRMADA preparacion''s SISTEMA asiento is in effect (VIGENTE, no RECTIFICATIVO). D2''s auto-anulacion passes because it only runs once every item is sin efecto.';

DROP TRIGGER IF EXISTS trg_receta_validar_anulacion_libro ON fsj.receta;
CREATE TRIGGER trg_receta_validar_anulacion_libro
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_anulacion_libro();

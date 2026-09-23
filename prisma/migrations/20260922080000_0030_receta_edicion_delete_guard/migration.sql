-- 0030_receta_edicion_delete_guard
--
-- FASE 6, point 6.3 (receta edition). Migration 0011's header flagged this
-- exact gap: "no DELETE grant is given ... a future UI for 'quitar
-- componente' will need a different mechanism ... since outright DELETE is
-- not granted." This migration closes that gap for item_receta and
-- componente_item_receta ONLY (never for receta itself, which stays
-- append/update-only per every other legal-adjacent table in this schema).
--
-- New invariant INV-R11: item_receta/componente_item_receta rows may only
-- be DELETEd while their receta is PENDIENTE_PREPARACION AND no
-- ficha_tecnica generated from any of the receta's items has a preparacion
-- yet. This mirrors the task's own binding decision for 6.3 ("editing
-- (including removing items/componentes) is only allowed while the receta
-- is PENDIENTE_PREPARACION and has no ficha tecnica with a preparacion").
--
-- Deliberately app-independent: this is a DB-level BACKSTOP (same posture
-- as every other invariant in this schema -- app validates first for a
-- clear Spanish message, DB is the real gate) so a bug in the application
-- layer can never delete a componente of a receta that is already being
-- prepared.
--
-- Scope note: this does NOT add an UPDATE guard -- receta/item_receta/
-- componente_item_receta UUPDATE grants already exist broadly (migration
-- 0011) and editability-while-PENDIENTE_PREPARACION for UPDATEs is an
-- [APP] concern enforced by modules/recetas/application/editar-receta.ts
-- (lock + fresh read + estado/ficha check), same division of labor as
-- every other "can this row still be edited" rule in this codebase (e.g.
-- modules/pacientes's fechaBaja check). Extending this to a DB-level UPDATE
-- trigger was considered and rejected: fsj.receta itself needs UPDATE from
-- OTHER states too (receta_fisica_recibida can be registered in any
-- non-terminal state per INV-R09, motivo_anulacion/estado transition to
-- ANULADA is reachable from any non-terminal state) -- a blanket
-- "UPDATE only while PENDIENTE_PREPARACION" trigger on fsj.receta would
-- break those. Item/componente row CONTENT edits (not add/remove) are left
-- as an [APP] concern for the same reason: over-restricting here would
-- require this migration to know about every future legitimate write path
-- to these tables, which is exactly what the DELETE-only backstop below
-- avoids by scoping itself to the one destructive operation being newly
-- granted.

CREATE OR REPLACE FUNCTION fsj.receta_assert_editable(p_tenant_id uuid, p_receta_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_estado           fsj.estado_receta;
  v_con_preparacion  boolean;
BEGIN
  SELECT estado INTO v_estado
  FROM fsj.receta
  WHERE tenant_id = p_tenant_id AND id = p_receta_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-R11: receta % not found', p_receta_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_estado <> 'PENDIENTE_PREPARACION' THEN
    RAISE EXCEPTION 'INV-R11: receta % is not editable (estado = %, must be PENDIENTE_PREPARACION)', p_receta_id, v_estado
      USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM fsj.ficha_tecnica ft
    JOIN fsj.item_receta ir ON ir.tenant_id = ft.tenant_id AND ir.id = ft.item_receta_id
    JOIN fsj.preparacion p ON p.tenant_id = ft.tenant_id AND p.ficha_tecnica_id = ft.id
    WHERE ft.tenant_id = p_tenant_id AND ir.receta_id = p_receta_id
  ) INTO v_con_preparacion;

  IF v_con_preparacion THEN
    RAISE EXCEPTION 'INV-R11: receta % is not editable (has a ficha tecnica with a preparacion)', p_receta_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION fsj.receta_assert_editable(uuid, uuid) IS
  'INV-R11 (new, migration 0030). Backstop for item_receta/componente_item_receta DELETEs: only while the receta is PENDIENTE_PREPARACION and none of its items has a ficha_tecnica with a preparacion.';

-- ============================================================================
-- item_receta DELETE guard
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.trg_item_receta_assert_editable_on_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.receta_assert_editable(OLD.tenant_id, OLD.receta_id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_item_receta_editable_on_delete ON fsj.item_receta;
CREATE TRIGGER trg_item_receta_editable_on_delete
  BEFORE DELETE ON fsj.item_receta
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_item_receta_assert_editable_on_delete();

GRANT DELETE ON fsj.item_receta TO fsj_app;

-- ============================================================================
-- componente_item_receta DELETE guard
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.trg_componente_assert_editable_on_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_receta_id uuid;
BEGIN
  SELECT receta_id INTO v_receta_id
  FROM fsj.item_receta
  WHERE tenant_id = OLD.tenant_id AND id = OLD.item_receta_id;

  IF v_receta_id IS NULL THEN
    -- Parent item_receta already gone (e.g. deleted earlier in the same
    -- transaction) -- nothing to gate against, let it proceed.
    RETURN OLD;
  END IF;

  PERFORM fsj.receta_assert_editable(OLD.tenant_id, v_receta_id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_componente_editable_on_delete ON fsj.componente_item_receta;
CREATE TRIGGER trg_componente_editable_on_delete
  BEFORE DELETE ON fsj.componente_item_receta
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_componente_assert_editable_on_delete();

GRANT DELETE ON fsj.componente_item_receta TO fsj_app;

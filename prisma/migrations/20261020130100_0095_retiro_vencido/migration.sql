-- 0095_retiro_vencido
--
-- docs/specs/retiro-vencido.md (user decision 2026-10-20). Needs 0094 (the RETIRO_VENCIDO enum value) already applied
-- and committed: a new enum value cannot be used in the transaction that adds it.
--
--   1. fsj.receta.preparada_en (timestamptz, NULLable): when the receta last ENTERED PREPARADA. The job that expires the
--      retiro (RV1) counts N days from it. Backfilled for the recetas that are PREPARADA now.
--   2. trg_receta_preparada_en: BEFORE UPDATE OF estado, sets preparada_en = now() every time the receta enters
--      PREPARADA (from EN_PREPARACION, from ENTREGADA / ENVIADA_PEND_FIRMA when an entrega is annulled -- 0086 -- and
--      from RETIRO_VENCIDO when it is reactivated), so the clock restarts in each case without depending on the app.
--   3. INV-R08 (fsj.receta_validar_transicion_estado, latest definition: 0086) re-created VERBATIM plus
--        PREPARADA -> RETIRO_VENCIDO, RETIRO_VENCIDO -> PREPARADA (never for an archived receta: RV4/RV7),
--        RETIRO_VENCIDO -> ANULADA (already covered by "ANULADA from any non-terminal state").
--      RETIRO_VENCIDO is NOT terminal.
--   4. INV-ARC-006 (fsj.receta_validar_archivo, latest definition: 0051) re-created VERBATIM plus RETIRO_VENCIDO as an
--      archivable estado (RV7). Once archived the receta can no longer be reactivated (point 3).
--   5. Parameter `dias_retiro_vencido` = '30' for every EXISTING tenant (same convention as 0038 / 0042 / 0068: ON
--      CONFLICT DO NOTHING). New tenants get it from scripts/create-tenant.ts. The app also falls back to 30 for a
--      tenant without the row.
--
-- Other triggers on fsj.receta re-read, none is affected:
--   - INV-ENT-002 (0040) only looks at NEW.estado = 'ENTREGADA'. INV-R12 (0050) only looks at 'ANULADA' (a
--     RETIRO_VENCIDO receta is annulled under the same libro guard as a PREPARADA one). INV-R14 (0076) only looks at
--     ENTREGADA. INV-R13 (0071) only looks at OLD.estado = 'ANULADA'. INV-R11 (0030/0072) is a function the app calls
--     to assert PENDIENTE_PREPARACION. INV-U07 (0023/0057/0071) only checks the NULL -> value transition of the actor
--     columns.
--   - The estado-dependent partial indexes and CHECK (uq_receta_emisor_nro_vigente, idx_receta_tenant_tomada_en_curso,
--     receta_anulada_motivo_check) compare against other values only: RETIRO_VENCIDO counts as "vigente" for the
--     emisor number uniqueness (it can be reactivated), exactly like PREPARADA.
--
-- preparada_en and privileges. fsj_app gets NO UPDATE grant on the column (the receta grants are per column, see
-- 0016/0057/0071): the only writer is trg_receta_preparada_en, and a BEFORE ROW trigger that assigns to NEW is not
-- subject to column privilege checks (PostgreSQL checks UPDATE privileges on the columns named in the statement's SET
-- list, not on columns a trigger changes). The function is not SECURITY DEFINER and reads no table. SELECT comes from
-- the default privileges (Phase 0). Result: the app cannot forge or move the clock; only an estado change into
-- PREPARADA restarts it.
--
-- Trigger order. BEFORE ROW triggers fire alphabetically: trg_receta_preparada_en runs before every
-- trg_receta_validar_* (INV-R08, INV-ENT-002, INV-R12, INV-R14) and trg_receta_zz_inv_u07_update. It is independent of
-- all of them (it only writes preparada_en, none of them reads it); if one of them rejects the UPDATE the whole
-- statement fails and the assignment is discarded with it.
--
-- INSERT: a receta is always created with the column default (PENDIENTE_PREPARACION) -- no code path inserts one
-- directly in PREPARADA -- so the trigger only covers UPDATE OF estado.
--
-- Numbering: 0094 (20261020130000_0094_estado_retiro_vencido) is the highest at the time of writing -- re-check before
-- applying.
--
-- *** APPLY 0094 AND 0095 BEFORE DEPLOYING THE CODE THAT USES THEM. The previous code is unaffected by them. ***
-- Rollback: prisma/rollbacks/0095_retiro_vencido.down.sql, then prisma/rollbacks/0094_estado_retiro_vencido.down.sql
-- (as NEW forward migrations; docs/rollbacks/retiro-vencido.md).

-- ============================================================================
-- 1. fsj.receta.preparada_en + backfill
-- ============================================================================
ALTER TABLE fsj.receta ADD COLUMN IF NOT EXISTS preparada_en timestamptz;

COMMENT ON COLUMN fsj.receta.preparada_en IS
  '0095 (docs/specs/retiro-vencido.md). When the receta last entered PREPARADA; written only by trg_receta_preparada_en. The retiro vencido job counts dias_retiro_vencido from it. NULL for a receta that has not reached PREPARADA. Backfilled for the recetas that were PREPARADA at migration time (latest preparacion.confirmada_en, else the migration date).';

-- Runs as the migration owner. Does not touch estado, so no BEFORE UPDATE OF estado trigger fires.
UPDATE fsj.receta r
SET preparada_en = COALESCE(
  (
    SELECT max(p.confirmada_en)
    FROM fsj.item_receta ir
    JOIN fsj.preparacion p ON p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id
    WHERE ir.tenant_id = r.tenant_id AND ir.receta_id = r.id AND p.estado = 'CONFIRMADA'
  ),
  now()
)
WHERE r.estado = 'PREPARADA' AND r.preparada_en IS NULL;

-- ============================================================================
-- 2. The clock: every entry into PREPARADA restarts it.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_marcar_preparada_en()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'PREPARADA' AND OLD.estado IS DISTINCT FROM 'PREPARADA' THEN
    NEW.preparada_en := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_marcar_preparada_en() IS
  '0095 (docs/specs/retiro-vencido.md). Sets receta.preparada_en = now() whenever the receta ENTERS PREPARADA (from EN_PREPARACION, from ENTREGADA/ENVIADA_PEND_FIRMA on "anular entrega", from RETIRO_VENCIDO on "reactivar"). Writes NEW only; needs no column grant for fsj_app.';

DROP TRIGGER IF EXISTS trg_receta_preparada_en ON fsj.receta;
CREATE TRIGGER trg_receta_preparada_en
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_marcar_preparada_en();

-- ============================================================================
-- 3. INV-R08 with RETIRO_VENCIDO.
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

  -- 0095: a receta whose retiro expired is reactivated back to PREPARADA, never once it is in a lote de archivo.
  IF OLD.estado = 'RETIRO_VENCIDO' AND NEW.estado = 'PREPARADA' THEN
    IF NEW.lote_archivo_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-R08: receta % is in a lote de archivo: it cannot be reactivated', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.estado IN ('ENTREGADA', 'ANULADA') THEN
    RAISE EXCEPTION 'INV-R08: invalid receta state transition % -> % (% is terminal)', OLD.estado, NEW.estado, OLD.estado
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.estado = 'ANULADA' THEN
    -- Anulacion is reachable from any non-terminal state (spec section 1), RETIRO_VENCIDO included.
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.estado = 'PENDIENTE_PREPARACION' AND NEW.estado = 'EN_PREPARACION')
    OR (OLD.estado = 'EN_PREPARACION' AND NEW.estado = 'PREPARADA')
    OR (OLD.estado = 'PREPARADA' AND NEW.estado IN ('ENTREGADA', 'ENVIADA_PEND_FIRMA', 'RETIRO_VENCIDO'))
    OR (OLD.estado = 'ENVIADA_PEND_FIRMA' AND NEW.estado = 'ENTREGADA')
  ) THEN
    RAISE EXCEPTION 'INV-R08: invalid receta state transition % -> %', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_transicion_estado() IS
  'INV-R08 + docs/specs/libro-recetario-y-contralor.md section 1. No backwards transitions, except (0086, docs/specs/anular-entrega.md) ENTREGADA/ENVIADA_PEND_FIRMA -> PREPARADA once the entrega was moved to fsj.entrega_anulada and the receta is not archived, and (0095, docs/specs/retiro-vencido.md) PREPARADA <-> RETIRO_VENCIDO (reactivar is refused for an archived receta); ANULADA reachable from any non-terminal state; ENTREGADA (otherwise) and ANULADA terminal.';

-- ============================================================================
-- 4. INV-ARC-006 / INV-ARC-007: RETIRO_VENCIDO is archivable.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_archivo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lote_incluye_controladas boolean;
  v_receta_es_controlada     boolean;
BEGIN
  IF NEW.lote_archivo_id IS DISTINCT FROM OLD.lote_archivo_id AND NEW.lote_archivo_id IS NOT NULL THEN
    IF NEW.estado NOT IN ('ENTREGADA', 'ANULADA', 'RETIRO_VENCIDO') THEN
      RAISE EXCEPTION 'INV-ARC-006: receta % can only be archived when ENTREGADA/ANULADA/RETIRO_VENCIDO', NEW.id
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
  'INV-ARC-006 (migrations 0016/0051/0095) + INV-ARC-007 (migration 0042): lote_archivo_id is only settable once ENTREGADA/ANULADA/RETIRO_VENCIDO (the receta fisica condition was dropped with the column, migration 0051; RETIRO_VENCIDO added by 0095), frozen once set, and a controlled receta can only join a lote with incluye_controladas = true.';

COMMENT ON COLUMN fsj.receta.lote_archivo_id IS
  'M15, deferred from migration 0011. INV-ARC-006: only settable (trg_receta_validar_archivo) when the receta is ENTREGADA, ANULADA or RETIRO_VENCIDO (0095); frozen once set.';

-- ============================================================================
-- 5. Parameter for every existing tenant
-- ============================================================================
INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
SELECT
  t.id,
  'dias_retiro_vencido',
  'NUMERO',
  '30',
  'Dias, desde que la receta queda preparada, tras los cuales un preparado que nadie retiro pasa a Retiro vencido; 0 desactiva el vencimiento -- docs/specs/retiro-vencido.md'
FROM fsj.tenant t
ON CONFLICT (tenant_id, clave) DO NOTHING;

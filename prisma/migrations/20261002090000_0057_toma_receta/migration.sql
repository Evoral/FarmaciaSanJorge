-- 0057_toma_receta
--
-- The lab's "toma" of a receta (/preparaciones, design "B"): taking a receta
-- from the Pendientes queue only records WHO took it and WHEN. It creates no
-- preparación and does not change the receta's estado, so a taken receta
-- that is still PENDIENTE_PREPARACION stays editable under the existing rule
-- (modules/recetas/domain/receta.ts#esEstadoEditable + INV-R11). The formal
-- preparación is still started per ítem by `preparaciones.iniciar`, which
-- moves the receta to EN_PREPARACION (INV-R08, unchanged). "Cancelar toma"
-- clears both columns again (only while no preparación is INICIADA -- an
-- app-level rule, modules/preparaciones/application/cancelar-toma.ts).
--
-- ADDITIVE: two nullable columns on fsj.receta, set together.
--
--   - tomada_por_id: composite FK (tenant_id, tomada_por_id) -> fsj.usuario,
--     same INV-T02 shape as receta_registrada_por_fkey (0011). MATCH SIMPLE,
--     so a NULL tomada_por_id is never checked.
--   - receta_toma_pair_check: both NULL or both set.
--   - Column-level UPDATE grant: fsj.receta's UPDATE privilege is granted
--     PER COLUMN (0011, 0016, 0049), so the new columns need their own grant
--     or the toma would fail with "permission denied".
--   - INV-U07 (0023): taking a receta is an action, so the actor must be
--     ACTIVO on the NULL -> value transition. fsj.assert_actor_activo is
--     generic (TG_ARGV), and 0051 dropped receta's old UPDATE trigger
--     (trg_receta_zz_inv_u07_update, receta_fisica_recibida_por_id), so the
--     name is free again. Created AFTER the backfill, so a historical starter
--     who was later suspended does not block it.
--
-- Existing receta triggers checked (latest definitions): the state machine
-- (0011 trg_receta_validar_transicion_estado), 0040's entrega check and
-- 0050's libro guard are all `BEFORE UPDATE OF estado` and 0016/0051's
-- archivo check is `BEFORE UPDATE OF lote_archivo_id`: none fires on an
-- UPDATE of the new columns alone, and none compares whole rows. The only
-- other BEFORE UPDATE trigger, forbid_tenant_id_change (0001), only looks at
-- tenant_id. RLS (tenant_isolation, 0011's setup_tenant_table) is
-- row-based and covers the new columns as-is. So both columns can be
-- written while the receta is PENDIENTE_PREPARACION or EN_PREPARACION.
--
-- Backfill: every non-terminal receta that already has a preparación
-- INICIADA gets the toma of its EARLIEST INICIADA preparación (who started
-- it, when). Runs as the migration owner, like 0042/0054's backfills. The
-- UPDATE only touches non-estado columns: no state-machine trigger fires,
-- and fsj.receta has no deferred trigger on UPDATE (trg_receta_tiene_item is
-- AFTER INSERT); SET CONSTRAINTS ALL IMMEDIATE is still issued before the
-- following DDL, defensively (55006 "pending trigger events", see 0054).
--
-- Partial index for the "En curso" list (taken, still in the lab), ordered
-- by tomada_en: limited to PENDIENTE_PREPARACION/EN_PREPARACION so finished
-- recetas (which keep their toma as history) do not grow it. The query
-- repeats the same predicate (preparacion-repository.ts#listRecetasEnCursoSql).
--
-- Numbering: 0055 (20261001120000_0055_paciente_recordatorios_whatsapp) is
-- the highest at the time of writing; the collaborator may add migrations in
-- parallel -- re-check the number and timestamp before applying.
--
-- *** APPLY 0057 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0057_toma_receta.down.sql (as a NEW forward
-- migration).

-- ============================================================================
-- 1. Columns, FK, pair CHECK, comments, grant.
-- ============================================================================
ALTER TABLE fsj.receta
  ADD COLUMN IF NOT EXISTS tomada_por_id uuid,
  ADD COLUMN IF NOT EXISTS tomada_en timestamptz;

ALTER TABLE fsj.receta
  ADD CONSTRAINT receta_tomada_por_fkey FOREIGN KEY (tenant_id, tomada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  ADD CONSTRAINT receta_toma_pair_check CHECK ((tomada_por_id IS NULL) = (tomada_en IS NULL));

COMMENT ON COLUMN fsj.receta.tomada_por_id IS
  '0057. Who took the receta from the /preparaciones queue (the lab''s "toma"). Set together with tomada_en (receta_toma_pair_check); cleared again by "Cancelar toma" while no preparación is INICIADA. Kept once the receta leaves the lab, as history.';

COMMENT ON COLUMN fsj.receta.tomada_en IS
  '0057. When the receta was taken (see tomada_por_id).';

GRANT UPDATE (tomada_por_id, tomada_en) ON fsj.receta TO fsj_app;

-- ============================================================================
-- 2. Index for the "En curso" list.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_receta_tenant_tomada_en_curso
  ON fsj.receta (tenant_id, tomada_en)
  WHERE tomada_por_id IS NOT NULL AND estado IN ('PENDIENTE_PREPARACION', 'EN_PREPARACION');

-- ============================================================================
-- 3. Backfill from the earliest INICIADA preparación of each receta.
-- ============================================================================
UPDATE fsj.receta r
SET tomada_por_id = primera.iniciada_por_id,
    tomada_en = primera.iniciada_en
FROM (
  SELECT DISTINCT ON (ir.tenant_id, ir.receta_id)
    ir.tenant_id,
    ir.receta_id,
    p.iniciada_por_id,
    p.iniciada_en
  FROM fsj.preparacion p
  JOIN fsj.item_receta ir ON ir.tenant_id = p.tenant_id AND ir.id = p.item_receta_id
  WHERE p.estado = 'INICIADA'
  ORDER BY ir.tenant_id, ir.receta_id, p.iniciada_en ASC, p.id ASC
) primera
WHERE r.tenant_id = primera.tenant_id
  AND r.id = primera.receta_id
  AND r.estado NOT IN ('ENTREGADA', 'ANULADA')
  AND r.tomada_por_id IS NULL;

SET CONSTRAINTS ALL IMMEDIATE;

-- ============================================================================
-- 4. INV-U07 on the toma (NULL -> value only, see 0023's header).
-- ============================================================================
DROP TRIGGER IF EXISTS trg_receta_zz_inv_u07_update ON fsj.receta;
CREATE TRIGGER trg_receta_zz_inv_u07_update
  BEFORE UPDATE ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('tomada_por_id');

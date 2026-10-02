-- Rollback of 0056_toma_receta. Prisma has no "down": apply this as the body
-- of a NEW forward migration (next free number).
--
-- DATA LOSS: dropping the columns discards who took each receta and when.
-- Taking and cancelling a toma are audited (fsj.registro_auditoria, entidad
-- "receta"), so the history remains there.

DROP TRIGGER IF EXISTS trg_receta_zz_inv_u07_update ON fsj.receta;

DROP INDEX IF EXISTS fsj.idx_receta_tenant_tomada_en_curso;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'fsj'
      AND table_name = 'receta'
      AND column_name = 'tomada_por_id'
  ) THEN
    REVOKE UPDATE (tomada_por_id, tomada_en) ON fsj.receta FROM fsj_app;
  END IF;
END
$$;

ALTER TABLE fsj.receta DROP CONSTRAINT IF EXISTS receta_toma_pair_check;
ALTER TABLE fsj.receta DROP CONSTRAINT IF EXISTS receta_tomada_por_fkey;

ALTER TABLE fsj.receta
  DROP COLUMN IF EXISTS tomada_por_id,
  DROP COLUMN IF EXISTS tomada_en;

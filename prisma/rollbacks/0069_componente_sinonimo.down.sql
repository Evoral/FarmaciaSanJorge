-- Rollback of 0069_componente_sinonimo. Apply as a NEW forward migration,
-- together with the code that no longer reads/writes droga_alias_id
-- (docs/rollbacks/sinonimos-droga.md). Apply it BEFORE 0067's down
-- migration (that one deletes removed synonyms this column may reference).
--
-- DATA LOSS: which synonym each receta componente was loaded with. The
-- componentes keep their droga; recetas show the canonical name again.

REVOKE UPDATE (droga_alias_id) ON fsj.componente_item_receta FROM fsj_app;
DROP INDEX IF EXISTS fsj.idx_componente_item_receta_droga_alias;
ALTER TABLE fsj.componente_item_receta DROP CONSTRAINT IF EXISTS componente_item_receta_droga_alias_fkey;
ALTER TABLE fsj.componente_item_receta DROP COLUMN IF EXISTS droga_alias_id;
ALTER TABLE fsj.droga_alias DROP CONSTRAINT IF EXISTS droga_alias_tenant_id_droga_key;

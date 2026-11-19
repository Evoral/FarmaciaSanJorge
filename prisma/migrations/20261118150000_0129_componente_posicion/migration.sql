-- 0129_componente_posicion
--
-- The componentes of a receta item come out (etiqueta Rp/, ficha técnica, receta views) in the order they were
-- loaded. fsj.componente_item_receta.posicion is that order, 0-based, written by the app from the form's rows on
-- every insert (alta, edición and import rewrite all of an item's componentes). There is no reorder control: to
-- change the order the receta is loaded again. Not the orden dropped by 0065 (no uniqueness, no CSP rule).
--
-- Rows written before this migration keep posicion NULL and are shown by the previous rule (cantidad first, then
-- CS, then CSP; ties by droga name), so no existing etiqueta changes and nothing is backfilled.
--
-- Rollback: prisma/rollbacks/0129_componente_posicion.down.sql (as a NEW forward migration).

ALTER TABLE fsj.componente_item_receta
  ADD COLUMN IF NOT EXISTS posicion smallint,
  ADD CONSTRAINT componente_item_receta_posicion_check CHECK (posicion IS NULL OR posicion >= 0);

COMMENT ON COLUMN fsj.componente_item_receta.posicion IS
  '0129. 0-based load order within the item (written by the app); NULL = loaded before 0129, shown by the old rule.';

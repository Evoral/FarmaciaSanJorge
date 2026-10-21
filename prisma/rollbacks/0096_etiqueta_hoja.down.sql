-- Rollback of 0096_etiqueta_hoja. Apply as a NEW forward migration, together
-- with the code that prints the etiqueta on a page of its own size again
-- (see docs/rollbacks/hoja-etiquetas.md). The configured sheet is lost; it is
-- re-seeded as A4 / 5 mm if 0096 is applied again.
DROP TABLE IF EXISTS fsj.etiqueta_hoja;

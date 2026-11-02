-- Rollback of 0114_parametro_lector_qr_receta (apply as a NEW forward migration).
-- Drops the lector_qr_receta parametro of every tenant. Revert the code first (docs/rollbacks/lector-qr-configurable.md):
-- the current code falls back to CAMARA without the row, but the Parámetros page could no longer save it.

DELETE FROM fsj.parametro WHERE clave = 'lector_qr_receta';

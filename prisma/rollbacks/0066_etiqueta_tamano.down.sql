-- Rollback of 0066_etiqueta_tamano. Apply as a NEW forward migration, together
-- with the code that prints etiquetas on the fixed 100 x 42 mm size again.
-- The configured sizes are lost.
DROP TABLE IF EXISTS fsj.etiqueta_tamano;

-- Rollback of 0063_clase_droga. Apply as a NEW forward migration.
-- DATA LOSS: every droga's clase.
REVOKE UPDATE (clase) ON fsj.droga FROM fsj_app;
ALTER TABLE fsj.droga DROP CONSTRAINT IF EXISTS droga_clase_no_controlada_check;
ALTER TABLE fsj.droga DROP COLUMN IF EXISTS clase;
DROP TYPE IF EXISTS fsj.clase_droga;

-- 0120 -- "Sugerir lote diluido" per droga (user decision 2026-11-04).
--
-- Some drogas are always weighed from a diluted lot for precision, even when the balance could weigh the dose. When
-- this flag is on, the pesada of a línea of the droga (confirmation form and toma workspace) shows "Sugerencia: usar
-- lote diluido para mayor precisión", with the droga's diluted lots and "Crear dilución" (stock.lote.elaborar), even
-- when the dose is not below one balance division. It is only a suggestion: nothing is refused.
--
--   1. fsj.droga.sugerir_dilucion: NOT NULL DEFAULT false, so every existing droga keeps today's behaviour.
--   2. fsj_app may UPDATE it (0007 grants UPDATE on fsj.droga column by column).
--
-- *** APPLY 0120 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0120_droga_sugerir_dilucion.down.sql (as a NEW forward migration).

ALTER TABLE fsj.droga ADD COLUMN IF NOT EXISTS sugerir_dilucion boolean NOT NULL DEFAULT false;

GRANT UPDATE (sugerir_dilucion) ON fsj.droga TO fsj_app;

COMMENT ON COLUMN fsj.droga.sugerir_dilucion IS
  '0120. The pesada always suggests a diluted lot of this droga (or creating one), even when the balance can weigh the dose. A suggestion only.';

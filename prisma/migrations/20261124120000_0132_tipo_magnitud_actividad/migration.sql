-- 0132_tipo_magnitud_actividad
--
-- Adds ACTIVIDAD to fsj.tipo_magnitud (DP-07 / openspec/changes/unidad-internacional).
-- Alone in its migration: Postgres does not allow using a newly added enum value
-- inside the same transaction that added it.
--
-- Rollback: prisma/rollbacks/0132_tipo_magnitud_actividad.down.sql.

ALTER TYPE fsj.tipo_magnitud ADD VALUE IF NOT EXISTS 'ACTIVIDAD';

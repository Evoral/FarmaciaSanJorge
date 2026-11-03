-- Rollback of 0116_paciente_dni_unico (apply as a NEW forward migration).
-- Drops the DNI unique index: the same DNI can be stored twice again. No data is lost.
-- The code must be reverted too (docs/rollbacks/paciente-dni-unico.md).

DROP INDEX IF EXISTS fsj.uq_paciente_dni;

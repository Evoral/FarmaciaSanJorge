-- Rollback of 20261125160000_0137_credencial_operador. Apply as a NEW forward migration, AFTER deploying the code that
-- no longer reads fsj.credencial_operador (docs/rollbacks/metodos-verificacion-operador.md). Reverse order of the
-- slices: this script first, then the 0136 one (no FK between the two tables).
--
-- What is lost: every enrolled code of an optional verification method (the huellas): the empleados must enrol again
-- if the feature is brought back. What is NOT lost: the PIN (fsj.usuario.pin_hash) and every audit row already written.

DROP TABLE IF EXISTS fsj.credencial_operador;

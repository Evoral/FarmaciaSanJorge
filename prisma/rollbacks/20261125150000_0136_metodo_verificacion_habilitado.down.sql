-- Rollback of 20261125150000_0136_metodo_verificacion_habilitado. Apply as a NEW forward migration, AFTER deploying the
-- code that no longer reads fsj.metodo_verificacion_habilitado (docs/rollbacks/metodos-verificacion-operador.md).
--
-- What is lost: which optional verification methods each farmacia had switched on. What is NOT lost: the PIN (never
-- stored here) and every audit row already written.

DROP TABLE IF EXISTS fsj.metodo_verificacion_habilitado;

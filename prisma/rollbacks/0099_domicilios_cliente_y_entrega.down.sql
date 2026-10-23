-- Rollback of 0099_domicilios_cliente_y_entrega (apply as a NEW forward migration).
-- Drops the cliente's domicilios and the receta's domicilio de entrega. Envíos go back to receta.domicilio_paciente;
-- a domicilio de entrega that differed from it is lost (copy it into domicilio_paciente first if it must survive).
-- The code must be reverted too (docs/rollbacks/domicilios.md).

REVOKE UPDATE (domicilio, domicilio_entrega) ON fsj.paciente FROM fsj_app;
REVOKE UPDATE (domicilio_entrega) ON fsj.receta FROM fsj_app;

ALTER TABLE fsj.paciente
  DROP COLUMN IF EXISTS domicilio,
  DROP COLUMN IF EXISTS domicilio_entrega;

ALTER TABLE fsj.receta
  DROP COLUMN IF EXISTS domicilio_entrega;

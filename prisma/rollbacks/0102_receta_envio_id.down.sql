-- Rollback of migration 0102: drops the alta idempotency key of fsj.receta.
-- Run only after the code that reads envio_id is gone (docs/rollbacks/alta-receta-idempotente.md).

DROP INDEX IF EXISTS fsj.uq_receta_envio;

ALTER TABLE fsj.receta DROP COLUMN IF EXISTS envio_id;

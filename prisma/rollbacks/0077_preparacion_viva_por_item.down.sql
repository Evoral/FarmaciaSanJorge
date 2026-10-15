-- Rollback of 0077_preparacion_viva_por_item. Apply as a NEW forward migration.
-- No data is lost: only the partial unique index goes; the app keeps its own
-- per-item check under locks (iniciarPreparacionEnTx).

DROP INDEX IF EXISTS fsj.uq_preparacion_item_viva;

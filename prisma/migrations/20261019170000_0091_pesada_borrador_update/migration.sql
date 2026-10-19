-- 0091 -- fsj_app may update a pesada en borrador (fix of 0090).
--
-- 0090 relied on the default privileges, which grant SELECT/INSERT only (0000, on purpose). Saving a draft is an
-- upsert (INSERT ... ON CONFLICT DO UPDATE), which needs UPDATE: every save failed with 42501. Only the draft's own
-- fields are granted; tenant_id and linea_pesaje_id stay fixed. No DELETE: a draft is never removed by the app.
-- Rollback: prisma/rollbacks/0091_pesada_borrador_update.down.sql (as a NEW forward migration).

GRANT UPDATE (partida_ids, cantidad_real, cantidad_manual, motivo_apertura_adicional, actualizado_por_id, actualizado_en)
  ON fsj.pesada_borrador TO fsj_app;

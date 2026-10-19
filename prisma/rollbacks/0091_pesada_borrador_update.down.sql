-- Rollback of 0091_pesada_borrador_update (apply as a NEW forward migration). Saving a draft fails again (42501);
-- only meaningful together with reverting 0090 (prisma/rollbacks/0090_pesada_borrador.down.sql drops the table anyway).

REVOKE UPDATE ON fsj.pesada_borrador FROM fsj_app;

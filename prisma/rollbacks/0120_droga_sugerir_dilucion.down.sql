-- Rollback of 0120_droga_sugerir_dilucion (apply as a NEW forward migration). The code must be reverted too.
-- Drops the per-droga "sugerir lote diluido" flag; the dilución is offered again only below the balance.

REVOKE UPDATE (sugerir_dilucion) ON fsj.droga FROM fsj_app;
ALTER TABLE fsj.droga DROP COLUMN IF EXISTS sugerir_dilucion;

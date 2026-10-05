-- 0059_quitar_droga_requiere_correccion_potencia
--
-- Drops fsj.droga.requiere_correccion_potencia (added by 0058). Purity is a
-- property of the LOT only: partida.potencia_declarada stays, always
-- optional (NULL = 100%). A per-droga "purity required" flag was judged
-- unnecessary for now; the flag was never enforced by the database, so no
-- trigger or constraint depends on it.
--
-- 0058 is already applied, so it is NOT edited (checksum); this migration
-- reverts only its droga part. partida.potencia_declarada and
-- movimiento_stock.potencia_aplicada are untouched.
--
-- DATA LOSS: every droga's flag value (no app code reads it any more).
--
-- *** APPLY 0059 BEFORE DEPLOYING THE CODE THAT NO LONGER SELECTS THE COLUMN
-- (Prisma would otherwise still reference it). ***
-- Rollback: prisma/rollbacks/0059_quitar_droga_requiere_correccion_potencia.down.sql
-- (as a NEW forward migration).

REVOKE UPDATE (requiere_correccion_potencia) ON fsj.droga FROM fsj_app;

ALTER TABLE fsj.droga DROP COLUMN IF EXISTS requiere_correccion_potencia;

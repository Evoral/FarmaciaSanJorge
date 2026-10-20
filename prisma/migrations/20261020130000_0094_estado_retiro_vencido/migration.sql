-- 0094_estado_retiro_vencido
--
-- docs/specs/retiro-vencido.md (user decision 2026-10-20): a PREPARADA receta that nobody picks up moves on its own,
-- after N days, to a new estado RETIRO_VENCIDO (reversible: it can be reactivated back to PREPARADA).
--
-- This migration ONLY adds the enum value. Postgres does not let a new enum value be USED (compared, inserted,
-- referenced by a trigger function that runs) in the same transaction that adds it, and Prisma runs each migration
-- file in its own transaction. Everything that uses RETIRO_VENCIDO (the preparada_en column, INV-R08, INV-ARC-006, the
-- parameter) lives in 0095.
--
-- Numbering: 0093 (20261020120000_0093_repartidores_envio) is the highest at the time of writing -- re-check before
-- applying.
--
-- *** APPLY 0094 AND 0095 BEFORE DEPLOYING THE CODE THAT USES THEM. The previous code is unaffected by them: it never
-- reads or writes RETIRO_VENCIDO / preparada_en. ***
-- Rollback: prisma/rollbacks/0094_estado_retiro_vencido.down.sql (as a NEW forward migration, AFTER
-- 0095_retiro_vencido.down.sql; docs/rollbacks/retiro-vencido.md).

ALTER TYPE fsj.estado_receta ADD VALUE IF NOT EXISTS 'RETIRO_VENCIDO';

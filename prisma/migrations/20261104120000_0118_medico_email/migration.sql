-- 0118 -- The médico's email (user decision 2026-11-04, deuda "datos de médico").
--
--   1. fsj.medico.email: optional text, like telefono and direccion_registrada. Existing rows read NULL.
--   2. fsj_app may UPDATE it (0007 grants UPDATE column by column).
--
-- The receta import fills it from the RCTA "Lugar de atención" ("<email>/<teléfono>"), in the PDF's footer and in the
-- QR link's JSON.
--
-- *** APPLY 0118 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0118_medico_email.down.sql (as a NEW forward migration).

ALTER TABLE fsj.medico ADD COLUMN IF NOT EXISTS email text;

GRANT UPDATE (email) ON fsj.medico TO fsj_app;

COMMENT ON COLUMN fsj.medico.email IS
  '0118. Optional contact email; the receta import fills it from the RCTA "Lugar de atención".';

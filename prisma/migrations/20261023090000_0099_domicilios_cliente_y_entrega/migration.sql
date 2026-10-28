-- 0099_domicilios_cliente_y_entrega
--
-- User decision (2026-10-23, docs/specs/domicilios.md): two domicilios, the one written on the receta and the one the
-- envío goes to. When only one is loaded it is used for both.
--
--   - fsj.paciente.domicilio: the cliente's domicilio. Edited from its ficha, and updated automatically when an
--     imported receta (QR / PDF) brings one. A domicilio typed by hand on a receta never changes it.
--   - fsj.paciente.domicilio_entrega: where the cliente wants the envíos. Edited from its ficha only. NULL = same as
--     domicilio.
--   - fsj.receta.domicilio_entrega: the envío address of THIS receta. NULL = same as domicilio_paciente (0070).
--     Prefilled from the cliente; the entrega modal writes here (no longer into domicilio_paciente, which keeps the
--     address as written on the receta).
--
-- Free text, optional; the app trims it, stores '' as NULL and caps its length (MAX_DOMICILIO_PACIENTE, 300), same
-- as 0070. Not part of the libro recetario asiento or its hash.
--
-- GRANT: table-level SELECT/INSERT come from ALTER DEFAULT PRIVILEGES (0000); UPDATE is granted PER COLUMN on both
-- tables (0007/0029/0055 for paciente, 0011/0070 for receta), so each new column gets its own UPDATE grant. No
-- trigger on either table restricts these columns (same check as 0070's header).
--
-- Additive: old code ignores the columns.
-- Rollback: prisma/rollbacks/0099_domicilios_cliente_y_entrega.down.sql (as a NEW forward migration),
-- docs/rollbacks/domicilios.md.

ALTER TABLE fsj.paciente
  ADD COLUMN IF NOT EXISTS domicilio text,
  ADD COLUMN IF NOT EXISTS domicilio_entrega text;

ALTER TABLE fsj.receta
  ADD COLUMN IF NOT EXISTS domicilio_entrega text;

COMMENT ON COLUMN fsj.paciente.domicilio IS
  '0099. The cliente''s domicilio (free text, optional). Edited from its ficha; updated automatically by an imported receta (QR / PDF) that brings one.';
COMMENT ON COLUMN fsj.paciente.domicilio_entrega IS
  '0099. Where the cliente wants the envíos (free text, optional, ficha only). NULL = same as domicilio.';
COMMENT ON COLUMN fsj.receta.domicilio_entrega IS
  '0099. Envío address of this receta (free text, optional). NULL = same as domicilio_paciente. Written by the receta form and by the entrega modal.';

GRANT UPDATE (domicilio, domicilio_entrega) ON fsj.paciente TO fsj_app;
GRANT UPDATE (domicilio_entrega) ON fsj.receta TO fsj_app;

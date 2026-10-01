-- 0055_paciente_recordatorios_whatsapp
--
-- Consent flag for WhatsApp reminders (docs/specs/pacientes-recurrentes.md,
-- "Consent (DB change)"). The "Recurrentes" view lets staff open WhatsApp
-- with a prefilled "se acerca la fecha de tu preparado" message for patients
-- who periodically order the same preparation; the link is only offered when
-- the patient has accepted these reminders. Contact for a marketing-like
-- purpose needs an explicit, recorded opt-in (Ley 25.326, DP-24: paciente is
-- health-adjacent data), so existing patients default to NO consent.
--
-- ADDITIVE ONLY: one new NOT NULL column with a constant DEFAULT (false), so
-- no row rewrite is needed beyond the catalog change and existing rows read
-- as "no consent". Rollback is
-- `prisma/rollbacks/0055_paciente_recordatorios_whatsapp.down.sql` (applied
-- as a NEW forward migration, since prisma migrate has no "down"; full steps
-- in docs/rollbacks/pacientes-recurrentes.md).
--
-- *** APPLY 0055 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- This migration is not applied anywhere yet. Once the new code is live, every
-- query that selects or writes `paciente.acepta_recordatorios_whatsapp` fails
-- with "column does not exist" on a database without it:
--   - NOT affected: the `/pacientes` list (explicit select without the column).
--   - Affected: `/pacientes/[id]`, create and edit paciente (they read the row
--     through getPacienteParaAccion, also used by baja/reactivación),
--     `/pacientes/recurrentes`, and EVERY `paciente.create` -- including the
--     receta quick-create and the PDF import -- because Prisma sends the
--     defaulted column in the INSERT.
--
-- Numbering: this repository already has its own
-- 20261001100000_0051_trayectoria_paciente_indices. Another developer's
-- migrations (not in this repository) are 20261001090000_0051_drop_receta_fisica
-- and 0052_regla_precio_tramos, 0053 and 0054 (the last one is
-- 20261001110100_0054). 0055 is the next free number after those, and its
-- timestamp sorts after theirs.
--
-- GRANT: fsj_app already has table-level SELECT and INSERT on every fsj
-- table through ALTER DEFAULT PRIVILEGES (migration 0000), so the new column
-- is readable and insertable as-is. UPDATE is granted PER COLUMN on
-- fsj.paciente (migrations 0007 and 0029), so the new column needs its own
-- column-level UPDATE grant or editing the consent would fail with "permission
-- denied". Same shape as 0029's `GRANT UPDATE (motivo_baja)`.

ALTER TABLE fsj.paciente
  ADD COLUMN IF NOT EXISTS acepta_recordatorios_whatsapp boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fsj.paciente.acepta_recordatorios_whatsapp IS
  'Pacientes recurrentes (0055). The patient accepted to be contacted through WhatsApp for reminders about their recurring preparations. Defaults to false: no consent is assumed for existing patients. Edited through the regular paciente form (audited in registro_auditoria like every other paciente field, DP-24 / Ley 25.326).';

GRANT UPDATE (acepta_recordatorios_whatsapp) ON fsj.paciente TO fsj_app;

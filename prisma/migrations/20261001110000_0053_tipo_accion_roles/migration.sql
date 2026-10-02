-- 0053_tipo_accion_roles
--
-- DP-03 RESUELTA (2026-10-01, see docs/plan-implementacion.md and
-- docs/specs/roles-personalizables.md): roles become per-tenant and
-- editable by an ADMINISTRADOR, audited. This migration ONLY adds the three
-- new audit actions those writes record (modules/usuarios/application/
-- crear-rol.ts, editar-rol.ts, eliminar-rol.ts). It MUST stay alone:
-- Postgres forbids using a newly-added enum value in the SAME transaction
-- that added it, and Prisma runs each migration.sql in its own transaction
-- (same constraint as migrations 0036/0045). The schema change itself is
-- migration 0054.
ALTER TYPE fsj.tipo_accion ADD VALUE IF NOT EXISTS 'CREAR_ROL';
ALTER TYPE fsj.tipo_accion ADD VALUE IF NOT EXISTS 'EDITAR_ROL';
ALTER TYPE fsj.tipo_accion ADD VALUE IF NOT EXISTS 'ELIMINAR_ROL';

-- 0000_platform_roles
--
-- FASE 0 platform migration: extensions, the dedicated `fsj` schema, the
-- runtime role `fsj_app`, and the generic helper functions/triggers that
-- every future business table will use (INV-T03, INV-IMMUTABLE). No
-- business tables are created here -- those start in FASE 1.
--
-- Idempotent by design: every statement can be re-run against a database
-- that already has some or all of this applied. Note: there is only one
-- Supabase database (no separate test project) -- tests/db/global-setup.ts
-- deliberately never runs `prisma migrate reset` or any other migration
-- command against it; DB tests only verify migrations are applied and rely
-- on tests/db/helpers.ts#inRollbackTx to leave the database untouched.
--
-- Error convention used throughout this codebase (see shared/errors):
--   RAISE EXCEPTION 'INV-XXX: human readable message' USING ERRCODE = 'P0001';
-- `shared/errors/index.ts#mapDbError` looks for the `INV-XXX` token in the
-- error message and turns it into an `InvariantViolationError`.

-- ============================================================================
-- Extensions
-- ============================================================================
-- On Supabase, extensions are installed into the `extensions` schema, not
-- `public` (Supabase convention: keeps `public`/`fsj` free of extension
-- objects). This means `fsj_app` needs USAGE on `extensions` too (granted
-- below) for functions like `gen_random_uuid()` to resolve, unless
-- `extensions` is already on every role's default search_path (it is, on
-- Supabase, for the built-in roles -- but not for a role we create
-- ourselves, so we set fsj_app's search_path explicitly in
-- scripts/db-bootstrap.ts: `fsj, extensions`).
CREATE EXTENSION IF NOT EXISTS pgcrypto   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ============================================================================
-- Schema
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS fsj;

COMMENT ON SCHEMA fsj IS
  'Farmacia San Jose application schema. Not exposed via Supabase Data API/PostgREST -- see docs/architecture.md.';

-- ============================================================================
-- Roles
-- ============================================================================
-- fsj_app: runtime role used by the app (DATABASE_URL, via the Supabase
-- pooler). NOLOGIN here on purpose -- LOGIN + the actual password are set
-- by scripts/db-bootstrap.ts (ALTER ROLE ... WITH LOGIN PASSWORD ...) so
-- the password never appears in a migration file or in git history.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsj_app') THEN
    CREATE ROLE fsj_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Idempotent even if the role already existed with different flags
-- (e.g. re-running this migration after a manual change).
ALTER ROLE fsj_app NOBYPASSRLS;

-- ============================================================================
-- Schema-level privileges
-- ============================================================================
-- Revoke from PUBLIC unconditionally (PUBLIC always exists as a pseudo-role).
REVOKE ALL ON SCHEMA fsj FROM PUBLIC;

-- `anon` and `authenticated` are Supabase Auth roles. They exist on every
-- real Supabase project but may not exist on a bare/test Postgres instance,
-- so guard each revoke with an existence check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA fsj FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA fsj FROM authenticated;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA fsj TO fsj_app;

-- fsj_app needs to resolve functions like gen_random_uuid() from the
-- extensions schema (see the Extensions comment above).
GRANT USAGE ON SCHEMA extensions TO fsj_app;

-- ============================================================================
-- Default privileges for future tables
-- ============================================================================
-- Deliberately SELECT/INSERT only. UPDATE/DELETE are granted per table in
-- FASE 1, and NEVER for legal/immutable tables (INV-X01) -- that asymmetry
-- is the point: forgetting to grant UPDATE/DELETE is the safe failure mode,
-- not the dangerous one.
ALTER DEFAULT PRIVILEGES IN SCHEMA fsj
  GRANT SELECT, INSERT ON TABLES TO fsj_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA fsj
  GRANT USAGE, SELECT ON SEQUENCES TO fsj_app;

-- ============================================================================
-- Helper: current tenant id
-- ============================================================================
-- Returns NULL when app.tenant_id was never set in this transaction
-- (rather than raising), so callers/policies can decide what "no tenant"
-- means in context. `withTenantTransaction` (shared/db/transaction.ts) is
-- the only place that sets it, via `set_config('app.tenant_id', $1, true)`.
CREATE OR REPLACE FUNCTION fsj.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION fsj.current_tenant_id() IS
  'Returns the tenant id set via set_config(''app.tenant_id'', ..., true) for the current transaction, or NULL if unset. Used by RLS policies (INV-T01).';

GRANT EXECUTE ON FUNCTION fsj.current_tenant_id() TO fsj_app;

-- ============================================================================
-- Generic trigger: forbid tenant_id change (INV-T03)
-- ============================================================================
-- Attached per-table in FASE 1 to every business table:
--   CREATE TRIGGER trg_<table>_forbid_tenant_id_change
--     BEFORE UPDATE ON fsj.<table>
--     FOR EACH ROW EXECUTE FUNCTION fsj.forbid_tenant_id_change();
CREATE OR REPLACE FUNCTION fsj.forbid_tenant_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'INV-T03: tenant_id cannot be changed on table %', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.forbid_tenant_id_change() IS
  'Generic BEFORE UPDATE trigger enforcing INV-T03 (tenant_id is immutable). Attach to every business table.';

-- ============================================================================
-- Generic trigger: forbid UPDATE/DELETE (legal/immutable tables)
-- ============================================================================
-- For tables that must never be modified or deleted after insert (e.g. the
-- libro recetario ledger, audit log -- INV-A02/A03, INV-X01). Attach as:
--   CREATE TRIGGER trg_<table>_forbid_update_delete
--     BEFORE UPDATE OR DELETE ON fsj.<table>
--     FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();
CREATE OR REPLACE FUNCTION fsj.forbid_update_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'INV-IMMUTABLE: table % is immutable, % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$;

COMMENT ON FUNCTION fsj.forbid_update_delete() IS
  'Generic BEFORE UPDATE OR DELETE trigger for immutable/legal tables (INV-X01). Attach where rows must never change after insert.';

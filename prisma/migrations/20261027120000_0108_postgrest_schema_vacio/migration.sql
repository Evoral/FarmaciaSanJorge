-- 0108_postgrest_schema_vacio
--
-- The app never uses Supabase's Data API (PostgREST): it reaches Postgres only through Prisma, and `fsj` is never
-- exposed (docs/architecture.md). With the Data API disabled, Supabase keeps PostgREST running with
-- db-schemas = pg_pgrst_no_exposed_schemas, a schema that does not exist, so PostgREST fails to load its schema
-- cache and retries every ~30 s, flooding postgrest_logs and postgres_logs with
-- `schema "pg_pgrst_no_exposed_schemas" does not exist` (SQLSTATE 3F000). Harmless, but it buries real errors.
--
-- Supabase's documented workaround (guides/troubleshooting/schema-pg_pgrst_no_exposed_schemas-does-not-exist):
-- point PostgREST at an EMPTY schema through the authenticator role's in-database config. PostgREST then loads an
-- empty cache and exposes nothing.
--
-- Side effect: the dashboard's Data API > Exposed schemas setting no longer applies (the role setting overrides it).
-- Re-enabling the Data API needs the rollback first. Nothing may ever be created in pgrst_no_exposed_schemas.
--
-- Code-independent. Rollback: prisma/rollbacks/0108_postgrest_schema_vacio.down.sql.

CREATE SCHEMA IF NOT EXISTS pgrst_no_exposed_schemas;

REVOKE ALL ON SCHEMA pgrst_no_exposed_schemas FROM PUBLIC;

COMMENT ON SCHEMA pgrst_no_exposed_schemas IS
  'Intentionally empty: the only schema PostgREST exposes, so the disabled Data API stops logging pg_pgrst_no_exposed_schemas errors (migration 0108). Never create objects here.';

ALTER ROLE authenticator SET pgrst.db_schemas = 'pgrst_no_exposed_schemas';

-- Delivered on commit: PostgREST reloads its config and schema cache.
NOTIFY pgrst;

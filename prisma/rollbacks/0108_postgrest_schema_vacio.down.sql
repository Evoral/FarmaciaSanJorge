-- Rollback of 0108_postgrest_schema_vacio (apply as a NEW forward migration).
-- Gives db-schemas back to the dashboard's Data API setting. With the Data API still disabled, the
-- `schema "pg_pgrst_no_exposed_schemas" does not exist` log noise comes back. Required BEFORE re-enabling the
-- Data API; even then, never add `fsj` to Exposed schemas (docs/architecture.md).

ALTER ROLE authenticator RESET pgrst.db_schemas;

NOTIFY pgrst;

-- After the reset, so PostgREST never points at a dropped schema. RESTRICT: refuses if someone put objects in it.
DROP SCHEMA IF EXISTS pgrst_no_exposed_schemas RESTRICT;

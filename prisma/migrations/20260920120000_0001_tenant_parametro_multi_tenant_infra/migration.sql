-- 0001_tenant_parametro_multi_tenant_infra
--
-- FASE 1, point 1.1: the `tenant` (global) and `parametro` (tenant-scoped)
-- tables, plus the generic multi-tenant helper that every future business
-- table calls to get RLS + the INV-T03 trigger in one shot
-- (`fsj.setup_tenant_table`). Extends the Phase 0 helpers
-- (`fsj.current_tenant_id()`, `fsj.forbid_tenant_id_change()`,
-- `fsj.forbid_update_delete()`) instead of duplicating them -- this
-- migration only ADDS `fsj.forbid_delete()` (DELETE-only immutability,
-- needed by tables such as `usuario` that must stay editable but never
-- deletable -- INV-U03) and `fsj.setup_tenant_table()`.
--
-- Idempotent by design (CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE /
-- guarded DDL), like 0000_platform_roles. See that file's header for the
-- "single real database, tests always roll back" context that applies to
-- every migration in this project.
--
-- Error convention: RAISE EXCEPTION 'INV-XXX: message' USING ERRCODE = 'P0001'.

-- ============================================================================
-- Generic trigger: forbid DELETE only (complements forbid_update_delete)
-- ============================================================================
-- Unlike `fsj.forbid_update_delete()` (Phase 0 -- blocks BOTH UPDATE and
-- DELETE, for fully immutable/legal tables), this one blocks ONLY DELETE.
-- Needed by tables that must remain editable (state changes, corrections)
-- but must never lose a row -- e.g. `usuario` (INV-U03).
CREATE OR REPLACE FUNCTION fsj.forbid_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'INV-IMMUTABLE: table % rows cannot be deleted', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

COMMENT ON FUNCTION fsj.forbid_delete() IS
  'Generic BEFORE DELETE trigger for tables that are editable but never deletable (e.g. usuario, INV-U03). Attach where rows must persist forever once inserted, even though UPDATE remains allowed.';

-- ============================================================================
-- Helper: fsj.setup_tenant_table(regclass)
-- ============================================================================
-- Applies the standard multi-tenant guarantees to an already-created
-- business table in one call: RLS enabled AND forced, a policy that keys
-- off fsj.current_tenant_id() (INV-T01), and the INV-T03
-- forbid_tenant_id_change trigger. Idempotent (drops the policy/trigger
-- first, so re-running a migration is safe).
--
-- What it deliberately does NOT do (must be declared by the caller's own
-- CREATE TABLE, since column definitions can't be templated generically in
-- plain SQL):
--   - `tenant_id uuid NOT NULL`
--   - `UNIQUE (tenant_id, id)` -- only needed on tables that have a
--     surrogate `id` PK referenced by children (INV-T02 composite FKs);
--     skip it on tables without one (e.g. `parametro`, keyed by
--     `(tenant_id, clave)`).
--
-- Usage (per business table, right after its CREATE TABLE):
--   SELECT fsj.setup_tenant_table('fsj.<table_name>');
CREATE OR REPLACE FUNCTION fsj.setup_tenant_table(p_table regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_table text;
BEGIN
  SELECT c.relname INTO v_table
  FROM pg_class c
  WHERE c.oid = p_table;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);

  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (tenant_id = fsj.current_tenant_id()) WITH CHECK (tenant_id = fsj.current_tenant_id())',
    p_table
  );

  EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_forbid_tenant_id_change ON %s', v_table, p_table);
  EXECUTE format(
    'CREATE TRIGGER trg_%s_forbid_tenant_id_change BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION fsj.forbid_tenant_id_change()',
    v_table, p_table
  );
END;
$$;

COMMENT ON FUNCTION fsj.setup_tenant_table(regclass) IS
  'Applies RLS (enabled + forced) + tenant_isolation policy (INV-T01) + the forbid_tenant_id_change trigger (INV-T03) to a business table. Caller must still declare tenant_id NOT NULL (and UNIQUE(tenant_id,id) when the table has children) in its own CREATE TABLE -- see comment above.';

-- ============================================================================
-- tenant (M00) -- GLOBAL table, no tenant_id, no RLS
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.tenant (
  id                  uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  razon_social        text NOT NULL,
  nombre_fantasia     text,
  cuit                text NOT NULL,
  domicilio           text,
  matricula_farmacia  text,
  zona_horaria        text NOT NULL DEFAULT 'America/Argentina/Mendoza',
  fecha_baja          timestamptz,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_cuit_key UNIQUE (cuit)
);

COMMENT ON TABLE fsj.tenant IS
  'Platform-level table (M00): one row per pharmacy tenant. No tenant_id, no RLS -- this IS the tenant boundary, not a tenant-scoped table.';

-- Tenant lifecycle (create/baja) is a platform-operator operation
-- (scripts/create-tenant.ts, DP-04/DP-37), never a runtime `fsj_app`
-- operation -- revoke the INSERT that ALTER DEFAULT PRIVILEGES (Phase 0)
-- grants to every new table by default. fsj_app may only read its own
-- tenant row and update the institutional/config fields (M00 config.editar,
-- ADM only -- enforced by authorize(), not by this grant).
REVOKE INSERT ON fsj.tenant FROM fsj_app;
GRANT UPDATE (razon_social, nombre_fantasia, domicilio, matricula_farmacia, zona_horaria)
  ON fsj.tenant TO fsj_app;

-- ============================================================================
-- parametro (M00) -- tenant-scoped, PK (tenant_id, clave)
-- ============================================================================
-- Typed key/value store per tenant. Only the defaults that do NOT depend on
-- an unresolved DP are documented/seeded (by scripts/create-tenant.ts, at
-- tenant-creation time -- there are no tenant rows yet at migration time to
-- seed into). Left OUT on purpose, with the blocking DP noted:
--   plazo_regularizacion_receta_dias (DP-15), umbral_folios_alerta (DP-22),
--   plazo_archivo_comun_anios / plazo_archivo_controladas_anios (DP-26),
--   plazo_firma_jornada (DP-18), dias_alerta_vencimiento_partida (DP-14).
-- session_idle_minutes / session_absolute_hours (DP-20) are intentionally
-- NOT modeled as `parametro` rows either -- see shared/auth/policy.ts,
-- which centralizes them as TS constants (conservative defaults, flagged
-- DP-20-pending) so FASE 2 can wire them up without a schema change.
DO $do$ BEGIN
  CREATE TYPE fsj.parametro_tipo AS ENUM ('TEXTO', 'NUMERO', 'BOOLEANO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE TABLE IF NOT EXISTS fsj.parametro (
  tenant_id       uuid NOT NULL REFERENCES fsj.tenant (id),
  clave           text NOT NULL,
  tipo            fsj.parametro_tipo NOT NULL,
  valor           text NOT NULL,
  descripcion     text,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, clave)
);

COMMENT ON TABLE fsj.parametro IS
  'Tenant-scoped typed key/value parameters (M00). Value is stored as text and interpreted per `tipo` by the application -- see shared/validation for the typed parser (added when the first consumer needs it, FASE 2+).';

SELECT fsj.setup_tenant_table('fsj.parametro');

GRANT UPDATE (valor, descripcion, actualizado_en) ON fsj.parametro TO fsj_app;

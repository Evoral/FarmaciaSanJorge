-- 0024_jornada_reloj_de_prueba
--
-- Makes "now" controllable in DB TESTS ONLY, without giving the application
-- any way to forge a legal jornada (business date).
--
-- ============================================================================
-- THE DEFECT THIS FIXES
-- ============================================================================
-- tests/db/*.test.ts faked "yesterday" vs. "today" by switching
-- tenant.zona_horaria between extreme IANA zones (e.g. Etc/GMT+12 and
-- Pacific/Kiritimati, ~26h apart). The calendar distance between those
-- zones' LOCAL dates depends on the wall-clock UTC hour the test happens to
-- run at, so those tests are non-deterministic -- they fail near UTC day
-- boundaries and pass otherwise. Confirmed failing at 03:18 UTC 2026-09-22:
-- cierre-diario.test.ts (INV-C19, INV-C18), cierre-jornada-guards.test.ts
-- (HOLE 1a, HOLE 2/INV-C21), libro-recetario.test.ts ("rectificativo in a
-- SIGNED jornada"). Every other test using the same zone-jump technique
-- (grepped: zona_horaria/Kiritimati/GMT+12/GMT-14 across tests/db) is
-- equally fragile even where it happens to pass right now.
--
-- ============================================================================
-- THE FIX: fsj.jornada_actual() honours a session-local override, but ONLY
-- for a session whose session_user is NOT fsj_app.
-- ============================================================================
-- fsj.jornada_actual (migration 0018) is the ONLY sanctioned way legal code
-- decides "what jornada is it right now" (fsj.jornada_de(instante, zona) is
-- the pure function of an explicit instant + zone; still used directly by
-- fsj.jornada_actual and left untouched here). This migration changes ONLY
-- the instant fsj.jornada_actual feeds into fsj.jornada_de:
--
--   current_setting('fsj.reloj_prueba', true)::timestamptz
--     IF that GUC is set to a non-empty value AND session_user <> 'fsj_app'
--   ELSE now()
--
-- SECURITY ARGUMENT (verified empirically against the real Supabase
-- instance before relying on it -- see below):
--
--   The application ALWAYS connects as fsj_app, both directly (DIRECT_URL
--   is never used at runtime, only by migrations) and through the Supabase
--   pooler (DATABASE_URL). For that connection, session_user is exactly the
--   string 'fsj_app' (verified against the pooler, not assumed -- see
--   below), so `session_user <> 'fsj_app'` is FALSE and any
--   `SET LOCAL fsj.reloj_prueba` the application attempts is silently
--   ignored: fsj.jornada_actual always resolves through the real now().
--
--   DB tests (tests/db/**, via tests/db/helpers.ts) connect as the OWNER
--   (DIRECT_URL, login `postgres`) and then run `SET LOCAL ROLE fsj_app`
--   for the duration of a transaction, to exercise RLS/grants exactly as
--   the app would. `SET ROLE` (and `SET LOCAL ROLE`) changes current_user
--   but explicitly NOT session_user (see PostgreSQL docs for SET ROLE) --
--   so in that session `session_user` stays 'postgres' even while
--   `current_user` is 'fsj_app'. The guard above reads session_user, so the
--   override keeps working for these tests even after SET LOCAL ROLE
--   fsj_app, while every privilege/RLS check in the test (which are all
--   based on current_user) still runs as fsj_app, unchanged.
--
--   The owner role can already forge absolutely anything (it can UPDATE any
--   row directly, redefine any function, disable any trigger) -- so letting
--   an owner-authenticated session also influence fsj.jornada_actual grants
--   it NO new capability. Only a session authenticated as fsj_app (i.e. the
--   application, in production or via the pooler) is restricted, and for
--   that session the override is always inert.
--
-- EMPIRICAL VERIFICATION (run manually against the real DB before writing
-- this migration; see also the new "hook itself" tests in
-- tests/db/jornada-reloj-prueba.test.ts which re-assert this on every test
-- run):
--
--   As owner (DIRECT_URL):
--     SELECT session_user, current_user;
--       -> session_user=postgres, current_user=postgres
--     BEGIN; SET LOCAL ROLE fsj_app; SELECT session_user, current_user;
--       -> session_user=postgres, current_user=fsj_app   (session_user
--          UNCHANGED by SET LOCAL ROLE, exactly as documented)
--
--   As the app, through the pooler (DATABASE_URL):
--     SELECT session_user, current_user;
--       -> session_user=fsj_app, current_user=fsj_app
--
--   session_user for the pooled connection came back as the bare string
--   'fsj_app' (not a qualified `fsj_app.<project-ref>` form), so comparing
--   session_user directly against the literal 'fsj_app' is correct for
--   this project's pooler configuration. If that ever changes (e.g. a
--   different pooler mode that qualifies the login name), this comparison
--   must be revisited -- e.g. by comparing session_user::regrole against
--   the fsj_app role's oid instead of a literal string.
--
-- ============================================================================
-- OTHER now()/current_date USES CHECKED (grepped every migration.sql for
-- `now()` and `current_date`) -- only two OTHER legal DATE decisions exist,
-- BOTH pre-existing and BOTH already documented as a deliberate, separately
-- tracked simplification in migration 0008 (fsj.movimiento_stock_validar_
-- ajuste and fsj.movimiento_stock_aplicar, plus the fsj.partida_disponible
-- view's fecha_vencimiento >= current_date filter) -- "jornada-aware
-- business dates are wired up starting FASE 2. Revisit this trigger once a
-- SQL-callable jornada helper exists." That helper (fsj.jornada_actual) now
-- exists, but migrating those three call sites is a separate, deliberate
-- change (it changes INV-U05/INV-S10 semantics for tenants outside
-- Etc/UTC), so it is OUT OF SCOPE here and left untouched. Every other
-- now() usage found (registrado_en/creado_en/emitida_en/fecha_firma/
-- sello_tiempo/etc. DEFAULT now()) records a real instant, not a jornada
-- decision, and correctly stays wired to the real now().
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.jornada_actual(p_tenant_id uuid)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT fsj.jornada_de(
    CASE
      WHEN session_user <> 'fsj_app'
       AND coalesce(current_setting('fsj.reloj_prueba', true), '') <> ''
      THEN current_setting('fsj.reloj_prueba', true)::timestamptz
      ELSE now()
    END,
    t.zona_horaria
  )
  FROM fsj.tenant t
  WHERE t.id = p_tenant_id;
$$;

COMMENT ON FUNCTION fsj.jornada_actual(uuid) IS
  'The tenant''s current jornada: fsj.jornada_de(instant, tenant.zona_horaria). The instant is current_setting(''fsj.reloj_prueba'', true)::timestamptz when that GUC is non-empty AND session_user <> ''fsj_app'' (DB-test-only override -- see migration 0024 header for the full security argument), otherwise the real now(). Use this everywhere a legal date is decided -- never current_date/now()::date directly.';

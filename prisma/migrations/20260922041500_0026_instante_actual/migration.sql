-- 0026_instante_actual
--
-- Extracts the "resolve the current instant, honouring the DB-test-only
-- fsj.reloj_prueba override" logic that migration 0024 inlined into
-- fsj.jornada_actual(uuid) into its OWN function, fsj.instante_actual(),
-- so it can be tested directly with EXECUTE granted to fsj_app -- WITHOUT
-- needing any fsj.tenant row to exist.
--
-- ============================================================================
-- WHY THIS EXISTS (see also migration 0024's header for the original
-- argument -- repeated and refined here)
-- ============================================================================
-- The mandatory hook test for 0024's override ("a real fsj_app session
-- honours the guard by ignoring the override") needs to call something
-- fsj_app can EXECUTE and observe the result of, from a genuine
-- DATABASE_URL/pooler connection (session_user = 'fsj_app'), with NO
-- fsj.tenant row involved:
--   - fsj_app has no INSERT grant on fsj.tenant (deliberate -- tenant
--     creation is a platform-operator operation, migration 0001/tests/db/
--     tenant-parametro.test.ts), so a genuine fsj_app session cannot create
--     one to test against.
--   - Two separate Postgres connections never see each other's uncommitted
--     work (MVCC) -- an owner connection cannot INSERT a tenant and leave
--     it visible, uncommitted, to a different fsj_app connection.
--   - `SET LOCAL SESSION AUTHORIZATION fsj_app` (which, unlike `SET ROLE`,
--     DOES change session_user) was tried from the owner connection and
--     fails: "permission denied to set session authorization fsj_app" --
--     the owner role on this Supabase project is not permitted to do this.
--   - Actually committing a throwaway tenant (fsj.tenant has no
--     forbid_delete trigger, so cleanup IS technically possible) was
--     considered and REJECTED: "DB tests never commit" is the one rule
--     that makes running this suite against the REAL database safe at all
--     (see tests/db/helpers.ts's module doc and tests/db/global-setup.ts);
--     a commit+delete leaks a row into the real DB permanently if the test
--     process dies between the two.
--
-- fsj.instante_actual() sidesteps all of it: it takes no argument, needs
-- no table, and fsj_app can EXECUTE it directly. The security test becomes
-- "SET fsj.reloj_prueba to an obviously-wrong instant (e.g. year 2001),
-- call fsj.instante_actual() over a real fsj_app connection, and assert
-- the result is close to the REAL now() and NOT the year-2001 value" --
-- see tests/db/jornada-reloj-prueba.test.ts.
--
-- ============================================================================
-- SECURITY ARGUMENT (same as migration 0024, restated for this function;
-- empirically verified against the real Supabase instance before that
-- migration was written)
-- ============================================================================
-- The application ALWAYS connects as fsj_app (directly and through the
-- Supabase pooler). For that connection session_user is exactly the
-- string 'fsj_app' (verified against the pooler DATABASE_URL connection --
-- no `fsj_app.<project-ref>` qualification), so `session_user <> 'fsj_app'`
-- is FALSE and any `SET LOCAL fsj.reloj_prueba` the application attempts
-- is silently ignored: fsj.instante_actual() always returns the real
-- now().
--
-- DB tests connect as the OWNER (DIRECT_URL, login `postgres`) and run
-- `SET LOCAL ROLE fsj_app` for the duration of a transaction to exercise
-- RLS/grants as the app would. `SET ROLE`/`SET LOCAL ROLE` changes
-- current_user but explicitly NOT session_user (PostgreSQL docs) --
-- verified empirically: as owner, session_user=postgres/current_user=
-- postgres; after `SET LOCAL ROLE fsj_app` inside a transaction,
-- session_user STAYS postgres while current_user becomes fsj_app. The
-- guard reads session_user, so the override keeps working for DB tests
-- even after SET LOCAL ROLE fsj_app, while every privilege/RLS check in
-- the test (all based on current_user) still runs as fsj_app, unchanged.
--
-- The owner role can already forge absolutely anything (UPDATE any row
-- directly, redefine any function, disable any trigger), so letting an
-- owner-authenticated session also influence fsj.instante_actual() grants
-- it no new capability. Only a session authenticated as fsj_app (the
-- application, in production or via the pooler) is restricted, and for
-- that session the override is always inert.
--
-- pg_temp intentionally NOT included in the pinned search_path (unlike
-- this function's grant target having no risk of a malicious temp-schema
-- object shadowing anything -- this function calls no unqualified
-- functions/tables at all, only built-ins), matching this codebase's
-- existing `SET search_path = fsj, extensions` convention used by every
-- other function in these migrations.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.instante_actual()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = fsj, extensions
AS $$
  SELECT CASE
    WHEN session_user <> 'fsj_app'
     AND coalesce(current_setting('fsj.reloj_prueba', true), '') <> ''
    THEN current_setting('fsj.reloj_prueba', true)::timestamptz
    ELSE now()
  END;
$$;

COMMENT ON FUNCTION fsj.instante_actual() IS
  'The current instant: current_setting(''fsj.reloj_prueba'', true)::timestamptz when that GUC is non-empty AND session_user <> ''fsj_app'' (DB-test-only override -- see migration 0026 header for the full security argument), otherwise the real now(). fsj.jornada_actual(uuid) delegates to this. Grantable to fsj_app precisely because the guard makes it inert for that role -- see tests/db/jornada-reloj-prueba.test.ts for the security test that fails if the guard is removed.';

GRANT EXECUTE ON FUNCTION fsj.instante_actual() TO fsj_app;

-- ============================================================================
-- fsj.jornada_actual(uuid) now delegates the instant to fsj.instante_actual()
-- instead of inlining the CASE itself (migration 0024). Everything else --
-- the fsj.jornada_de(instant, tenant.zona_horaria) delegation, the tenant
-- lookup -- is unchanged.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.jornada_actual(p_tenant_id uuid)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT fsj.jornada_de(fsj.instante_actual(), t.zona_horaria)
  FROM fsj.tenant t
  WHERE t.id = p_tenant_id;
$$;

COMMENT ON FUNCTION fsj.jornada_actual(uuid) IS
  'The tenant''s current jornada: fsj.jornada_de(fsj.instante_actual(), tenant.zona_horaria). fsj.instante_actual() resolves the DB-test-only fsj.reloj_prueba override (migration 0024/0026) when it applies, otherwise the real now(). Use this everywhere a legal date is decided -- never current_date/now()::date directly.';

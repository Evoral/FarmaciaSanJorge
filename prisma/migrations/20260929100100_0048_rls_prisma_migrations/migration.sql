-- 0048_rls_prisma_migrations
--
-- Supabase security advisor: "Table public._prisma_migrations is public, but
-- RLS has not been enabled". Prisma keeps its migration history in `public`,
-- the schema Supabase exposes through PostgREST, so the anon/authenticated
-- API roles could read it (migration names, checksums, timestamps).
--
-- Enabling RLS with NO policies denies every non-owner role. The only
-- readers/writers are `prisma migrate` (scripts/db-migrate.ts) and
-- tests/db/global-setup.ts, both over DIRECT_URL as `postgres`, the table
-- owner -- and a table owner bypasses RLS (no FORCE here), so neither is
-- affected. The REVOKEs are defense in depth for the API roles, guarded like
-- migration 0000's (those roles exist only on a real Supabase project).

ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM authenticated;
  END IF;
END
$$;

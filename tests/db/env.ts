/**
 * Shared logic for deciding whether DB tests can run, used by both
 * `tests/db/global-setup.ts` and individual test files (so a test file
 * run directly, bypassing global setup, still skips safely instead of
 * throwing on a missing connection).
 *
 * IMPORTANT: there is only ONE Supabase database (the real one) -- no
 * separate test project exists yet. DB tests run against DATABASE_URL /
 * DIRECT_URL, the exact same connection strings the app uses. Safety
 * comes entirely from `tests/db/helpers.ts#inRollbackTx` (every test runs
 * inside a transaction that is ALWAYS rolled back) and from
 * `global-setup.ts` never running a destructive/migrating command.
 * Revisit before production go-live: provision a dedicated test/staging
 * Supabase project instead of testing against the real one.
 *
 * Vitest does not read .env on its own (unlike Next.js), so it is loaded
 * here -- this module is imported by global-setup and by every db test
 * file, so the connection strings are available in both paths.
 */
import "dotenv/config";

export interface DbTestEnv {
  databaseUrl: string;
  directUrl: string;
}

/** Why DB tests are being skipped, or null if they should run. */
export function dbTestSkipReason(): string | null {
  const { DATABASE_URL, DIRECT_URL, FSJ_DB_TESTS } = process.env;

  if (!DATABASE_URL || !DIRECT_URL || FSJ_DB_TESTS !== "yes") {
    return (
      "DB tests skipped: DATABASE_URL, DIRECT_URL and FSJ_DB_TESTS=yes must all be set to run " +
      "tests/db. These tests run against the REAL database inside transactions that are always " +
      "rolled back (see tests/db/helpers.ts#inRollbackTx). See .env.example."
    );
  }

  return null;
}

export function requireDbTestEnv(): DbTestEnv {
  const reason = dbTestSkipReason();
  if (reason) throw new Error(reason);
  return {
    databaseUrl: process.env.DATABASE_URL!,
    directUrl: process.env.DIRECT_URL!,
  };
}

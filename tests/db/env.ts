/**
 * Shared logic for deciding whether DB tests can run, used by both
 * `tests/db/global-setup.ts` and individual test files (so a test file
 * run directly, bypassing global setup, still skips safely instead of
 * throwing on a missing connection).
 *
 * DB tests run against DATABASE_URL / DIRECT_URL of the env file in
 * DOTENV_CONFIG_PATH: `.env.desarrollo`, the local Supabase Postgres
 * (docs/local-db.md), which is also the developer's dev database. Safety
 * comes from `tests/db/helpers.ts#inRollbackTx` (every test runs inside a
 * transaction that is ALWAYS rolled back) and from `global-setup.ts`
 * never running a destructive/migrating command.
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
      "tests/db. These tests run against the local dev database (DOTENV_CONFIG_PATH=.env.desarrollo) " +
      "inside transactions that are always rolled back (see tests/db/helpers.ts#inRollbackTx). " +
      "See docs/local-db.md."
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

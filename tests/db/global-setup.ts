/**
 * Vitest globalSetup for the `db` project. Runs once before all tests/db/**
 * test files.
 *
 * IMPORTANT -- READ BEFORE CHANGING THIS FILE: the target database
 * (DATABASE_URL/DIRECT_URL of .env.desarrollo, the local Supabase
 * Postgres) is also the developer's dev database. This file MUST NEVER run
 * `prisma migrate reset`, `db push --force-reset`, `DROP`, `TRUNCATE`, or
 * any other destructive/mutating command. It only VERIFIES that
 * migrations are already applied (read-only) and fails loudly if they are
 * not; it never auto-migrates. All actual safety against leaving data
 * behind comes from `tests/db/helpers.ts#inRollbackTx`, which every DB
 * test uses to wrap its work in a transaction that is always rolled back.
 * See docs/local-db.md.
 *
 * - Missing/incomplete env (`DATABASE_URL`, `DIRECT_URL`, `FSJ_DB_TESTS=yes`)
 *   => log a clear message and return without error, so
 *   `npm run test:db` exits 0 (skip, not fail). Individual test files also
 *   self-skip via `dbTestSkipReason()` (tests/db/env.ts), so this works
 *   even if a test file is run directly.
 * - Otherwise: read-only check of the `_prisma_migrations` table over
 *   DIRECT_URL. If migrations aren't applied, throw (hard failure -- tests
 *   would be meaningless against an unmigrated schema, and this harness
 *   will not fix that for you).
 *
 * Why not `prisma migrate status`: it connects through `url`
 * (DATABASE_URL, the transaction-mode pooler), which closes the
 * connection under the CLI's session-level usage (P1017). Reading the
 * table over DIRECT_URL (session pooler) is both cheaper and closer to
 * what we actually want to assert.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { dbTestSkipReason, requireDbTestEnv } from "./env";

export default async function globalSetup(): Promise<void> {
  const skipReason = dbTestSkipReason();
  if (skipReason) {
    console.log(`\n[tests/db] ${skipReason}\n`);
    return;
  }

  console.log(
    `\n[tests/db] Running against ${new URL(process.env.DIRECT_URL!).host} (DATABASE_URL/DIRECT_URL), ` +
      "which also holds dev data. Every test MUST wrap its work in inRollbackTx() " +
      "(tests/db/helpers.ts) so nothing persists. This setup step is READ-ONLY: it never runs " +
      "migrate reset or any destructive command.\n",
  );

  console.log("[tests/db] Verifying migrations are applied (read-only query on _prisma_migrations)...\n");

  const { directUrl } = requireDbTestEnv();
  const expected = readdirSync(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const client = new Client({ connectionString: directUrl });
  await client.connect();
  let applied: string[];
  try {
    const result = await client.query<{ migration_name: string }>(
      // Prisma keeps its own migrations table in `public`, not in `fsj`.
      `SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    applied = result.rows.map((row) => row.migration_name);
  } finally {
    await client.end();
  }

  const missing = expected.filter((name) => !applied.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `[tests/db] Migrations are not applied on the target database (missing: ${missing.join(", ")}). ` +
        "Run `npm run db:migrate` first -- this test harness deliberately never auto-migrates, " +
        "because the user applies every migration by hand and a test run must never change the schema.",
    );
  }

  console.log("[tests/db] Migrations verified. Proceeding -- every test must roll back its own transaction.\n");
}

/**
 * Bootstraps the `fsj_app` role after migrations have run: sets its login
 * password and search_path. Split out from the migration itself because a
 * password must never be committed to a migration file / git history.
 *
 * Connects with DIRECT_URL (owner role `postgres`), never DATABASE_URL.
 *
 * Usage: `npm run db:bootstrap` (run once after the first
 * `prisma migrate deploy` against a fresh database, and again any time
 * FSJ_APP_DB_PASSWORD is rotated).
 *
 * Idempotent: safe to run multiple times.
 */
import "dotenv/config";
import { Client } from "pg";

async function main(): Promise<void> {
  const directUrl = process.env.DIRECT_URL;
  const password = process.env.FSJ_APP_DB_PASSWORD;

  const missing: string[] = [];
  if (!directUrl) missing.push("DIRECT_URL");
  if (!password) missing.push("FSJ_APP_DB_PASSWORD");
  if (missing.length > 0) {
    console.error(
      `db-bootstrap: missing required environment variable(s): ${missing.join(", ")}.\n` +
        "Set them in .env (see .env.example) before running this script.",
    );
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString: directUrl });
  await client.connect();

  try {
    // pg's Client#escapeLiteral produces a safely-quoted SQL string literal
    // (handles embedded quotes/backslashes), so the password is never
    // interpolated unescaped and never logged.
    const escapedPassword = client.escapeLiteral(password!);

    await client.query(`ALTER ROLE fsj_app WITH LOGIN PASSWORD ${escapedPassword};`);
    await client.query(`ALTER ROLE fsj_app SET search_path = fsj, extensions;`);

    // The migration owner must be able to `SET ROLE fsj_app` so the DB test
    // harness can exercise the runtime role's privileges (RLS, column
    // grants). On Supabase the owner is NOT a superuser, so membership has
    // to be granted explicitly. This does not widen fsj_app's own rights.
    await client.query(`GRANT fsj_app TO CURRENT_USER;`);

    console.log("db-bootstrap: fsj_app login + search_path + owner membership configured.");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  // Never log the raw error object as-is if it might embed the connection
  // string or the password (pg errors sometimes echo query text).
  const raw = error instanceof Error ? error.message : String(error);
  const password = process.env.FSJ_APP_DB_PASSWORD;
  const message = (password ? raw.split(password).join("[REDACTED]") : raw)
    .replace(/postgres(ql)?:\/\/\S+/gi, "[REDACTED_URL]");
  console.error(`db-bootstrap failed: ${message}`);
  process.exitCode = 1;
});

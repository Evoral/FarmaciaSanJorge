/**
 * Runs `prisma migrate deploy` as the OWNER role.
 *
 * Why this wrapper exists: prisma.config.ts maps `url` to DATABASE_URL,
 * which is the restricted runtime role `fsj_app`. Migrations create
 * schemas, roles, functions and grants, so they must run through
 * DIRECT_URL (the `postgres` owner). On the very first run `fsj_app`
 * does not even exist yet -- it is created by migration 0000 and given a
 * login by scripts/db-bootstrap.ts afterwards.
 *
 * Order on a fresh database: db:migrate -> db:bootstrap -> db:generate.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";

const directUrl = process.env.DIRECT_URL;

if (!directUrl) {
  console.error("db-migrate failed: DIRECT_URL is required (Supabase direct connection, role postgres). See .env.example.");
  process.exit(1);
}

// `npx tsx scripts/db-migrate.ts resolve --rolled-back <migration>` clears a
// failed migration (P3018/P3009) with the same owner connection. Call the
// script directly: through `npm run ... --`, PowerShell's npm.ps1 drops the `--`. Only `resolve` is
// forwarded: `reset` and `dev` must never run against the shared databases.
const extra = process.argv.slice(2);
if (extra.length > 0 && extra[0] !== "resolve") {
  console.error(`db-migrate failed: only "resolve" may be passed through, got "${extra[0]}".`);
  process.exit(1);
}
const args = extra.length > 0 ? ["prisma", "migrate", ...extra] : ["prisma", "migrate", "deploy"];

const result = spawnSync("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    // Prisma reads `url` from prisma.config.ts, which maps to DATABASE_URL.
    // Point it at the owner connection for the duration of this command only.
    DATABASE_URL: directUrl,
  },
});

process.exit(result.status ?? 1);

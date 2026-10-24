/**
 * Runs `next dev` against the database named by an env file, e.g.
 * `npm run dev:desarrollo` (.env.desarrollo) or `npm run dev:prod` (.env.prod).
 *
 * Why this wrapper exists: there is deliberately no `.env`, so every command
 * has to name its database. `node --env-file=... next dev` does not work:
 * Next re-spawns its server with the parent's execArgv in NODE_OPTIONS, where
 * Node refuses `--env-file`. Loading the file here and passing it down as the
 * child's environment avoids that; Next never overrides variables that are
 * already set.
 *
 * Usage: `tsx scripts/dev.ts <env-file> [next dev args...]`
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

const [envFile, ...nextArgs] = process.argv.slice(2);

if (!envFile || !existsSync(envFile)) {
  console.error(`dev failed: env file not found (${envFile ?? "none given"}). Use .env.desarrollo or .env.prod.`);
  process.exit(1);
}

config({ path: envFile, quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(`dev failed: ${envFile} has no DATABASE_URL.`);
  process.exit(1);
}

// Say which project this run hits before Next starts; never the password.
console.log(`dev: ${envFile} -> ${new URL(databaseUrl).username}`);

const result = spawnSync("npx", ["next", "dev", ...nextArgs], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

process.exit(result.status ?? 1);

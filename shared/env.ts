/**
 * Validated environment access. This is the ONLY module of app/runtime
 * code allowed to read `process.env` directly (see docs/architecture.md).
 * Exceptions: one-off scripts (scripts/) and the DB test harness (tests/db).
 *
 * Design choice: validation is LAZY, not eager at import time. Next.js
 * evaluates modules during `next build` (route collection, RSC graph
 * analysis) even when no request ever runs, and DB credentials are not
 * expected to exist at build time (CI builds, Vercel builds without a
 * provisioned Supabase project yet). Throwing at import time would break
 * `next build`. Instead, `getEnv()` validates on first call and caches the
 * result, so the app still fails fast -- just at first real use (first DB
 * connection, first log line) instead of at module load.
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (Supabase pooler connection, role fsj_app)"),
  DIRECT_URL: z
    .string()
    .min(1, "DIRECT_URL is required (Supabase direct connection, role postgres)"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // FASE 12 point 12.2 (M15): shared secret for `POST /api/jobs/plazos-archivo`
  // (the daily job that moves EN_ARCHIVO lotes to PLAZO_CUMPLIDO). Optional
  // -- when unset, the route handler answers 503 instead of ever comparing
  // against an empty/undefined secret. Never logged. An empty or
  // whitespace-only value is treated the SAME as unset (`undefined`) --
  // without this, `CRON_SECRET=""` in a deployment's env would otherwise
  // pass `z.string().min(1).optional()`'s `undefined` check but fail
  // `.min(1)`, throwing out of `getEnv()` and breaking every other env
  // read app-wide (`getEnv()` validates the WHOLE schema at once).
  CRON_SECRET: z.preprocess((value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value), z.string().min(1).optional()),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Names only -- values are never included in error messages or logs. */
function formatZodError(error: z.ZodError): string {
  const missing = error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
  return [
    "Invalid or missing environment variables:",
    ...missing,
    "",
    "Copy .env.example to .env and fill in the Supabase connection strings.",
  ].join("\n");
}

/**
 * Returns validated environment variables, validating and caching on first
 * call. Throws a readable error (variable names only, never values) if
 * anything required is missing or malformed.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    LOG_LEVEL: process.env.LOG_LEVEL,
    CRON_SECRET: process.env.CRON_SECRET,
  });

  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }

  cached = parsed.data;
  return cached;
}

/** Test-only: clears the cache so a test can re-validate with a fresh process.env. */
export function resetEnvCacheForTests(): void {
  cached = undefined;
}

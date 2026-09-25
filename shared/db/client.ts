/**
 * Prisma client singleton, wired to the Supabase pooler via the `pg`
 * driver adapter (Prisma 7 requires an explicit driver adapter for SQL
 * providers -- see docs/architecture.md). Connects as `fsj_app`
 * (DATABASE_URL), never as the migration owner.
 *
 * One instance per process, in EVERY environment: each PrismaClient owns
 * its own `pg` pool, so creating one per call would exhaust Supabase's
 * pooler connection limit. The instance lives on `globalThis` so Next.js
 * dev hot-reload (which re-evaluates modules) reuses it too.
 */
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getEnv } from "@/shared/env";

declare global {
  var __fsjPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const env = getEnv();
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    // FASE 14 point 14.5: `pg.Pool`'s own default (`max: 10`) is sized for
    // a long-lived server with ONE pool for the whole process -- exactly
    // what we have here (this module's singleton), but on a serverless
    // platform (Vercel) each warm function instance runs this same
    // singleton independently, so its pool budget multiplies by however
    // many instances are warm concurrently. DATABASE_URL already points at
    // Supabase's Supavisor pooler (transaction mode, port 6543, see
    // .env.example), which itself has a limited backend-connection budget
    // shared across every serverless instance -- a `max: 10` per instance
    // would exhaust it under moderate concurrency. Kept small and
    // deliberately NOT configurable via env: this is a platform-topology
    // constant (Vercel + Supavisor), not a per-deployment tuning knob.
    max: 3,
  });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * The shared Prisma client. Lazily created on first access so importing
 * this module never triggers env validation or a DB connection attempt
 * (safe for `next build` -- see shared/env.ts).
 */
export function getPrismaClient(): PrismaClient {
  if (!globalThis.__fsjPrisma) {
    globalThis.__fsjPrisma = createClient();
  }
  return globalThis.__fsjPrisma;
}

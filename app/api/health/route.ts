/**
 * `GET /api/health` (FASE 14 point 14.4). Unauthenticated liveness/
 * readiness probe for the hosting platform (Vercel) and any external
 * uptime monitor -- excluded from the session guard by proxy.ts's
 * `matcher` (which skips every `/api/**` path, unchanged by FASE 14).
 *
 * Deliberately returns NOTHING beyond a status/db/time triplet: no
 * package versions, no tenant data, no environment details, no stack
 * traces -- an unauthenticated endpoint is, by definition, reachable by
 * anyone, so it must never leak anything useful to an attacker fingerprinting
 * the deployment (same "don't reveal more than needed" posture as the
 * 404-not-403 convention documented in proxy.ts/plan §12).
 *
 * The DB check is a trivial `SELECT 1` through the SAME Prisma client the
 * app uses at runtime (`shared/db/client.ts`) -- not a separate connection
 * -- bounded by a short timeout so a slow/hung database degrades this
 * endpoint to "error" quickly instead of hanging the health check itself.
 */
import { NextResponse } from "next/server";
import { getPrismaClient } from "@/shared/db/client";
import { loggerForRequest } from "@/shared/logging/logger";

const DB_CHECK_TIMEOUT_MS = 2000;

async function checkDatabase(): Promise<void> {
  const prisma = getPrismaClient();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Database health check timed out")), DB_CHECK_TIMEOUT_MS);
  });
  try {
    // Plain SELECT 1: touches no RLS-protected table, so it works with no
    // `app.tenant_id` set -- this endpoint verifies connectivity, not
    // tenant data access.
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  const time = new Date().toISOString();

  let dbOk = true;
  try {
    await checkDatabase();
  } catch (error) {
    dbOk = false;
    loggerForRequest(requestId).error({ error }, "health check: database query failed");
  }

  return NextResponse.json(
    {
      status: dbOk ? "ok" : "error",
      db: dbOk ? "ok" : "error",
      time,
    },
    {
      status: dbOk ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/**
 * `GET|POST /api/jobs/plazos-archivo` (FASE 12 point 12.2, M15; GET added
 * FASE 14 point 14.5). Daily job: no user session -- authenticated with a
 * shared secret (`CRON_SECRET`, `shared/env.ts`, optional) compared in
 * CONSTANT TIME via `crypto.timingSafeEqual` over fixed-length SHA-256
 * digests (so neither the header's length nor its byte-by-byte match ever
 * leaks through timing). `CRON_SECRET` unset -> 503 (not configured).
 * Missing/mismatched credential -> 404 (same "don't reveal what this
 * endpoint is guarding" posture as the multi-tenant 404-not-403
 * convention, plan §12).
 *
 * Two ways in, same secret, same constant-time check -- this does NOT
 * widen the attack surface, it only adds a second transport for the exact
 * same credential:
 *  - `GET` + `Authorization: Bearer <CRON_SECRET>` -- what Vercel Cron
 *    sends (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs:
 *    "The value of the variable will be automatically sent as an
 *    Authorization header when Vercel invokes your cron job"; Vercel Cron
 *    always issues a GET). `vercel.json`'s `crons[].path` triggers this.
 *  - `POST` + `x-cron-secret: <CRON_SECRET>` -- kept for any other
 *    caller (a host cron / scheduled task outside Vercel, or manual
 *    triggering) that already used this shape before FASE 14.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/shared/env";
import { getLogger } from "@/shared/logging/logger";
import { runActualizarPlazosJob } from "@/modules/archivo/application/actualizar-plazos";

const SECRET_HEADER = "x-cron-secret";
const BEARER_PREFIX = "Bearer ";

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides to a fixed 32-byte digest first: timingSafeEqual itself
  // requires equal-length buffers and would otherwise leak the length of
  // the shorter string.
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/** Extracts the credential to check, regardless of which transport was used. */
function extractCredential(request: Request): string | null {
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith(BEARER_PREFIX)) {
    return bearer.slice(BEARER_PREFIX.length);
  }
  return request.headers.get(SECRET_HEADER);
}

async function runJob(request: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    getLogger().error("plazos-archivo: CRON_SECRET is not configured");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const provided = extractCredential(request);
  if (!provided || !constantTimeEquals(provided, secret)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const resultado = await runActualizarPlazosJob();
  return NextResponse.json({
    tenantsProcesados: resultado.tenantsProcesados,
    lotesMovidos: resultado.lotesMovidos,
    tenantsConError: resultado.tenantsConError,
  });
}

/** Vercel Cron invokes cron paths with GET + `Authorization: Bearer <CRON_SECRET>`. */
export async function GET(request: Request): Promise<Response> {
  return runJob(request);
}

/** Pre-FASE-14 transport, kept for non-Vercel callers: POST + `x-cron-secret`. */
export async function POST(request: Request): Promise<Response> {
  return runJob(request);
}

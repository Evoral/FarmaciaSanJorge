/**
 * `GET|POST /api/jobs/retiros-vencidos` (openspec/specs/retiro-vencido/spec.md RV2). Daily job: moves PREPARADA recetas whose retiro
 * expired to RETIRO_VENCIDO, for every active tenant.
 *
 * Same authentication as `/api/jobs/plazos-archivo` (see that route for the full rationale): no user session, a shared
 * secret (`CRON_SECRET`) compared in CONSTANT TIME over SHA-256 digests. `CRON_SECRET` unset -> 503; missing or wrong
 * credential -> 404 (the route does not reveal that it exists).
 *  - `GET` + `Authorization: Bearer <CRON_SECRET>` -- what Vercel Cron sends.
 *  - `POST` + `x-cron-secret: <CRON_SECRET>` -- any other caller (host cron, manual trigger).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/shared/env";
import { getLogger } from "@/shared/logging/logger";
import { runVencerRetirosJob } from "@/modules/entregas/application/vencer-retiros";

const SECRET_HEADER = "x-cron-secret";
const BEARER_PREFIX = "Bearer ";

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides to a fixed 32-byte digest first: timingSafeEqual requires equal-length buffers and would otherwise
  // leak the length of the shorter string.
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
    getLogger().error("retiros-vencidos: CRON_SECRET is not configured");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const provided = extractCredential(request);
  if (!provided || !constantTimeEquals(provided, secret)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const resultado = await runVencerRetirosJob();
  return NextResponse.json({
    tenantsProcesados: resultado.tenantsProcesados,
    recetasVencidas: resultado.recetasVencidas,
    tenantsConError: resultado.tenantsConError,
  });
}

/** Vercel Cron invokes cron paths with GET + `Authorization: Bearer <CRON_SECRET>`. */
export async function GET(request: Request): Promise<Response> {
  return runJob(request);
}

/** Non-Vercel callers: POST + `x-cron-secret`. */
export async function POST(request: Request): Promise<Response> {
  return runJob(request);
}

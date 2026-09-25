/**
 * `POST /api/jobs/plazos-archivo` (FASE 12 point 12.2, M15). Daily job: no
 * user session -- authenticated with a shared secret (`CRON_SECRET`,
 * `shared/env.ts`, optional) compared in CONSTANT TIME via
 * `crypto.timingSafeEqual` over fixed-length SHA-256 digests (so neither the
 * header's length nor its byte-by-byte match ever leaks through timing).
 * `CRON_SECRET` unset -> 503 (not configured). Missing/mismatched header ->
 * 404 (same "don't reveal what this endpoint is guarding" posture as the
 * multi-tenant 404-not-403 convention, plan §12).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/shared/env";
import { getLogger } from "@/shared/logging/logger";
import { runActualizarPlazosJob } from "@/modules/archivo/application/actualizar-plazos";

const SECRET_HEADER = "x-cron-secret";

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides to a fixed 32-byte digest first: timingSafeEqual itself
  // requires equal-length buffers and would otherwise leak the length of
  // the shorter string.
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

export async function POST(request: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    getLogger().error("plazos-archivo: CRON_SECRET is not configured");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const provided = request.headers.get(SECRET_HEADER);
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

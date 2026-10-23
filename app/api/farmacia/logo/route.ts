/**
 * `GET /api/farmacia/logo` (docs/specs/logo-farmacia.md): the current session's tenant logo, for the navigation bar.
 * Any signed-in usuario (`getLogoTenant`'s own `defineQuery` is the authority, not re-checked here). 404 when the
 * tenant has no logo: the navbar then never asks for it and shows the generic `public/logo.png`.
 *
 * The navbar URL carries `?v=<logo_actualizado_en>`, so a versioned request is cached for good (`private`: it is
 * per tenant, never in a shared cache); a new logo is a new URL.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getLogoTenant } from "@/modules/farmacia/application/get-marca-tenant";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  DOMAIN_ERROR: 422,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  INVARIANT_VIOLATION: 409,
  STEP_UP_REQUIRED: 401,
  PASOS_PENDIENTES: 403,
  INTERNAL_ERROR: 500,
};

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();

  let logo: Awaited<ReturnType<typeof getLogoTenant>>;
  try {
    logo = await getLogoTenant();
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  if (!logo) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const versionada = request.nextUrl.searchParams.has("v");
  return new NextResponse(logo.bytes, {
    status: 200,
    headers: {
      "Content-Type": logo.tipo,
      "Content-Length": String(logo.bytes.byteLength),
      "Cache-Control": versionada ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

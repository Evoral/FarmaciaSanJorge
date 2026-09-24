/**
 * `GET /api/cierres/[id]/pdf` (FASE 10, M13a point 10.2). Requires
 * `cierres.imprimir` (enforced by `imprimirCierrePdf`'s own `defineQuery`/
 * `defineCommand`, not re-checked here -- same "the use case is the
 * authority" discipline as `app/api/libro/export/pdf/route.ts`).
 */
import { NextResponse } from "next/server";
import { imprimirCierrePdf } from "@/modules/cierres/application/imprimir-cierre-pdf";
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
  INTERNAL_ERROR: 500,
};

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const requestId = crypto.randomUUID();
  const { id } = await params;

  let pdf: Buffer;
  try {
    pdf = await imprimirCierrePdf(id);
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="cierre-${id}.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

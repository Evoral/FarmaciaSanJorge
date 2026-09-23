/**
 * `GET /api/preparaciones/[id]/etiqueta/pdf` (M11, FASE 8 point 8.5). Serves
 * the printed etiqueta for a CONFIRMADA preparación. `[id]` is the
 * preparación's OPAQUE uuid -- same "no patient data in the URL"
 * discipline as `app/api/fichas-tecnicas/[id]/pdf/route.ts`, which this
 * route mirrors exactly (including the error-status mapping).
 */
import { NextResponse } from "next/server";
import { imprimirEtiquetaPdf } from "@/modules/preparaciones/application/imprimir-etiqueta-pdf";
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
  const { id } = await params;
  const requestId = crypto.randomUUID();

  let resultado;
  try {
    resultado = await imprimirEtiquetaPdf(id);
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  const { pdf, preparacionId } = resultado;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiqueta-${preparacionId}.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

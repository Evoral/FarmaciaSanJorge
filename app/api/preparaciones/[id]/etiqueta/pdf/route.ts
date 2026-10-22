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
  PASOS_PENDIENTES: 403,
  INTERNAL_ERROR: 500,
};

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  // `?tamano=<etiqueta_tamano.id>&columna=<n>&fila=<n>` is what the print dialog picked: the label size and the cell of
  // the sheet (docs/specs/hoja-etiquetas.md R7). Without `tamano` (old links) the use case takes the first active size
  // that fits the sheet; without `columna` / `fila`, 1 / 1. An unknown / deactivated / other-tenant size is a 404; a
  // malformed id, or a cell that is not an integer or is outside the grid, a 400.
  const busqueda = new URL(request.url).searchParams;
  const tamanoId = busqueda.get("tamano") || undefined;
  const columna = busqueda.get("columna") ?? undefined;
  const fila = busqueda.get("fila") ?? undefined;

  let resultado;
  try {
    resultado = await imprimirEtiquetaPdf(id, { tamanoId, columna, fila });
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

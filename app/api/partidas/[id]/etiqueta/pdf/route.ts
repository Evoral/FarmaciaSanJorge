/**
 * `GET /api/partidas/[id]/etiqueta/pdf`: the etiqueta of a lot elaborated in the farmacia
 * (modules/stock/application/imprimir-etiqueta-lote-pdf.ts). `[id]` is the partida's uuid. Same query string
 * (`?tamano=&columna=&fila=`, hoja-etiquetas R7) and error-status mapping as `app/api/preparaciones/[id]/etiqueta/pdf/route.ts`.
 */
import { NextResponse } from "next/server";
import { imprimirEtiquetaLotePdf } from "@/modules/stock/application/imprimir-etiqueta-lote-pdf";
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
  const busqueda = new URL(request.url).searchParams;

  let pdf: Buffer;
  try {
    pdf = await imprimirEtiquetaLotePdf(id, {
      tamanoId: busqueda.get("tamano") || undefined,
      columna: busqueda.get("columna") ?? undefined,
      fila: busqueda.get("fila") ?? undefined,
    });
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    return NextResponse.json(toSafeError(e, requestId), { status });
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiqueta-lote-${id}.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

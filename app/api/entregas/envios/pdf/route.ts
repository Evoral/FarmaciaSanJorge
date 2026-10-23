/**
 * `GET /api/entregas/envios/pdf?repartidorId=<uuid>[&fecha=AAAA-MM-DD]` ("Exportar envíos",
 * docs/specs/envios-repartidores.md). Serves the "Hoja de envíos" PDF of one repartidor. Only the repartidor's opaque
 * uuid and the fecha travel in the URL (E11, DP-24: never patient data); mirrors
 * `app/api/preparaciones/[id]/etiqueta/pdf/route.ts`, including the error-status mapping. A missing `fecha` means
 * every pending envío of the repartidor.
 */
import { NextResponse } from "next/server";
import { imprimirEnviosPdf } from "@/modules/entregas/application/imprimir-envios-pdf";
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

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const params = new URL(request.url).searchParams;
  // A missing repartidorId becomes "" and fails the use case's zod validation (400).
  const repartidorId = params.get("repartidorId") ?? "";
  const fecha = params.get("fecha") || undefined;

  let resultado;
  try {
    resultado = await imprimirEnviosPdf({ repartidorId, fecha });
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  const { pdf, filename } = resultado;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

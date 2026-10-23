/**
 * `GET /api/preparaciones/etiquetas/pdf?e=<preparacionId>.<tamanoId>.<columna>.<fila>&e=...`: the toma workspace's
 * single "Imprimir" -- every etiqueta of the receta in ONE PDF, sharing the sheet while they do not overlap
 * (docs/specs/hoja-etiquetas.md R14). Opaque uuids only, no patient data in the URL; same error-status mapping as
 * `../../[id]/etiqueta/pdf/route.ts`. A malformed `e` is a 400.
 */
import { NextResponse } from "next/server";
import { imprimirEtiquetasPdf, SIN_ETIQUETAS_MESSAGE } from "@/modules/preparaciones/application/imprimir-etiqueta-pdf";
import { leerEtiquetaEnPdf } from "@/modules/preparaciones/domain/etiqueta";
import { AppError, type AppErrorCode, toSafeError, ValidationError } from "@/shared/errors";

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

  let pdf;
  try {
    const pedidas = new URL(request.url).searchParams.getAll("e").map((valor) => {
      const leida = leerEtiquetaEnPdf(valor);
      if (!leida) throw new ValidationError(SIN_ETIQUETAS_MESSAGE);
      return { preparacionId: leida.preparacionId, tamanoId: leida.tamanoId, columna: leida.columna, fila: leida.fila };
    });
    pdf = await imprimirEtiquetasPdf(pedidas);
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
      "Content-Disposition": 'inline; filename="etiquetas.pdf"',
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

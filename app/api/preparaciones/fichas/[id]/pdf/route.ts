/**
 * `GET /api/preparaciones/fichas/[id]/pdf`: the ficha técnica printed from the toma workspace, with the grams to weigh
 * from each lot of the preparación (modules/preparaciones/application/imprimir-ficha-de-toma.ts). Same discipline as
 * `app/api/fichas-tecnicas/[id]/pdf/route.ts`: the URL carries only the ficha's opaque id, and the use case
 * (`fichas.imprimir`) authorizes before any data is read.
 */
import { NextResponse } from "next/server";
import { imprimirFichaDeTomaPdf } from "@/modules/preparaciones/application/imprimir-ficha-de-toma";
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

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  const requestId = crypto.randomUUID();

  let resultado;
  try {
    resultado = await imprimirFichaDeTomaPdf(id);
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  const { pdf, fichaId, version } = resultado;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      // "inline" (not "attachment"): the bench opens it to read/print, not
      // to save a file to disk. Filename carries no patient data either --
      // only the ficha id + version, same discipline as the URL itself.
      "Content-Disposition": `inline; filename="ficha-tecnica-${fichaId}-v${version}.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

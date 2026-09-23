/**
 * `GET /api/fichas-tecnicas/[id]/pdf` (M10, FASE 7 point 7.3). Serves the
 * printed ficha técnica for the bench. `[id]` is the ficha_tecnica's OPAQUE
 * uuid -- the URL never carries patient data (name, DNI, receta number),
 * satisfying the task's "never exposes patient data in the URL": everything
 * a human could read off this URL is a random id, and even that only
 * resolves to data for whoever is authorized (see below).
 *
 * Authorization is enforced by `getFichaParaImprimir` (a `defineQuery`,
 * `fichas.imprimir`), which `imprimirFichaTecnicaPdf` calls FIRST -- it runs
 * `requireSession() -> authorize() -> zod.parse -> withTenantTransaction`
 * BEFORE this handler ever sees a row, exactly like every Server Action in
 * this codebase (shared/usecase.ts). This route handler does not (and,
 * per eslint's `shared/db/transaction` restriction, MUST not) open its own
 * transaction; it also cannot import a module's infrastructure/ layer
 * directly (`appBoundaryPatterns`), which is why the PDF rendering itself
 * is behind `modules/elaboracion/application/imprimir-ficha-tecnica-pdf.ts`.
 */
import { NextResponse } from "next/server";
import { imprimirFichaTecnicaPdf } from "@/modules/elaboracion/application/imprimir-ficha-tecnica-pdf";
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
    resultado = await imprimirFichaTecnicaPdf(id);
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

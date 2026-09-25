/**
 * `GET /api/stock/valorizado/export/pdf` (FASE 13 point 13.2). Requires
 * `stock.valorizado.ver` (enforced by `exportarValorizadoPdf`'s own
 * `defineQuery`/`defineCommand`).
 */
import { NextResponse } from "next/server";
import { exportarValorizadoPdf } from "@/modules/stock/application/reporte-valorizado";
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

function resumenFiltro(q: URLSearchParams): string {
  const partes: string[] = [];
  if (q.get("search")) partes.push(`Droga: "${q.get("search")}"`);
  partes.push(q.get("incluirVencidas") !== "0" ? "Incluye vencidas" : "Excluye vencidas");
  if (q.get("soloConSaldo") === "1") partes.push("Solo con saldo");
  return partes.join(" · ");
}

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const q = url.searchParams;

  let pdf: Buffer;
  try {
    pdf = await exportarValorizadoPdf(
      { search: q.get("search") || undefined, incluirVencidas: q.get("incluirVencidas") !== "0", soloConSaldo: q.get("soloConSaldo") === "1" },
      resumenFiltro(q),
    );
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
      "Content-Disposition": `attachment; filename="stock-valorizado.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

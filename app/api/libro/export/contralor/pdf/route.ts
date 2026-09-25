/**
 * `GET /api/libro/export/contralor/pdf` (FASE 13 point 13.3). Requires
 * `libro.exportar` (enforced by `exportarContralorPdf`'s own
 * `defineQuery`/`defineCommand`).
 */
import { NextResponse } from "next/server";
import { exportarContralorPdf } from "@/modules/libro/application/exportar-contralor";
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
  if (q.get("tipoLibro")) partes.push(`Libro: ${q.get("tipoLibro")}`);
  if (q.get("drogaId")) partes.push(`Droga: ${q.get("drogaId")}`);
  if (q.get("fechaDesde") || q.get("fechaHasta")) partes.push(`Fechas: ${q.get("fechaDesde") ?? "…"} a ${q.get("fechaHasta") ?? "…"}`);
  return partes.length > 0 ? partes.join(" · ") : "Sin filtros";
}

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const q = url.searchParams;

  let pdf: Buffer;
  try {
    pdf = await exportarContralorPdf(
      {
        tipoLibro: q.get("tipoLibro") === "PSICOTROPICO" || q.get("tipoLibro") === "ESTUPEFACIENTE" ? (q.get("tipoLibro") as "PSICOTROPICO" | "ESTUPEFACIENTE") : undefined,
        drogaId: q.get("drogaId") || undefined,
        fechaDesde: q.get("fechaDesde") || undefined,
        fechaHasta: q.get("fechaHasta") || undefined,
      },
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
      "Content-Disposition": `attachment; filename="libro-contralor.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

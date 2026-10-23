/**
 * `GET /api/libro/export/contralor/pdf` (FASE 13 point 13.3). Requires
 * `libro.exportar` (enforced by `exportarContralorPdf`'s own
 * `defineQuery`/`defineCommand`).
 */
import { NextResponse } from "next/server";
import { exportarContralorPdf } from "@/modules/libro/application/exportar-contralor";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";
import { textoDeFiltro } from "@/shared/format/texto-filtro";

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

function resumenFiltro(q: URLSearchParams): string {
  const get = (clave: string) => textoDeFiltro(q.get(clave));
  const partes: string[] = [];
  if (get("tipoLibro")) partes.push(`Libro: ${get("tipoLibro")}`);
  if (get("drogaId")) partes.push(`Droga: ${get("drogaId")}`);
  if (get("fechaDesde") || get("fechaHasta")) partes.push(`Fechas: ${get("fechaDesde") || "…"} a ${get("fechaHasta") || "…"}`);
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

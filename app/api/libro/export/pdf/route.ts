/**
 * `GET /api/libro/export/pdf` (FASE 9, M12 point 9.1). Requires
 * `libro.exportar` (enforced by `exportarLibroDatos`'s own `defineQuery`).
 */
import { NextResponse } from "next/server";
import { exportarLibroPdf } from "@/modules/libro/application/exportar-libro";
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
  if (q.get("fechaDesde") || q.get("fechaHasta")) partes.push(`Fechas: ${q.get("fechaDesde") ?? "…"} a ${q.get("fechaHasta") ?? "…"}`);
  if (q.get("numeroDesde") || q.get("numeroHasta")) partes.push(`Números: ${q.get("numeroDesde") ?? "…"} a ${q.get("numeroHasta") ?? "…"}`);
  if (q.get("estado")) partes.push(`Estado: ${q.get("estado")}`);
  if (q.get("texto")) partes.push(`Texto: "${q.get("texto")}"`);
  return partes.length > 0 ? partes.join(" · ") : "Sin filtros";
}

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const q = url.searchParams;

  let pdf: Buffer;
  try {
    pdf = await exportarLibroPdf(
      {
        fechaDesde: q.get("fechaDesde") || undefined,
        fechaHasta: q.get("fechaHasta") || undefined,
        numeroDesde: q.get("numeroDesde") || undefined,
        numeroHasta: q.get("numeroHasta") || undefined,
        estado: q.get("estado") === "VIGENTE" || q.get("estado") === "ANULADO" ? (q.get("estado") as "VIGENTE" | "ANULADO") : undefined,
        texto: q.get("texto") || undefined,
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
      "Content-Disposition": `attachment; filename="libro-recetario.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

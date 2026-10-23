/**
 * `GET /api/libro/export/pdf` (FASE 9, M12 point 9.1). Requires
 * `libro.exportar` (enforced by `exportarLibroDatos`'s own `defineQuery`).
 */
import { NextResponse } from "next/server";
import { exportarLibroPdf } from "@/modules/libro/application/exportar-libro";
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
  if (get("fechaDesde") || get("fechaHasta")) partes.push(`Fechas: ${get("fechaDesde") || "…"} a ${get("fechaHasta") || "…"}`);
  if (get("numeroDesde") || get("numeroHasta")) partes.push(`Números: ${get("numeroDesde") || "…"} a ${get("numeroHasta") || "…"}`);
  if (get("estado")) partes.push(`Estado: ${get("estado")}`);
  if (get("texto")) partes.push(`Texto: "${get("texto")}"`);
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

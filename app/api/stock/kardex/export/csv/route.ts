/**
 * `GET /api/stock/kardex/export/csv` (FASE 13 point 13.2). Requires
 * `stock.ver` (enforced by `exportarKardexCsv`'s own `defineQuery`/`defineCommand`).
 * Every export is audited (`TipoAccion.EXPORTAR`).
 */
import { NextResponse } from "next/server";
import { exportarKardexCsv, MAX_EXPORT_ROWS } from "@/modules/stock/application/reporte-kardex";
import { CsvWriter } from "@/shared/csv/csv-writer";
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

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const q = url.searchParams;

  let resultado;
  try {
    resultado = await exportarKardexCsv({
      partidaId: q.get("partidaId") || undefined,
      drogaId: q.get("drogaId") || undefined,
      tipo: (q.get("tipo") as "INGRESO_COMPRA" | "EGRESO_PREPARACION" | "AJUSTE" | null) || undefined,
      desde: q.get("desde") || undefined,
      hasta: q.get("hasta") || undefined,
    });
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  const writer = new CsvWriter(["Fecha", "Droga", "Lote", "Tipo", "Cantidad", "MotivoAjuste", "Observacion", "RegistradoPor", "AutorizadoPor"]);
  for (const item of resultado.items) {
    writer.push([
      item.registradoEn.toISOString(),
      item.drogaNombre,
      item.lote,
      item.tipo,
      item.cantidad,
      item.motivoAjuste ?? "",
      item.observacion ?? "",
      `${item.registradoPorApellido}, ${item.registradoPorNombre}`,
      item.autorizadoPorNombre ? `${item.autorizadoPorApellido}, ${item.autorizadoPorNombre}` : "",
    ]);
  }
  if (resultado.truncated) {
    writer.push([`TRUNCADO: se alcanzó el máximo de ${MAX_EXPORT_ROWS} filas exportables. Acotá los filtros.`]);
  }

  const csv = writer.toString();
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kardex.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

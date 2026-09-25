/**
 * `GET /api/stock/valorizado/export/csv` (FASE 13 point 13.2). Requires
 * `stock.valorizado.ver` (enforced by `exportarValorizadoDatos`'s own
 * `defineQuery`/`defineCommand`). Every export is audited (`TipoAccion.EXPORTAR`).
 */
import { NextResponse } from "next/server";
import { exportarValorizadoDatos, MAX_EXPORT_ROWS } from "@/modules/stock/application/reporte-valorizado";
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
    resultado = await exportarValorizadoDatos({
      search: q.get("search") || undefined,
      incluirVencidas: q.get("incluirVencidas") !== "0",
      soloConSaldo: q.get("soloConSaldo") === "1",
    });
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  const writer = new CsvWriter(["Droga", "Lote", "Vencimiento", "CantidadDisponible", "Unidad", "CostoUnitario", "Valor"]);
  for (const item of resultado.items) {
    writer.push([item.drogaNombre, item.lote, item.fechaVencimiento, item.cantidadDisponible, item.unidadSimbolo, item.costoUnitario, item.valor]);
  }
  for (const subtotal of resultado.subtotales) {
    writer.push([`Subtotal ${subtotal.drogaNombre}`, "", "", "", "", "", subtotal.valorSubtotal]);
  }
  writer.push(["TOTAL GENERAL", "", "", "", "", "", resultado.granTotal]);
  if (resultado.truncated) {
    writer.push([`TRUNCADO: se alcanzó el máximo de ${MAX_EXPORT_ROWS} filas exportables. Acotá los filtros.`]);
  }

  const csv = writer.toString();
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stock-valorizado.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

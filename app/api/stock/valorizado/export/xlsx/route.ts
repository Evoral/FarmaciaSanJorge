/**
 * `GET /api/stock/valorizado/export/xlsx` (FASE 13 point 13.2). Requires
 * `stock.valorizado.ver` (enforced by `exportarValorizadoDatos`'s own
 * `defineQuery`/`defineCommand`). Every export is audited (`TipoAccion.EXPORTAR`).
 */
import { NextResponse } from "next/server";
import { exportarValorizadoDatos, MAX_EXPORT_ROWS } from "@/modules/stock/application/reporte-valorizado";
import { XLSX_CONTENT_TYPE, XlsxReport } from "@/shared/xlsx/xlsx-report";
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

  // Cantidad reservada (migration 0071) is informational: Valor is the physical saldo's.
  const report = new XlsxReport({
    title: "Stock valorizado",
    description:
      "Saldo físico de cada lote valuado a su costo unitario, con subtotal por droga y total general. La cantidad reservada por preparaciones en curso es informativa y no se descuenta del valor.",
    sheetName: "Stock valorizado",
    issuedAt: new Date(),
    filters: resultado.filtroResumen,
    columns: [
      { header: "Droga", width: 30 },
      { header: "Lote", width: 14 },
      { header: "Vencimiento", width: 13, format: "date" },
      { header: "Cantidad disponible", width: 14, format: "decimal" },
      { header: "Unidad", width: 8 },
      { header: "Costo unitario", width: 14, format: "money" },
      { header: "Valor", width: 16, format: "money" },
      { header: "Cantidad reservada", width: 14, format: "decimal" },
    ],
  });
  for (const item of resultado.items) {
    report.push([item.drogaNombre, item.lote, item.fechaVencimiento, item.cantidadDisponible, item.unidadSimbolo, item.costoUnitario, item.valor, item.cantidadReservada]);
  }
  for (const subtotal of resultado.subtotales) {
    report.pushSummary([`Subtotal ${subtotal.drogaNombre}`, null, null, null, null, null, subtotal.valorSubtotal, null], "subtotal");
  }
  report.pushSummary(["TOTAL GENERAL", null, null, null, null, null, resultado.granTotal, null], "total");
  if (resultado.truncated) {
    report.pushNote(`TRUNCADO: se alcanzó el máximo de ${MAX_EXPORT_ROWS} filas exportables. Acotá los filtros.`);
  }

  const xlsx = await report.toBuffer();
  return new NextResponse(new Uint8Array(xlsx), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="stock-valorizado.xlsx"`,
      "Content-Length": String(xlsx.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

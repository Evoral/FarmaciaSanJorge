/**
 * `GET /api/stock/kardex/export/xlsx` (FASE 13 point 13.2). Requires
 * `stock.ver` (enforced by `exportarKardexXlsx`'s own `defineQuery`/`defineCommand`).
 * Every export is audited (`TipoAccion.EXPORTAR`).
 */
import { NextResponse } from "next/server";
import { exportarKardexXlsx, MAX_EXPORT_ROWS } from "@/modules/stock/application/reporte-kardex";
import { MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";
import { TIPO_MOVIMIENTO_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { XLSX_CONTENT_TYPE, XlsxReport, type XlsxReportOptions } from "@/shared/xlsx/xlsx-report";
import { getLogoTenant, getMarcaTenant } from "@/modules/farmacia/application/get-marca-tenant";
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

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const q = url.searchParams;

  let resultado;
  let farmacia = "";
  let logo: XlsxReportOptions["logo"] = null;
  try {
    const [marca, logoTenant] = await Promise.all([getMarcaTenant(), getLogoTenant()]);
    farmacia = marca?.nombre ?? "";
    logo = logoTenant;
    resultado = await exportarKardexXlsx({
      partidaId: q.get("partidaId") || undefined,
      drogaId: q.get("drogaId") || undefined,
      tipo: (q.get("tipo") as "INGRESO_COMPRA" | "INGRESO_INICIAL" | "EGRESO_PREPARACION" | "AJUSTE" | null) || undefined,
      desde: q.get("desde") || undefined,
      hasta: q.get("hasta") || undefined,
    });
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  const report = new XlsxReport({
    farmacia,
    logo,
    title: "Kardex de movimientos de stock",
    description:
      "Movimientos de stock de cada lote: ingresos por compra, egresos por preparación y ajustes, con la cantidad, el motivo y quién los registró o autorizó.",
    sheetName: "Kardex",
    issuedAt: new Date(),
    filters: resultado.filtroResumen,
    columns: [
      { header: "Fecha", width: 17, format: "datetime" },
      { header: "Droga", width: 28 },
      { header: "Lote", width: 14 },
      { header: "Tipo", width: 22 },
      { header: "Cantidad", width: 12, format: "decimal" },
      { header: "Unidad", width: 8 },
      { header: "Motivo de ajuste", width: 20 },
      { header: "Observación", width: 32, wrap: true },
      { header: "Registrado por", width: 24 },
      { header: "Autorizado por", width: 24 },
    ],
  });
  for (const item of resultado.items) {
    report.push([
      item.registradoEn,
      item.drogaNombre,
      item.lote,
      etiquetaDe(TIPO_MOVIMIENTO_LABELS, item.tipo),
      item.cantidad,
      item.unidadSimbolo,
      item.motivoAjuste ? etiquetaDe(MOTIVO_AJUSTE_LABELS, item.motivoAjuste) : null,
      item.observacion,
      `${item.registradoPorApellido}, ${item.registradoPorNombre}`,
      item.autorizadoPorNombre ? `${item.autorizadoPorApellido}, ${item.autorizadoPorNombre}` : null,
    ]);
  }
  if (resultado.truncated) {
    report.pushNote(`TRUNCADO: se alcanzó el máximo de ${MAX_EXPORT_ROWS} filas exportables. Acotá los filtros.`);
  }

  const xlsx = await report.toBuffer();
  return new NextResponse(new Uint8Array(xlsx), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="kardex.xlsx"`,
      "Content-Length": String(xlsx.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

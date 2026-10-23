/**
 * `GET /api/recetas/reporte/export/xlsx` (FASE 13 point 13.4). Requires
 * `reportes.ver` (enforced by `exportarRecetasXlsx`'s own
 * `defineQuery`/`defineCommand`). Used by `/reportes/recetas` and by the
 * `/recetas` listado (same params: estado, numero, ingresoDesde/ingresoHasta,
 * desde/hasta, pago). No param carries patient text.
 */
import { NextResponse } from "next/server";
import { exportarRecetasXlsx, MAX_EXPORT_ROWS } from "@/modules/recetas/application/reporte-recetas";
import { ESTADOS_RECETA } from "@/modules/recetas/domain/receta";
import { etiquetaPago, parseFiltroPagoReceta } from "@/modules/recetas/domain/pago";
import { ESTADO_RECETA_LABELS, ORIGEN_RECETA_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
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
  const estadoParam = q.get("estado");
  const estado = estadoParam && (ESTADOS_RECETA as readonly string[]).includes(estadoParam) ? (estadoParam as (typeof ESTADOS_RECETA)[number]) : undefined;

  let resultado;
  let farmacia = "";
  let logo: XlsxReportOptions["logo"] = null;
  try {
    const [marca, logoTenant] = await Promise.all([getMarcaTenant(), getLogoTenant()]);
    farmacia = marca?.nombre ?? "";
    logo = logoTenant;
    resultado = await exportarRecetasXlsx({
      estado,
      numeroInterno: q.get("numero") || undefined,
      ingresoDesde: q.get("ingresoDesde") || undefined,
      ingresoHasta: q.get("ingresoHasta") || undefined,
      desde: q.get("desde") || undefined,
      hasta: q.get("hasta") || undefined,
      pago: parseFiltroPagoReceta(q.get("pago")),
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
    title: "Reporte de recetas",
    description:
      "Recetas magistrales que cumplen los filtros aplicados, con su número interno, fechas de ingreso y prescripción, estado, origen, paciente, médico y si están pagadas.",
    sheetName: "Recetas",
    issuedAt: new Date(),
    filters: resultado.filtroResumen,
    columns: [
      { header: "Nº interno", width: 12 },
      { header: "Fecha de ingreso", width: 17, format: "datetime" },
      { header: "Fecha de prescripción", width: 14, format: "date" },
      { header: "Estado", width: 26 },
      { header: "Origen", width: 18 },
      { header: "Paciente", width: 28 },
      { header: "Médico", width: 28 },
      { header: "Pago", width: 10 },
    ],
  });
  for (const item of resultado.items) {
    report.push([
      item.numeroInterno,
      item.fechaIngreso,
      item.fechaPrescripcion,
      etiquetaDe(ESTADO_RECETA_LABELS, item.estado),
      etiquetaDe(ORIGEN_RECETA_LABELS, item.origen),
      `${item.pacienteNombre} ${item.pacienteApellido}`,
      `${item.medicoApellido}, ${item.medicoNombre}`,
      etiquetaPago(item.pagada),
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
      "Content-Disposition": `attachment; filename="recetas-reporte.xlsx"`,
      "Content-Length": String(xlsx.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

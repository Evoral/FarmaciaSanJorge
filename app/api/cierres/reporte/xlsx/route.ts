/**
 * `GET /api/cierres/reporte/xlsx` (FASE 10, M13a point 10.4). Requires
 * `cierres.reporte` (enforced by `exportarReporteCumplimientoXlsx`'s own
 * `defineQuery`/`defineCommand`). Every export is audited (`TipoAccion.EXPORTAR`).
 */
import { NextResponse } from "next/server";
import { exportarReporteCumplimientoXlsx } from "@/modules/cierres/application/reporte-cumplimiento";
import { MOTIVO_DEMORA_LABELS, type MotivoDemoraValue } from "@/modules/cierres/domain/motivo-demora";
import { XLSX_CONTENT_TYPE, XlsxReport } from "@/shared/xlsx/xlsx-report";
import { getMarcaTenant } from "@/modules/farmacia/application/get-marca-tenant";
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
  try {
    farmacia = (await getMarcaTenant())?.nombre ?? "";
    resultado = await exportarReporteCumplimientoXlsx({ fechaDesde: q.get("fechaDesde") || undefined, fechaHasta: q.get("fechaHasta") || undefined });
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  const report = new XlsxReport({
    farmacia,
    title: "Reporte de cumplimiento de firma de cierres",
    description:
      "Firma del cierre diario de cada jornada por el director técnico: fecha de firma, días de demora y, cuando se firmó fuera de término, el motivo declarado.",
    sheetName: "Cumplimiento de cierres",
    issuedAt: new Date(),
    filters: resultado.filtroResumen,
    columns: [
      { header: "Jornada", width: 12, format: "date" },
      { header: "Fecha de firma", width: 17, format: "datetime" },
      { header: "Demora (días)", width: 11, format: "integer" },
      { header: "Fuera de término", width: 12 },
      { header: "Motivo", width: 24 },
      { header: "Detalle del motivo", width: 36, wrap: true },
      { header: "Director técnico", width: 26 },
    ],
  });
  for (const item of resultado.items) {
    const motivoLabel = item.motivoDemora ? MOTIVO_DEMORA_LABELS[item.motivoDemora as MotivoDemoraValue] ?? item.motivoDemora : null;
    report.push([
      item.fecha,
      item.fechaFirma,
      item.demoraDias,
      item.fueraDeTermino ? "Sí" : "No",
      motivoLabel,
      item.motivoDemoraDetalle,
      `${item.directorTecnicoApellido}, ${item.directorTecnicoNombre}`,
    ]);
  }

  const xlsx = await report.toBuffer();
  return new NextResponse(new Uint8Array(xlsx), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="reporte-cumplimiento-cierres.xlsx"`,
      "Content-Length": String(xlsx.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

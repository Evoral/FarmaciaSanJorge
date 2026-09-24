/**
 * `GET /api/cierres/reporte/csv` (FASE 10, M13a point 10.4). Requires
 * `cierres.reporte` (enforced by `exportarReporteCumplimientoCsv`'s own
 * `defineQuery`/`defineCommand`). Every export is audited (`TipoAccion.EXPORTAR`).
 */
import { NextResponse } from "next/server";
import { exportarReporteCumplimientoCsv } from "@/modules/cierres/application/reporte-cumplimiento";
import { MOTIVO_DEMORA_LABELS, type MotivoDemoraValue } from "@/modules/cierres/domain/motivo-demora";
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

  let items;
  try {
    items = await exportarReporteCumplimientoCsv({ fechaDesde: q.get("fechaDesde") || undefined, fechaHasta: q.get("fechaHasta") || undefined });
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  const writer = new CsvWriter(["Fecha", "FechaFirma", "DemoraDias", "FueraDeTermino", "Motivo", "MotivoDetalle", "DirectorTecnico"]);
  for (const item of items) {
    const motivoLabel = item.motivoDemora ? MOTIVO_DEMORA_LABELS[item.motivoDemora as MotivoDemoraValue] ?? item.motivoDemora : "";
    writer.push([
      item.fecha,
      item.fechaFirma.toISOString(),
      item.demoraDias,
      item.fueraDeTermino ? "SI" : "NO",
      motivoLabel,
      item.motivoDemoraDetalle ?? "",
      `${item.directorTecnicoApellido}, ${item.directorTecnicoNombre}`,
    ]);
  }

  const csv = writer.toString();
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reporte-cumplimiento-cierres.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

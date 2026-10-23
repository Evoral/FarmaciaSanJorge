/**
 * `GET /api/libro/export/xlsx` (FASE 9, M12 point 9.1). Requires
 * `libro.exportar` (enforced by `exportarLibroDatos`'s own `defineQuery`,
 * not re-checked here -- same "the use case is the authority" discipline
 * as every other route handler in this codebase).
 */
import { NextResponse } from "next/server";
import { exportarLibroDatos, MAX_EXPORT_ROWS } from "@/modules/libro/application/exportar-libro";
import { resolverEstadoVisualAsiento, etiquetaEstadoVisual } from "@/modules/libro/domain/estado-visual";
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
  PASOS_PENDIENTES: 403,
  INTERNAL_ERROR: 500,
};

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const q = url.searchParams;

  let resultado;
  try {
    resultado = await exportarLibroDatos({
      fechaDesde: q.get("fechaDesde") || undefined,
      fechaHasta: q.get("fechaHasta") || undefined,
      numeroDesde: q.get("numeroDesde") || undefined,
      numeroHasta: q.get("numeroHasta") || undefined,
      estado: q.get("estado") === "VIGENTE" || q.get("estado") === "ANULADO" ? (q.get("estado") as "VIGENTE" | "ANULADO") : undefined,
      texto: q.get("texto") || undefined,
    });
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  const report = new XlsxReport({
    title: "Libro recetario digital",
    description:
      "Asientos del libro recetario en orden correlativo: fecha, origen, estado (vigente, anulado o sin efecto por un rectificativo), paciente, médico y fórmula registrada.",
    sheetName: "Libro recetario",
    issuedAt: new Date(),
    filters: resultado.filtroResumen,
    columns: [
      { header: "Nº", width: 10, format: "integer" },
      { header: "Fecha", width: 12, format: "date" },
      { header: "Origen", width: 18 },
      { header: "Estado", width: 18 },
      { header: "Paciente", width: 28, wrap: true },
      { header: "Médico", width: 28, wrap: true },
      { header: "Fórmula", width: 60, wrap: true },
    ],
  });
  for (const item of resultado.items) {
    const estado = etiquetaEstadoVisual(
      resolverEstadoVisualAsiento({ estado: item.estado, anulacion: item.anulacion, rectificativoNumeroCorrelativo: item.rectificativoNumeroCorrelativo }),
    );
    const origen = item.origen === "RECTIFICATIVO" && item.asientoOriginalNumeroCorrelativo ? `Rectifica Nº ${item.asientoOriginalNumeroCorrelativo}` : "Sistema";
    report.push([item.numeroCorrelativo, item.fechaAsiento, origen, estado, item.pacienteTexto, item.medicoTexto, item.formulaTexto]);
  }
  if (resultado.truncated) {
    report.pushNote(`TRUNCADO: se alcanzó el máximo de ${MAX_EXPORT_ROWS} filas exportables. Acotá el rango de fechas o números.`);
  }

  const xlsx = await report.toBuffer();
  return new NextResponse(new Uint8Array(xlsx), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="libro-recetario.xlsx"`,
      "Content-Length": String(xlsx.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

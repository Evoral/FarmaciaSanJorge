/**
 * `GET /api/libro/export/csv` (FASE 9, M12 point 9.1). Requires
 * `libro.exportar` (enforced by `exportarLibroDatos`'s own `defineQuery`,
 * not re-checked here -- same "the use case is the authority" discipline
 * as every other route handler in this codebase).
 */
import { NextResponse } from "next/server";
import { exportarLibroDatos, MAX_EXPORT_ROWS } from "@/modules/libro/application/exportar-libro";
import { resolverEstadoVisualAsiento, etiquetaEstadoVisual } from "@/modules/libro/domain/estado-visual";
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

  const writer = new CsvWriter(["Numero", "Fecha", "Origen", "Estado", "Paciente", "Medico", "Formula"]);
  for (const item of resultado.items) {
    const estado = etiquetaEstadoVisual(
      resolverEstadoVisualAsiento({ estado: item.estado, anulacion: item.anulacion, rectificativoNumeroCorrelativo: item.rectificativoNumeroCorrelativo }),
    );
    const origen = item.origen === "RECTIFICATIVO" && item.asientoOriginalNumeroCorrelativo ? `Rectifica Nº ${item.asientoOriginalNumeroCorrelativo}` : "Sistema";
    writer.push([item.numeroCorrelativo, item.fechaAsiento, origen, estado, item.pacienteTexto, item.medicoTexto, item.formulaTexto]);
  }
  if (resultado.truncated) {
    writer.push([`TRUNCADO: se alcanzó el máximo de ${MAX_EXPORT_ROWS} filas exportables. Acotá el rango de fechas o números.`]);
  }

  const csv = writer.toString();
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="libro-recetario.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * `GET /api/recetas/reporte/export/csv` (FASE 13 point 13.4). Requires
 * `reportes.ver` (enforced by `exportarRecetasCsv`'s own
 * `defineQuery`/`defineCommand`). Used by `/reportes/recetas` and by the
 * `/recetas` listado (same params: estado, numero, ingresoDesde/ingresoHasta,
 * desde/hasta, pago). No param carries patient text.
 */
import { NextResponse } from "next/server";
import { exportarRecetasCsv, MAX_EXPORT_ROWS } from "@/modules/recetas/application/reporte-recetas";
import { ESTADOS_RECETA } from "@/modules/recetas/domain/receta";
import { etiquetaPago, parseFiltroPagoReceta } from "@/modules/recetas/domain/pago";
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
  const estadoParam = q.get("estado");
  const estado = estadoParam && (ESTADOS_RECETA as readonly string[]).includes(estadoParam) ? (estadoParam as (typeof ESTADOS_RECETA)[number]) : undefined;

  let resultado;
  try {
    resultado = await exportarRecetasCsv({
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

  const writer = new CsvWriter(["NumeroInterno", "FechaIngreso", "FechaPrescripcion", "Estado", "Origen", "Paciente", "Medico", "Pago"]);
  for (const item of resultado.items) {
    writer.push([
      item.numeroInterno,
      item.fechaIngreso.toISOString(),
      item.fechaPrescripcion.toISOString().slice(0, 10),
      item.estado,
      item.origen,
      `${item.pacienteNombre} ${item.pacienteApellido}`,
      `${item.medicoApellido}, ${item.medicoNombre}`,
      etiquetaPago(item.pagada),
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
      "Content-Disposition": `attachment; filename="recetas-reporte.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

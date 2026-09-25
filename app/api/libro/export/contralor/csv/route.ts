/**
 * `GET /api/libro/export/contralor/csv` (FASE 13 point 13.3). Requires
 * `libro.exportar` (enforced by `exportarContralorDatos`'s own
 * `defineQuery`/`defineCommand`).
 */
import { NextResponse } from "next/server";
import { exportarContralorDatos, MAX_EXPORT_ROWS } from "@/modules/libro/application/exportar-contralor";
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
    resultado = await exportarContralorDatos({
      tipoLibro: q.get("tipoLibro") === "PSICOTROPICO" || q.get("tipoLibro") === "ESTUPEFACIENTE" ? (q.get("tipoLibro") as "PSICOTROPICO" | "ESTUPEFACIENTE") : undefined,
      drogaId: q.get("drogaId") || undefined,
      fechaDesde: q.get("fechaDesde") || undefined,
      fechaHasta: q.get("fechaHasta") || undefined,
    });
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  const writer = new CsvWriter(["Numero", "Fecha", "Movimiento", "Droga", "Cantidad", "Unidad", "SaldoAnterior", "SaldoPosterior", "Vale", "AsientoRecetario"]);
  for (const item of resultado.items) {
    writer.push([
      item.numeroCorrelativo,
      item.fechaAsiento,
      item.tipoMovimiento,
      item.drogaDescripcion,
      item.cantidad,
      item.unidadSimbolo,
      item.saldoAnterior,
      item.saldoPosterior,
      item.numeroValeAdquisicion ?? "",
      item.asientoRecetarioNumero ?? "",
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
      "Content-Disposition": `attachment; filename="libro-contralor.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

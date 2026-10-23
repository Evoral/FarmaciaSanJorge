/**
 * `GET /api/libro/export/contralor/xlsx` (FASE 13 point 13.3). Requires
 * `libro.exportar` (enforced by `exportarContralorDatos`'s own
 * `defineQuery`/`defineCommand`).
 */
import { NextResponse } from "next/server";
import { exportarContralorDatos, MAX_EXPORT_ROWS } from "@/modules/libro/application/exportar-contralor";
import { TIPO_MOVIMIENTO_CONTRALOR_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
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

  const report = new XlsxReport({
    farmacia,
    title: "Libro contralor de psicotrópicos y estupefacientes",
    description:
      "Movimientos de las drogas controladas (aperturas, ingresos, egresos y ajustes), con la cantidad, el saldo anterior y posterior, el vale de adquisición y el asiento del recetario asociado.",
    sheetName: "Libro contralor",
    issuedAt: new Date(),
    filters: resultado.filtroResumen,
    columns: [
      { header: "Nº", width: 10, format: "integer" },
      { header: "Fecha", width: 12, format: "date" },
      { header: "Movimiento", width: 14 },
      { header: "Droga", width: 30 },
      { header: "Cantidad", width: 12, format: "decimal" },
      { header: "Unidad", width: 8 },
      { header: "Saldo anterior", width: 14, format: "decimal" },
      { header: "Saldo posterior", width: 14, format: "decimal" },
      { header: "Vale", width: 14 },
      { header: "Asiento recetario", width: 14, format: "integer" },
    ],
  });
  for (const item of resultado.items) {
    report.push([
      item.numeroCorrelativo,
      item.fechaAsiento,
      etiquetaDe(TIPO_MOVIMIENTO_CONTRALOR_LABELS, item.tipoMovimiento),
      item.drogaDescripcion,
      item.cantidad,
      item.unidadSimbolo,
      item.saldoAnterior,
      item.saldoPosterior,
      item.numeroValeAdquisicion,
      item.asientoRecetarioNumero,
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
      "Content-Disposition": `attachment; filename="libro-contralor.xlsx"`,
      "Content-Length": String(xlsx.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

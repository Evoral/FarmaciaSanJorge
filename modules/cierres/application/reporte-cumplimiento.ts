/**
 * `reporteCumplimiento` -- FASE 10, M13a point 10.4 (reporte de cumplimiento
 * de firma: fecha, fecha de firma, demora, fuera de término, motivo, DT).
 * Gated on `cierres.reporte`. CSV export follows the SAME "separate audited
 * defineCommand, called right after the read resolves" shape D6 established
 * for the libro recetario export (`modules/libro/application/exportar-libro.ts`) --
 * `TipoAccion.EXPORTAR`, entidad "cierre_diario_reporte" (entidadId is the
 * tenant itself, an export has no single affected row).
 */
import { z } from "zod";
import { defineQuery, defineCommand, TipoAccion } from "@/shared/usecase";
import { reporteCumplimientoFiltro } from "../domain/filtros";
import type { ReporteCumplimientoFiltroInput } from "../domain/filtros";
import { listCumplimiento } from "../infrastructure/cierre-repository";

export interface CumplimientoItem {
  fecha: string;
  fechaFirma: Date;
  demoraDias: number;
  fueraDeTermino: boolean;
  motivoDemora: string | null;
  motivoDemoraDetalle: string | null;
  directorTecnicoNombre: string;
  directorTecnicoApellido: string;
}

export const reporteCumplimientoQuery = defineQuery({
  name: "cierres.reporte.cumplimiento",
  permiso: "cierres.reporte",
  input: reporteCumplimientoFiltro,
  handler: async ({ tx, session, input }): Promise<CumplimientoItem[]> => {
    const rows = await listCumplimiento(tx, { tenantId: session.tenantId, fechaDesde: input.fechaDesde, fechaHasta: input.fechaHasta });
    return rows.map((row) => ({
      fecha: row.fecha,
      fechaFirma: row.fechaFirma,
      demoraDias: row.demoraDias,
      fueraDeTermino: row.fueraDeTermino,
      motivoDemora: row.motivoDemora,
      motivoDemoraDetalle: row.motivoDemoraDetalle,
      directorTecnicoNombre: row.directorTecnicoNombre,
      directorTecnicoApellido: row.directorTecnicoApellido,
    }));
  },
});

export async function reporteCumplimiento(input: ReporteCumplimientoFiltroInput): Promise<CumplimientoItem[]> {
  return reporteCumplimientoQuery.execute(input);
}

function resumenFiltroParaAuditoria(input: ReporteCumplimientoFiltroInput): string {
  if (!input.fechaDesde && !input.fechaHasta) return "Sin filtros";
  return `Fechas: ${input.fechaDesde ?? "…"} a ${input.fechaHasta ?? "…"}`;
}

const registrarExportacionReporteInput = z.object({
  filtroResumen: z.string(),
  cantidadFilas: z.number().int().min(0),
});

const registrarExportacionReporteCommand = defineCommand({
  name: "cierres.reporte.auditarExportacion",
  permiso: "cierres.reporte",
  input: registrarExportacionReporteInput,
  audit: { entidad: "cierre_diario_reporte", accion: TipoAccion.EXPORTAR },
  handler: async ({ session, input }) => ({
    output: undefined,
    audit: {
      entidadId: session.tenantId,
      motivo: `Exportación CSV del reporte de cumplimiento de firma -- ${input.cantidadFilas} fila(s). Filtros: ${input.filtroResumen}.`,
      valorNuevo: { filtroResumen: input.filtroResumen, cantidadFilas: input.cantidadFilas },
    },
  }),
});

export async function exportarReporteCumplimientoCsv(input: ReporteCumplimientoFiltroInput): Promise<CumplimientoItem[]> {
  const items = await reporteCumplimiento(input);
  await registrarExportacionReporteCommand.execute({ filtroResumen: resumenFiltroParaAuditoria(input), cantidadFilas: items.length });
  return items;
}

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
import { reporteCumplimientoFiltro, reporteCumplimientoPaginadoFiltro } from "../domain/filtros";
import type { ReporteCumplimientoFiltroInput, ReporteCumplimientoPaginadoFiltroInput } from "../domain/filtros";
import { listCumplimiento, listCumplimientoPaginado } from "../infrastructure/cierre-repository";

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

export interface ReporteCumplimientoPagina {
  items: CumplimientoItem[];
  total: number;
  /** Counted over every matching cierre, not only this page. */
  enTermino: number;
  fueraDeTermino: number;
}

/** The on-screen report: one page plus the totals of the whole filtered range. The CSV export stays on `reporteCumplimiento` (every row). */
export const reporteCumplimientoPaginadoQuery = defineQuery({
  name: "cierres.reporte.cumplimiento.paginado",
  permiso: "cierres.reporte",
  input: reporteCumplimientoPaginadoFiltro,
  handler: async ({ tx, session, input }): Promise<ReporteCumplimientoPagina> => {
    const result = await listCumplimientoPaginado(tx, {
      tenantId: session.tenantId,
      fechaDesde: input.fechaDesde,
      fechaHasta: input.fechaHasta,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      items: result.items,
      total: result.total,
      enTermino: result.total - result.fueraDeTermino,
      fueraDeTermino: result.fueraDeTermino,
    };
  },
});

export async function reporteCumplimientoPaginado(input: ReporteCumplimientoPaginadoFiltroInput): Promise<ReporteCumplimientoPagina> {
  return reporteCumplimientoPaginadoQuery.execute(input);
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

/**
 * `reporteRecetasPorEstado`/`listRecetasReporte` -- FASE 13 point 13.4
 * (M16). Gated on `reportes.ver` (DIRECTOR_TECNICO/FARMACEUTICO/SOLO_CONSULTA)
 * -- deliberately NOT `recetas.crear` (this is the reports surface, not
 * the operational recetas workflow; SOLO_CONSULTA has no `recetas.crear`
 * but does have `reportes.ver`, matching the task's decision 4).
 *
 * Data exposure: this report shows the SAME paciente/médico columns
 * `/recetas` already shows (`RecetaListItem`) -- no NEW patient field is
 * exposed. Filters are `estado` and a `fecha_ingreso` range only (never
 * free-text patient/médico search), so they are safe as GET query params
 * (never patient text in a URL, per the task's hard rule).
 *
 * Export (CSV) follows the SAME "separate audited defineCommand" D6 shape
 * as `modules/libro/application/exportar-libro.ts` -- `TipoAccion.EXPORTAR`,
 * entidad "receta_reporte". The audit payload carries ONLY the filter
 * summary + row count + truncated flag -- never paciente/médico text.
 */
import { z } from "zod";
import { defineQuery, defineCommand, TipoAccion } from "@/shared/usecase";
import { ESTADOS_RECETA } from "../domain/receta";
import { countRecetasPorEstado, listRecetasPorEstado } from "../infrastructure/receta-repository";
import type { RecetaListItem } from "../infrastructure/receta-repository";

export type { RecetaListItem };

/** Hard ceiling on exported rows -- same discipline/value as `modules/libro/application/exportar-libro.ts#MAX_EXPORT_ROWS`. */
export const MAX_EXPORT_ROWS = 5000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha en formato AAAA-MM-DD.");

export interface ConteoPorEstado {
  estado: (typeof ESTADOS_RECETA)[number];
  cantidad: number;
}

export const reporteRecetasPorEstadoQuery = defineQuery({
  name: "reportes.recetas.porEstado",
  permiso: "reportes.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<ConteoPorEstado[]> => {
    const rows = await countRecetasPorEstado(tx, session.tenantId);
    const porEstado = new Map(rows.map((r) => [r.estado, r.cantidad]));
    return ESTADOS_RECETA.map((estado) => ({ estado, cantidad: porEstado.get(estado) ?? 0 }));
  },
});

export async function reporteRecetasPorEstado(): Promise<ConteoPorEstado[]> {
  return reporteRecetasPorEstadoQuery.execute({});
}

const listRecetasReporteInput = z.object({
  estado: z.enum(ESTADOS_RECETA).optional(),
  ingresoDesde: isoDate.optional(),
  ingresoHasta: isoDate.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListRecetasReporteInput = z.input<typeof listRecetasReporteInput>;

export interface ListRecetasReporteResult {
  items: (RecetaListItem & { fechaIngreso: Date })[];
  total: number;
  page: number;
  pageSize: number;
}

export const listRecetasReporteQuery = defineQuery({
  name: "reportes.recetas.listar",
  permiso: "reportes.ver",
  input: listRecetasReporteInput,
  handler: async ({ tx, session, input }): Promise<ListRecetasReporteResult> => {
    return listRecetasPorEstado(tx, {
      tenantId: session.tenantId,
      estado: input.estado,
      ingresoDesde: input.ingresoDesde,
      ingresoHasta: input.ingresoHasta,
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listRecetasReporte(input: ListRecetasReporteInput): Promise<ListRecetasReporteResult> {
  return listRecetasReporteQuery.execute(input);
}

const exportarRecetasInput = listRecetasReporteInput.omit({ page: true, pageSize: true });
type ExportarRecetasFiltro = z.infer<typeof exportarRecetasInput>;
export type ExportarRecetasFiltroInput = z.input<typeof exportarRecetasInput>;

export interface ExportarRecetasResultado {
  items: (RecetaListItem & { fechaIngreso: Date })[];
  truncated: boolean;
}

export const exportarRecetasQuery = defineQuery({
  name: "reportes.recetas.exportar.datos",
  permiso: "reportes.ver",
  input: exportarRecetasInput,
  handler: async ({ tx, session, input }): Promise<ExportarRecetasResultado> => {
    const result = await listRecetasPorEstado(tx, {
      tenantId: session.tenantId,
      estado: input.estado,
      ingresoDesde: input.ingresoDesde,
      ingresoHasta: input.ingresoHasta,
      page: 1,
      pageSize: MAX_EXPORT_ROWS + 1,
    });
    const truncated = result.total > MAX_EXPORT_ROWS;
    return { items: result.items.slice(0, MAX_EXPORT_ROWS), truncated };
  },
});

function resumenFiltroParaAuditoria(input: ExportarRecetasFiltro): string {
  const partes: string[] = [];
  if (input.estado) partes.push(`Estado: ${input.estado}`);
  if (input.ingresoDesde || input.ingresoHasta) partes.push(`Fecha ingreso: ${input.ingresoDesde ?? "…"} a ${input.ingresoHasta ?? "…"}`);
  return partes.length > 0 ? partes.join(" · ") : "Sin filtros";
}

const registrarExportacionRecetasInput = z.object({
  filtroResumen: z.string(),
  cantidadFilas: z.number().int().min(0),
  truncated: z.boolean(),
});

/** Metadata-only audit write -- filter summary + row count + truncated flag, NEVER paciente/médico text (D6 discipline). */
const registrarExportacionRecetasCommand = defineCommand({
  name: "reportes.recetas.exportar.auditar",
  permiso: "reportes.ver",
  input: registrarExportacionRecetasInput,
  audit: { entidad: "receta_reporte", accion: TipoAccion.EXPORTAR },
  handler: async ({ session, input }) => ({
    output: undefined,
    audit: {
      entidadId: session.tenantId,
      motivo: `Exportación CSV del reporte de recetas por estado -- ${input.cantidadFilas} fila(s)${input.truncated ? " (truncado)" : ""}. Filtros: ${input.filtroResumen}.`,
      valorNuevo: { filtroResumen: input.filtroResumen, cantidadFilas: input.cantidadFilas, truncated: input.truncated },
    },
  }),
});

export async function exportarRecetasCsv(input: ExportarRecetasFiltroInput): Promise<ExportarRecetasResultado> {
  const resultado = await exportarRecetasQuery.execute(input);
  const parsed = exportarRecetasInput.parse(input);
  await registrarExportacionRecetasCommand.execute({
    filtroResumen: resumenFiltroParaAuditoria(parsed),
    cantidadFilas: resultado.items.length,
    truncated: resultado.truncated,
  });
  return resultado;
}

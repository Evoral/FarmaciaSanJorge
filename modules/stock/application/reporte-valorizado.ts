/**
 * `reporteValorizado` -- FASE 13 point 13.2 (M16). Stock valorizado por
 * partida, "valorizado al costo actual de cada partida" (no cost history
 * exists -- a single `costo_unitario` per partida, corrected in place by
 * `modules/stock/application/corregir-costo-partida.ts` -- so this report
 * is a snapshot, never a historical value). Gated on `stock.valorizado.ver`
 * (migration 0043, ADMINISTRADOR/DIRECTOR_TECNICO/FARMACEUTICO only).
 *
 * Export (CSV/PDF) follows the SAME "separate audited defineCommand,
 * called right after the read resolves" shape D6 established for the
 * libro recetario export (`modules/libro/application/exportar-libro.ts`) --
 * `TipoAccion.EXPORTAR`, entidad "stock_valorizado_reporte" (entidadId is
 * the tenant itself). No patient/paciente data exists in this report at
 * all, so the audit payload risk that pattern guards against does not
 * even apply here -- it is followed anyway for consistency.
 */
import { z } from "zod";
import { defineQuery, defineCommand, TipoAccion } from "@/shared/usecase";
import { sumarValores } from "../domain/valorizado";
import {
  listValorizado,
  subtotalesValorizado,
  iterarValorizadoParaExportar,
} from "../infrastructure/valorizado-repository";
import { buildValorizadoPdf } from "../infrastructure/valorizado-pdf";
import type { ValorizadoItem, ValorizadoSubtotal, ValorizadoFilter } from "../infrastructure/valorizado-repository";

export type { ValorizadoItem, ValorizadoSubtotal };

/** Hard ceiling on exported rows -- same discipline/value as `modules/libro/application/exportar-libro.ts#MAX_EXPORT_ROWS`. */
export const MAX_EXPORT_ROWS = 5000;
const EXPORT_PAGE_SIZE = 500;

const paginacion = {
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
};

const reporteValorizadoFiltro = z.object({
  search: z.string().trim().max(200).optional(),
  incluirVencidas: z.boolean().default(true),
  soloConSaldo: z.boolean().default(false),
  ...paginacion,
});

export type ReporteValorizadoFiltroInput = z.input<typeof reporteValorizadoFiltro>;
type ReporteValorizadoFiltro = z.infer<typeof reporteValorizadoFiltro>;

function toRepoFilter(tenantId: string, input: Pick<ReporteValorizadoFiltro, "search" | "incluirVencidas" | "soloConSaldo">): ValorizadoFilter {
  return { tenantId, search: input.search, incluirVencidas: input.incluirVencidas, soloConSaldo: input.soloConSaldo };
}

export interface ReporteValorizadoResultado {
  items: ValorizadoItem[];
  total: number;
  page: number;
  pageSize: number;
  subtotales: ValorizadoSubtotal[];
  /** Sum of `subtotales`, via exact Decimal addition (`sumarValores`) -- see `modules/stock/domain/valorizado.ts`'s doc comment on why this counts as "computed with numeric, no float" even though the addition itself runs in JS. */
  granTotal: string;
}

export const reporteValorizadoQuery = defineQuery({
  name: "stock.valorizado.listar",
  permiso: "stock.valorizado.ver",
  input: reporteValorizadoFiltro,
  handler: async ({ tx, session, input }): Promise<ReporteValorizadoResultado> => {
    const filtro = toRepoFilter(session.tenantId, input);
    const [{ items, total }, subtotales] = await Promise.all([
      listValorizado(tx, filtro, input.page, input.pageSize),
      subtotalesValorizado(tx, filtro),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize, subtotales, granTotal: sumarValores(subtotales.map((s) => s.valorSubtotal)) };
  },
});

export async function reporteValorizado(input: ReporteValorizadoFiltroInput): Promise<ReporteValorizadoResultado> {
  return reporteValorizadoQuery.execute(input);
}

const exportarValorizadoFiltro = reporteValorizadoFiltro.omit({ page: true, pageSize: true });
export type ExportarValorizadoFiltroInput = z.input<typeof exportarValorizadoFiltro>;
type ExportarValorizadoFiltro = z.infer<typeof exportarValorizadoFiltro>;

export interface ExportarValorizadoResultado {
  items: ValorizadoItem[];
  subtotales: ValorizadoSubtotal[];
  granTotal: string;
  truncated: boolean;
}

export const exportarValorizadoQuery = defineQuery({
  name: "stock.valorizado.exportar.datos",
  permiso: "stock.valorizado.ver",
  input: exportarValorizadoFiltro,
  handler: async ({ tx, session, input }): Promise<ExportarValorizadoResultado> => {
    const filtro = toRepoFilter(session.tenantId, input);
    const items: ValorizadoItem[] = [];
    let truncated = false;
    for await (const page of iterarValorizadoParaExportar(tx, filtro, EXPORT_PAGE_SIZE)) {
      for (const item of page) {
        if (items.length >= MAX_EXPORT_ROWS) {
          truncated = true;
          break;
        }
        items.push(item);
      }
      if (truncated) break;
    }
    const subtotales = await subtotalesValorizado(tx, filtro);
    return { items, subtotales, granTotal: sumarValores(subtotales.map((s) => s.valorSubtotal)), truncated };
  },
});

function resumenFiltroParaAuditoria(input: ExportarValorizadoFiltro): string {
  const partes: string[] = [];
  if (input.search) partes.push(`Droga: "${input.search}"`);
  partes.push(input.incluirVencidas ? "Incluye vencidas" : "Excluye vencidas");
  if (input.soloConSaldo) partes.push("Solo con saldo");
  return partes.join(" · ");
}

const registrarExportacionValorizadoInput = z.object({
  formato: z.enum(["CSV", "PDF"]),
  filtroResumen: z.string(),
  cantidadFilas: z.number().int().min(0),
  truncated: z.boolean(),
});

/** Metadata-only audit write -- filter summary + row count + truncated flag, NEVER the actual exported rows (same discipline as `exportar-libro.ts`'s D6 pattern, even though this report has no patient data to protect). */
const registrarExportacionValorizadoCommand = defineCommand({
  name: "stock.valorizado.exportar.auditar",
  permiso: "stock.valorizado.ver",
  input: registrarExportacionValorizadoInput,
  audit: { entidad: "stock_valorizado_reporte", accion: TipoAccion.EXPORTAR },
  handler: async ({ session, input }) => ({
    output: undefined,
    audit: {
      entidadId: session.tenantId,
      motivo: `Exportación ${input.formato} del reporte de stock valorizado -- ${input.cantidadFilas} fila(s)${input.truncated ? " (truncado)" : ""}. Filtros: ${input.filtroResumen}.`,
      valorNuevo: { formato: input.formato, filtroResumen: input.filtroResumen, cantidadFilas: input.cantidadFilas, truncated: input.truncated },
    },
  }),
});

export async function exportarValorizadoDatos(input: ExportarValorizadoFiltroInput, formato: "CSV" | "PDF" = "CSV"): Promise<ExportarValorizadoResultado> {
  const resultado = await exportarValorizadoQuery.execute(input);
  const parsed = exportarValorizadoFiltro.parse(input);
  await registrarExportacionValorizadoCommand.execute({
    formato,
    filtroResumen: resumenFiltroParaAuditoria(parsed),
    cantidadFilas: resultado.items.length,
    truncated: resultado.truncated,
  });
  return resultado;
}

/**
 * Renders the export as a PDF -- the ONLY entry point
 * `app/api/stock/valorizado/export/pdf/route.ts` uses (eslint's
 * `appBoundaryPatterns` forbids `app/**` from importing a module's
 * `infrastructure/` layer directly).
 */
export async function exportarValorizadoPdf(input: ExportarValorizadoFiltroInput, filtroResumen: string): Promise<Buffer> {
  const resultado = await exportarValorizadoDatos(input, "PDF");
  return buildValorizadoPdf(resultado.items, { filtroResumen, subtotales: resultado.subtotales, granTotal: resultado.granTotal, truncated: resultado.truncated });
}

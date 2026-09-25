/**
 * `exportarKardexCsv` -- FASE 13 point 13.2 (M16). The kardex query itself
 * (`kardexMovimientos`, `stock.ver`) already exists and is consumed by
 * `/stock/partidas/[id]`'s per-partida panel, but there is no
 * droga/tipo/date-filterable REPORT page or export. This file adds the
 * audited CSV export on top of the SAME query/repository, walking pages
 * internally (same "separate audited defineCommand, called right after
 * the read resolves" shape D6 established for the libro recetario export).
 */
import { z } from "zod";
import { defineQuery, defineCommand, TipoAccion } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { kardexMovimientos as kardexMovimientosRepo } from "../infrastructure/partida-repository";
import type { KardexItem } from "../infrastructure/partida-repository";

export type { KardexItem };

/** Hard ceiling on exported rows -- same discipline/value as `modules/libro/application/exportar-libro.ts#MAX_EXPORT_ROWS`. */
export const MAX_EXPORT_ROWS = 5000;
const EXPORT_PAGE_SIZE = 500;

const TIPOS_MOVIMIENTO = ["INGRESO_COMPRA", "EGRESO_PREPARACION", "AJUSTE"] as const;

const exportarKardexFiltro = z.object({
  partidaId: uuid.optional(),
  drogaId: uuid.optional(),
  tipo: z.enum(TIPOS_MOVIMIENTO).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ExportarKardexFiltroInput = z.input<typeof exportarKardexFiltro>;
type ExportarKardexFiltro = z.infer<typeof exportarKardexFiltro>;

export interface ExportarKardexResultado {
  items: KardexItem[];
  truncated: boolean;
}

export const exportarKardexQuery = defineQuery({
  name: "stock.kardex.exportar.datos",
  permiso: "stock.ver",
  input: exportarKardexFiltro,
  handler: async ({ tx, session, input }): Promise<ExportarKardexResultado> => {
    const items: KardexItem[] = [];
    let truncated = false;
    let page = 1;
    for (;;) {
      const result = await kardexMovimientosRepo(tx, {
        tenantId: session.tenantId,
        partidaId: input.partidaId,
        drogaId: input.drogaId,
        tipo: input.tipo,
        desde: input.desde,
        hasta: input.hasta,
        page,
        pageSize: EXPORT_PAGE_SIZE,
      });
      for (const item of result.items) {
        if (items.length >= MAX_EXPORT_ROWS) {
          truncated = true;
          break;
        }
        items.push(item);
      }
      if (truncated || result.items.length < EXPORT_PAGE_SIZE) break;
      page += 1;
    }
    return { items, truncated };
  },
});

function resumenFiltroParaAuditoria(input: ExportarKardexFiltro): string {
  const partes: string[] = [];
  if (input.drogaId) partes.push(`Droga: ${input.drogaId}`);
  if (input.partidaId) partes.push(`Partida: ${input.partidaId}`);
  if (input.tipo) partes.push(`Tipo: ${input.tipo}`);
  if (input.desde || input.hasta) partes.push(`Fechas: ${input.desde ?? "…"} a ${input.hasta ?? "…"}`);
  return partes.length > 0 ? partes.join(" · ") : "Sin filtros";
}

const registrarExportacionKardexInput = z.object({
  filtroResumen: z.string(),
  cantidadFilas: z.number().int().min(0),
  truncated: z.boolean(),
});

/** Metadata-only audit write -- filter summary + row count + truncated flag, never patient/paciente text (this report has none, but same discipline as every other export command). */
const registrarExportacionKardexCommand = defineCommand({
  name: "stock.kardex.exportar.auditar",
  permiso: "stock.ver",
  input: registrarExportacionKardexInput,
  audit: { entidad: "stock_kardex_reporte", accion: TipoAccion.EXPORTAR },
  handler: async ({ session, input }) => ({
    output: undefined,
    audit: {
      entidadId: session.tenantId,
      motivo: `Exportación CSV del reporte de kardex -- ${input.cantidadFilas} fila(s)${input.truncated ? " (truncado)" : ""}. Filtros: ${input.filtroResumen}.`,
      valorNuevo: { filtroResumen: input.filtroResumen, cantidadFilas: input.cantidadFilas, truncated: input.truncated },
    },
  }),
});

export async function exportarKardexCsv(input: ExportarKardexFiltroInput): Promise<ExportarKardexResultado> {
  const resultado = await exportarKardexQuery.execute(input);
  const parsed = exportarKardexFiltro.parse(input);
  await registrarExportacionKardexCommand.execute({
    filtroResumen: resumenFiltroParaAuditoria(parsed),
    cantidadFilas: resultado.items.length,
    truncated: resultado.truncated,
  });
  return resultado;
}

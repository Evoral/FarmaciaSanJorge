/**
 * `exportarContralorDatos` -- FASE 13 point 13.3 (M16). PDF/CSV export of
 * the libro contralor listing, mirroring `exportar-libro.ts`'s D6 shape
 * exactly: gated on `libro.exportar` (separate from `list-contralor.ts`'s
 * `libro.ver`), walks every matching page internally via
 * `iterarAsientosContralorParaExportar`, capped at `MAX_EXPORT_ROWS`, and
 * every export is audited via a SEPARATE `defineCommand` (`TipoAccion.EXPORTAR`)
 * called right after the read resolves -- entidad "libro_contralor",
 * entidadId the tenant itself (an export has no single affected row).
 */
import { z } from "zod";
import { defineQuery, defineCommand, TipoAccion } from "@/shared/usecase";
import { listContralorFiltro } from "../domain/filtros";
import { iterarAsientosContralorParaExportar } from "../infrastructure/contralor-repository";
import { buildContralorPdf } from "../infrastructure/contralor-pdf";
import type { ContralorListItem } from "../infrastructure/contralor-repository";
import type { ListContralorFiltro } from "../domain/filtros";

/** Hard ceiling on exported rows -- same discipline/value as `modules/libro/application/exportar-libro.ts#MAX_EXPORT_ROWS`. */
export const MAX_EXPORT_ROWS = 5000;
const EXPORT_PAGE_SIZE = 500;

const exportarContralorFiltro = listContralorFiltro.omit({ page: true, pageSize: true });
export type ExportarContralorFiltroInput = z.input<typeof exportarContralorFiltro>;
type ExportarContralorFiltro = z.infer<typeof exportarContralorFiltro>;

export interface ExportarContralorResultado {
  items: ContralorListItem[];
  truncated: boolean;
}

export const exportarContralorQuery = defineQuery({
  name: "libro.contralor.exportar.datos",
  permiso: "libro.exportar",
  input: exportarContralorFiltro,
  handler: async ({ tx, session, input }): Promise<ExportarContralorResultado> => {
    const items: ContralorListItem[] = [];
    let truncated = false;
    for await (const page of iterarAsientosContralorParaExportar(tx, session.tenantId, input, EXPORT_PAGE_SIZE)) {
      for (const item of page) {
        if (items.length >= MAX_EXPORT_ROWS) {
          truncated = true;
          break;
        }
        items.push(item);
      }
      if (truncated) break;
    }
    return { items, truncated };
  },
});

function resumenFiltroParaAuditoria(input: ExportarContralorFiltro): string {
  const partes: string[] = [];
  if (input.tipoLibro) partes.push(`Libro: ${input.tipoLibro}`);
  if (input.drogaId) partes.push(`Droga: ${input.drogaId}`);
  if (input.fechaDesde || input.fechaHasta) partes.push(`Fechas: ${input.fechaDesde ?? "…"} a ${input.fechaHasta ?? "…"}`);
  return partes.length > 0 ? partes.join(" · ") : "Sin filtros";
}

const registrarExportacionContralorInput = z.object({
  formato: z.enum(["CSV", "PDF"]),
  filtroResumen: z.string(),
  cantidadFilas: z.number().int().min(0),
  truncated: z.boolean(),
});

/** D6-shaped audit write, entidad "libro_contralor" -- metadata only (filter summary, row count, truncated flag), never the exported rows themselves. */
const registrarExportacionContralorCommand = defineCommand({
  name: "libro.contralor.exportar.auditar",
  permiso: "libro.exportar",
  input: registrarExportacionContralorInput,
  audit: { entidad: "libro_contralor", accion: TipoAccion.EXPORTAR },
  handler: async ({ session, input }) => ({
    output: undefined,
    audit: {
      entidadId: session.tenantId,
      motivo: `Exportación ${input.formato} del libro contralor -- ${input.cantidadFilas} fila(s)${input.truncated ? " (truncado)" : ""}. Filtros: ${input.filtroResumen}.`,
      valorNuevo: { formato: input.formato, filtroResumen: input.filtroResumen, cantidadFilas: input.cantidadFilas, truncated: input.truncated },
    },
  }),
});

export async function exportarContralorDatos(input: ExportarContralorFiltroInput, formato: "CSV" | "PDF" = "CSV"): Promise<ExportarContralorResultado> {
  const resultado = await exportarContralorQuery.execute(input);
  const parsed = exportarContralorFiltro.parse(input);
  await registrarExportacionContralorCommand.execute({
    formato,
    filtroResumen: resumenFiltroParaAuditoria(parsed),
    cantidadFilas: resultado.items.length,
    truncated: resultado.truncated,
  });
  return resultado;
}

/**
 * Renders the export as a PDF -- the ONLY entry point
 * `app/api/libro/export/contralor/pdf/route.ts` uses (eslint's
 * `appBoundaryPatterns` forbids `app/**` from importing a module's
 * `infrastructure/` layer directly).
 */
export async function exportarContralorPdf(input: ExportarContralorFiltroInput, filtroResumen: string): Promise<Buffer> {
  const resultado = await exportarContralorDatos(input, "PDF");
  return buildContralorPdf(resultado.items, { filtroResumen, truncated: resultado.truncated });
}

export type { ListContralorFiltro };

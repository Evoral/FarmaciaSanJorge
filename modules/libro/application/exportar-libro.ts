/**
 * `exportarLibroDatos` -- FASE 9, M12 point 9.1 (PDF/CSV export). Gated on
 * `libro.exportar` (separate from `libro.ver`'s list query -- same
 * filters, no pagination: walks EVERY matching page internally via
 * `iterarAsientosParaExportar`, capped at `MAX_EXPORT_ROWS` so an
 * unbounded filter (e.g. no date range on a years-old book) cannot hold an
 * unbounded result set in memory or produce an unusable multi-hundred-MB
 * file. `truncated: true` tells the caller (the route handler) to say so
 * to the user instead of silently serving a partial book.
 *
 * D6 (user decision, 2026-09-23): DP-27 RESOLVED -- every export (CSV and
 * PDF) is now audited, via `registrarExportacionLibroCommand` below. It is
 * a SEPARATE `defineCommand` (not folded into `exportarLibroQuery`, which
 * stays a `defineQuery` -- `shared/usecase.ts`'s queries never call
 * `audit.record`), called from `exportarLibroDatos` right after the read
 * resolves, so BOTH the CSV route (which calls `exportarLibroDatos`
 * directly) and the PDF route (via `exportarLibroPdf`, which also goes
 * through `exportarLibroDatos`) are covered from ONE place. This means the
 * read and its audit row are two separate transactions (a `defineQuery`
 * execute, then a `defineCommand` execute) -- acceptable here: an export
 * audit trail is a log of "this happened", not a legal invariant that
 * must be atomic with the read it describes.
 */
import { z } from "zod";
import { defineQuery, defineCommand, TipoAccion } from "@/shared/usecase";
import { exportarLibroFiltro } from "../domain/filtros";
import { iterarAsientosParaExportar } from "../infrastructure/asiento-repository";
import { buildLibroPdf } from "../infrastructure/libro-pdf";
import type { AsientoListItem } from "../infrastructure/asiento-repository";
import type { ExportarLibroFiltroInput } from "../domain/filtros";

/** Hard ceiling on exported rows -- see module doc comment. */
export const MAX_EXPORT_ROWS = 5000;
const EXPORT_PAGE_SIZE = 500;

export interface ExportarLibroResultado {
  items: AsientoListItem[];
  truncated: boolean;
}

export const exportarLibroQuery = defineQuery({
  name: "libro.exportar.datos",
  permiso: "libro.exportar",
  input: exportarLibroFiltro,
  handler: async ({ tx, session, input }): Promise<ExportarLibroResultado> => {
    const items: AsientoListItem[] = [];
    let truncated = false;
    for await (const page of iterarAsientosParaExportar(tx, session.tenantId, input, EXPORT_PAGE_SIZE)) {
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

/** Plain-text summary of the filters actually applied -- used only for the D6 audit `motivo`/`contexto` (independent of the PDF route's own display-oriented `resumenFiltro`). */
function resumenFiltroParaAuditoria(input: ExportarLibroFiltroInput): string {
  const partes: string[] = [];
  if (input.fechaDesde || input.fechaHasta) partes.push(`Fechas: ${input.fechaDesde ?? "…"} a ${input.fechaHasta ?? "…"}`);
  if (input.numeroDesde !== undefined || input.numeroHasta !== undefined) partes.push(`Números: ${input.numeroDesde ?? "…"} a ${input.numeroHasta ?? "…"}`);
  if (input.estado) partes.push(`Estado: ${input.estado}`);
  if (input.texto) partes.push(`Texto: "${input.texto}"`);
  return partes.length > 0 ? partes.join(" · ") : "Sin filtros";
}

const registrarExportacionLibroInput = z.object({
  formato: z.enum(["CSV", "PDF"]),
  filtroResumen: z.string(),
  cantidadFilas: z.number().int().min(0),
  truncated: z.boolean(),
});

/** D6: the ONE audit write for every libro recetario export, entidad "libro_recetario" -- entidadId is the tenant itself (an export has no single affected row). */
const registrarExportacionLibroCommand = defineCommand({
  name: "libro.exportar.auditar",
  permiso: "libro.exportar",
  input: registrarExportacionLibroInput,
  audit: { entidad: "libro_recetario", accion: TipoAccion.EXPORTAR },
  handler: async ({ session, input }) => {
    return {
      output: undefined,
      audit: {
        entidadId: session.tenantId,
        motivo: `Exportación ${input.formato} del libro recetario -- ${input.cantidadFilas} fila(s)${input.truncated ? " (truncado)" : ""}. Filtros: ${input.filtroResumen}.`,
        valorNuevo: { formato: input.formato, filtroResumen: input.filtroResumen, cantidadFilas: input.cantidadFilas, truncated: input.truncated },
      },
    };
  },
});

export async function exportarLibroDatos(input: ExportarLibroFiltroInput, formato: "CSV" | "PDF" = "CSV"): Promise<ExportarLibroResultado> {
  const resultado = await exportarLibroQuery.execute(input);
  await registrarExportacionLibroCommand.execute({
    formato,
    filtroResumen: resumenFiltroParaAuditoria(input),
    cantidadFilas: resultado.items.length,
    truncated: resultado.truncated,
  });
  return resultado;
}

/**
 * Renders the export as a PDF -- the ONLY entry point
 * `app/api/libro/export/pdf/route.ts` uses (eslint's `appBoundaryPatterns`
 * forbids `app/**` from importing a module's `infrastructure/` layer
 * directly, same discipline as
 * `modules/preparaciones/application/imprimir-etiqueta-pdf.ts`).
 */
export async function exportarLibroPdf(input: ExportarLibroFiltroInput, filtroResumen: string): Promise<Buffer> {
  const resultado = await exportarLibroDatos(input, "PDF");
  return buildLibroPdf(resultado.items, { filtroResumen, truncated: resultado.truncated });
}

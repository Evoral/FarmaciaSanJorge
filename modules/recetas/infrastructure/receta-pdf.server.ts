/**
 * Receta PDF text extraction (docs/specs/importacion-receta-pdf.md,
 * "Pieza 1"): the shared extractor (shared/pdf/extraer-texto-pdf.server.ts)
 * with the receta's page limit and messages. Interpretation is the pure
 * parser's job (../domain/receta-pdf-parser.ts).
 */
import "server-only";
import { extraerTextoPdf } from "@/shared/pdf/extraer-texto-pdf.server";
import { MAX_PDF_PAGINAS, MENSAJES_ARCHIVO_PDF } from "../domain/archivo-receta-pdf";
import type { RecetaPdfInput } from "../domain/receta-pdf-parser";

export async function extraerTextoRecetaPdf(bytes: Uint8Array): Promise<RecetaPdfInput> {
  return extraerTextoPdf(bytes, { maxPaginas: MAX_PDF_PAGINAS, mensajes: MENSAJES_ARCHIVO_PDF });
}

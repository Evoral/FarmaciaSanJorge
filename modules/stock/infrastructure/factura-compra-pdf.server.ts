/** Supplier invoice PDF text extraction: the shared extractor with the invoice's page limit and messages. */
import "server-only";
import { extraerTextoPdf, type TextoPdf } from "@/shared/pdf/extraer-texto-pdf.server";
import { MAX_FACTURA_PDF_PAGINAS, MENSAJES_ARCHIVO_FACTURA } from "../domain/factura-compra-pdf-parser";

export async function extraerTextoFacturaPdf(bytes: Uint8Array): Promise<TextoPdf> {
  return extraerTextoPdf(bytes, { maxPaginas: MAX_FACTURA_PDF_PAGINAS, mensajes: MENSAJES_ARCHIVO_FACTURA });
}

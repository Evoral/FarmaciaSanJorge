/**
 * Positioned-text extraction from an uploaded PDF, shared by every PDF
 * import (recetas: modules/recetas/infrastructure/receta-pdf.server.ts;
 * facturas de compra: modules/stock/infrastructure/factura-compra-pdf.server.ts).
 * `unpdf` (a serverless pdf.js build: no worker, no canvas) -> text items
 * per page plus the URIs of the document's `Link` annotations. Interpreting
 * them is each module's pure parser's job.
 *
 * Coordinates: pdf.js places each text item with a `transform` matrix in
 * PDF user space (origin bottom-left, `transform[4..5]` = the baseline
 * start). The page viewport at scale 1 converts that point to the
 * top-left, y-down space the parsers expect (it also absorbs a cropbox
 * offset or page rotation); the item's top edge is then its baseline minus
 * its height.
 *
 * The bytes are only held in memory; a document needing an OPEN password
 * is rejected with `mensajes.protegido` (an owner/permissions-only password
 * opens with the empty user password and reads fine).
 */
import "server-only";
import { ValidationError } from "@/shared/errors";

export interface TextoPdfItem {
  str: string;
  /** Top-left origin, y grows downward (PDF points). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextoPdf {
  pages: TextoPdfItem[][];
  links: { uri: string }[];
}

export interface OpcionesExtraccionPdf {
  maxPaginas: number;
  mensajes: { protegido: string; ilegible: string; demasiadasPaginas: string };
}

function esErrorDeContrasena(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "PasswordException";
}

export async function extraerTextoPdf(bytes: Uint8Array, { maxPaginas, mensajes }: OpcionesExtraccionPdf): Promise<TextoPdf> {
  // Loaded lazily: the pdf.js build is large and only the import actions need it.
  const { getDocumentProxy } = await import("unpdf");

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js may transfer (detach) the buffer it is handed -- give it a copy.
    // verbosity 0 (errors only): pdf.js must not chatter about a document
    // that may carry patient data into the server logs (DP-24).
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  } catch (error) {
    throw new ValidationError(esErrorDeContrasena(error) ? mensajes.protegido : mensajes.ilegible);
  }

  try {
    if (pdf.numPages > maxPaginas) throw new ValidationError(mensajes.demasiadasPaginas);

    const pages: TextoPdfItem[][] = [];
    const links: { uri: string }[] = [];
    for (let numero = 1; numero <= pdf.numPages; numero++) {
      const page = await pdf.getPage(numero);
      const viewport = page.getViewport({ scale: 1 });
      const contenido = await page.getTextContent();

      const items: TextoPdfItem[] = [];
      for (const item of contenido.items) {
        if (!("str" in item) || item.str.trim().length === 0) continue;
        const [, , c, d, e, f] = item.transform as number[];
        const height = item.height > 0 ? item.height : Math.hypot(c ?? 0, d ?? 0);
        const [x, baseline] = viewport.convertToViewportPoint(e ?? 0, f ?? 0) as [number, number];
        items.push({ str: item.str, x, y: baseline - height, width: item.width, height });
      }
      pages.push(items);

      for (const anotacion of (await page.getAnnotations()) as { subtype?: string; url?: unknown; unsafeUrl?: unknown }[]) {
        if (anotacion.subtype !== "Link") continue;
        const uri = typeof anotacion.url === "string" ? anotacion.url : typeof anotacion.unsafeUrl === "string" ? anotacion.unsafeUrl : null;
        if (uri) links.push({ uri });
      }
    }
    return { pages, links };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(mensajes.ilegible);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

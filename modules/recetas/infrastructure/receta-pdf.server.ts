/**
 * Receta PDF text extraction (docs/specs/importacion-receta-pdf.md,
 * "Pieza 1"). `unpdf` (a serverless pdf.js build: no worker, no canvas) ->
 * the parser's input shape, nothing more: positioned text items per page
 * and the URIs of the document's `Link` annotations. Interpretation is
 * the pure parser's job (../domain/receta-pdf-parser.ts).
 *
 * Coordinates: pdf.js places each text item with a `transform` matrix in
 * PDF user space (origin bottom-left, `transform[4..5]` = the baseline
 * start). The page viewport at scale 1 converts that point to the
 * top-left, y-down space the parser expects (it also absorbs a cropbox
 * offset or page rotation); the item's top edge is then its baseline minus
 * its height.
 *
 * The bytes are only held in memory; a document needing an OPEN password
 * is rejected as "PDF protegido" (an owner/permissions-only password, like
 * RCTA's AES-128 one, opens with the empty user password and reads fine).
 */
import "server-only";
import { ValidationError } from "@/shared/errors";
import { MAX_PDF_PAGINAS, MENSAJES_ARCHIVO_PDF } from "../domain/archivo-receta-pdf";
import type { LinkLite, RecetaPdfInput, TextItemLite } from "../domain/receta-pdf-parser";

function esErrorDeContrasena(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "PasswordException";
}

export async function extraerTextoRecetaPdf(bytes: Uint8Array): Promise<RecetaPdfInput> {
  // Loaded lazily: the pdf.js build is large and only this action needs it.
  const { getDocumentProxy } = await import("unpdf");

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js may transfer (detach) the buffer it is handed -- give it a copy.
    // verbosity 0 (errors only): pdf.js must not chatter about a document
    // that carries patient data into the server logs (DP-24).
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  } catch (error) {
    throw new ValidationError(esErrorDeContrasena(error) ? MENSAJES_ARCHIVO_PDF.protegido : MENSAJES_ARCHIVO_PDF.ilegible);
  }

  try {
    if (pdf.numPages > MAX_PDF_PAGINAS) throw new ValidationError(MENSAJES_ARCHIVO_PDF.demasiadasPaginas);

    const pages: TextItemLite[][] = [];
    const links: LinkLite[] = [];
    for (let numero = 1; numero <= pdf.numPages; numero++) {
      const page = await pdf.getPage(numero);
      const viewport = page.getViewport({ scale: 1 });
      const contenido = await page.getTextContent();

      const items: TextItemLite[] = [];
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
    throw new ValidationError(MENSAJES_ARCHIVO_PDF.ilegible);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Generic server-side PDF rendering helper (plan §8 `shared/pdf/`, FASE 7
 * point 7.3). Wraps `pdfkit` -- chosen over `@react-pdf/renderer`/`pdfmake`
 * (the plan's own §8 candidates) because it needs NO bundled font assets:
 * PDFKit's standard 14 fonts (Helvetica, Helvetica-Bold, ...) are metrics
 * built into the library and don't need to be embedded to render correctly
 * in any PDF reader, so a route handler can produce a document with zero
 * extra binary files in the repo. It is also the actively-maintained engine
 * `pdfmake` itself is built on (pdfmake just adds a declarative
 * document-definition layer + font-file requirement on top), so this is the
 * smaller dependency for a single, hand-laid-out technical document -- see
 * the delivery report for the full comparison.
 *
 * `renderPdf` collects the whole document into memory before resolving
 * (buffering, not streaming) -- a ficha técnica is at most a few pages, so
 * this keeps the route handler simple (one Buffer, one Content-Length)
 * instead of piping a Node stream through a Web `Response`.
 */
import PDFDocument from "pdfkit";

export type BuildPdf = (doc: PDFKit.PDFDocument) => void;

/** Runs `build` against a fresh `PDFDocument`, then resolves with the complete rendered PDF as a `Buffer`. Rejects if `build` throws or the underlying stream errors. */
export function renderPdf(build: BuildPdf, options?: PDFKit.PDFDocumentOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, ...options });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      build(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

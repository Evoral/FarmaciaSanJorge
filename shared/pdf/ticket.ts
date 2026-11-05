/**
 * Geometry of the lab's 80 mm thermal receipt printer (POS80), shared by every ticket it prints: the ficha técnica
 * (modules/elaboracion/infrastructure/ficha-pdf.ts) and the cotización handed to a walk-in client
 * (modules/recetas/infrastructure/ticket-cotizacion-pdf.ts). Black only, no shading: thermal printers have no greys.
 *
 * A receipt roll has no page height, so `renderTicketPdf` runs the layout once on a very tall page to measure it,
 * then again on a page of the measured height.
 */
import { renderPdf } from "./pdf-document";

const PUNTOS_POR_MM = 72 / 25.4;
export const mm = (valor: number) => valor * PUNTOS_POR_MM;

export const ANCHO_PAGINA = mm(80);
/** Top and bottom. */
export const MARGEN = mm(4);
/** Left: 4 mm printed fine; 1 mm more for safety. */
export const MARGEN_IZQUIERDO = mm(5);
/**
 * Right: the lab's printer clipped everything past ~66 mm from the left edge (a right-aligned "= 3.000 mg" ending
 * at 76 mm printed only "= 3 ."), so the content ends at 64 mm.
 */
const MARGEN_DERECHO = mm(16);
export const ANCHO_CONTENIDO = ANCHO_PAGINA - MARGEN_IZQUIERDO - MARGEN_DERECHO;
/** Measuring page: far taller than any ticket (PDF pages max out at 200 in). */
const ALTO_MEDICION = mm(2000);
/** Slack under the last line so pdfkit never wraps it onto a second page. */
const HOLGURA = 4;

/** A full-width rule at `y`; returns the y to keep drawing from. */
export function separador(doc: PDFKit.PDFDocument, y: number): number {
  doc
    .moveTo(MARGEN_IZQUIERDO, y)
    .lineTo(MARGEN_IZQUIERDO + ANCHO_CONTENIDO, y)
    .lineWidth(0.75)
    .strokeColor("black")
    .stroke();
  return y + 6;
}

function opciones(alto: number): PDFKit.PDFDocumentOptions {
  return { size: [ANCHO_PAGINA, alto], margins: { top: MARGEN, bottom: MARGEN, left: MARGEN_IZQUIERDO, right: MARGEN_DERECHO } };
}

/** `dibujar` lays the ticket out from the top of the page and returns the y where its content ends. */
export async function renderTicketPdf(dibujar: (doc: PDFKit.PDFDocument) => number): Promise<Buffer> {
  let fin = 0;
  await renderPdf((doc) => {
    fin = dibujar(doc);
  }, opciones(ALTO_MEDICION));
  return renderPdf((doc) => {
    dibujar(doc);
  }, opciones(fin + MARGEN + HOLGURA));
}

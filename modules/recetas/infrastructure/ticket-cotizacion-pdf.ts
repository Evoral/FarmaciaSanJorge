/**
 * PDF of the cotización ticket (domain/ticket-cotizacion.ts) for the 80 mm thermal printer, laid out like the ficha
 * técnica (same geometry, `shared/pdf/ticket.ts`): the farmacia's name on top, the fecha, the paciente and the médico
 * when loaded, then each ítem with its price or, with several ítems, the total.
 */
import { formatNumero } from "@/shared/format/cantidad";
import { ANCHO_CONTENIDO, MARGEN, MARGEN_IZQUIERDO, mm, renderTicketPdf, separador } from "@/shared/pdf/ticket";
import type { TicketCotizacion } from "../domain/ticket-cotizacion";

const ANCHO_PRECIO = mm(22);
const SEPARACION = mm(2);
const ANCHO_TEXTO = ANCHO_CONTENIDO - ANCHO_PRECIO - SEPARACION;

function precio(valor: string): string {
  return `$ ${formatNumero(valor, 2)}`;
}

/** A text on the left and, when given, a bold amount on the right; returns the y under the taller of both. */
function renglon(doc: PDFKit.PDFDocument, y: number, texto: string, importe: string | null, tamano: number): number {
  doc.font("Helvetica").fontSize(tamano);
  const altoTexto = doc.heightOfString(texto, { width: ANCHO_TEXTO });
  doc.text(texto, MARGEN_IZQUIERDO, y, { width: ANCHO_TEXTO });
  let altoImporte = 0;
  if (importe) {
    doc.font("Helvetica-Bold");
    altoImporte = doc.heightOfString(importe, { width: ANCHO_PRECIO, align: "right" });
    doc.text(importe, MARGEN_IZQUIERDO + ANCHO_TEXTO + SEPARACION, y, { width: ANCHO_PRECIO, align: "right" });
  }
  return y + Math.max(altoTexto, altoImporte) + 5;
}

function dibujar(doc: PDFKit.PDFDocument, ticket: TicketCotizacion): number {
  doc.fillColor("black");
  let y = MARGEN;

  doc.font("Helvetica-Bold").fontSize(13).text(ticket.farmacia, MARGEN_IZQUIERDO, y, { width: ANCHO_CONTENIDO, align: "center" });
  doc.font("Helvetica").fontSize(9).text(ticket.fecha, MARGEN_IZQUIERDO, doc.y + 2, { width: ANCHO_CONTENIDO, align: "center" });
  y = separador(doc, doc.y + 6);

  if (ticket.paciente || ticket.medico) {
    if (ticket.paciente) {
      doc.font("Helvetica").fontSize(8).text("Paciente", MARGEN_IZQUIERDO, y, { width: ANCHO_CONTENIDO });
      doc.font("Helvetica-Bold").fontSize(11).text(ticket.paciente, MARGEN_IZQUIERDO, doc.y, { width: ANCHO_CONTENIDO });
      y = doc.y + 4;
    }
    if (ticket.medico) {
      doc.font("Helvetica").fontSize(8).text("Médico", MARGEN_IZQUIERDO, y, { width: ANCHO_CONTENIDO });
      doc.font("Helvetica-Bold").fontSize(10).text(ticket.medico, MARGEN_IZQUIERDO, doc.y, { width: ANCHO_CONTENIDO });
      y = doc.y + 4;
    }
    y = separador(doc, y + 2);
  }

  for (const r of ticket.renglones) {
    y = renglon(doc, y, r.texto, r.precio ? precio(r.precio) : null, 10);
  }

  if (ticket.total) {
    y = separador(doc, y + 1);
    y = renglon(doc, y, "Total", precio(ticket.total), 11);
  }

  y = separador(doc, y + 1);
  doc.font("Helvetica").fontSize(8).text("Cotización",MARGEN_IZQUIERDO, y, { width: ANCHO_CONTENIDO });
  return doc.y;
}

export async function buildTicketCotizacionPdf(ticket: TicketCotizacion): Promise<Buffer> {
  return renderTicketPdf((doc) => dibujar(doc, ticket));
}

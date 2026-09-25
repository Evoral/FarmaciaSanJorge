/**
 * PDF layout for the stock valorizado export (FASE 13 point 13.2). Same
 * engine/tabular-listing-with-manual-page-breaks shape as
 * `modules/libro/infrastructure/libro-pdf.ts` -- `renderPdf` buffers the
 * whole document, pdfkit does not auto-paginate flowing content.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import type { ValorizadoItem, ValorizadoSubtotal } from "./valorizado-repository";

const MARGIN = 40;
const PAGE_HEIGHT = 842; // A4 in points
const ROW_HEIGHT = 16;
const COLS = [
  { label: "Droga", width: 140 },
  { label: "Lote", width: 80 },
  { label: "Vencimiento", width: 70 },
  { label: "Cantidad", width: 70 },
  { label: "Costo unit.", width: 70 },
  { label: "Valor", width: 85 },
];

export interface ValorizadoPdfOptions {
  filtroResumen: string;
  subtotales: ValorizadoSubtotal[];
  granTotal: string;
  truncated: boolean;
}

function drawHeaderRow(doc: PDFKit.PDFDocument, x0: number): number {
  let x = x0;
  doc.font("Helvetica-Bold").fontSize(8);
  for (const col of COLS) {
    doc.text(col.label, x, doc.y, { width: col.width, lineBreak: false });
    x += col.width;
  }
  return doc.y + ROW_HEIGHT;
}

export function buildValorizadoPdf(items: ValorizadoItem[], options: ValorizadoPdfOptions): Promise<Buffer> {
  return renderPdf((doc) => {
    const x0 = MARGIN;

    function nuevaPagina(): void {
      doc.addPage();
      doc.y = MARGIN;
      doc.y = drawHeaderRow(doc, x0);
    }

    doc.font("Helvetica-Bold").fontSize(12).text("Stock valorizado", x0, MARGIN);
    doc.font("Helvetica").fontSize(8).text("Valorizado al costo actual de cada partida (no hay historial de costos).", x0, doc.y + 2);
    doc.text(options.filtroResumen, x0, doc.y + 2);
    doc.moveDown(0.5);
    doc.y = drawHeaderRow(doc, x0);

    doc.font("Helvetica").fontSize(8);
    let drogaActual: string | null = null;
    let subtotalActual: string | null = null;
    const subtotalesPorDroga = new Map(options.subtotales.map((s) => [s.drogaId, s.valorSubtotal]));

    for (const item of items) {
      if (drogaActual !== null && drogaActual !== item.drogaId) {
        if (doc.y + ROW_HEIGHT > PAGE_HEIGHT - MARGIN) nuevaPagina();
        doc.font("Helvetica-Bold").text(`Subtotal: ${subtotalActual ?? "0"}`, x0, doc.y, { width: 445 });
        doc.font("Helvetica");
        doc.y += ROW_HEIGHT;
      }
      drogaActual = item.drogaId;
      subtotalActual = subtotalesPorDroga.get(item.drogaId) ?? null;

      if (doc.y + ROW_HEIGHT > PAGE_HEIGHT - MARGIN) nuevaPagina();

      const y = doc.y;
      let x = x0;
      const values = [item.drogaNombre, item.lote, item.fechaVencimiento, `${item.cantidadDisponible} ${item.unidadSimbolo}`, item.costoUnitario, item.valor];
      for (let i = 0; i < COLS.length; i++) {
        doc.text(values[i], x, y, { width: COLS[i].width, height: ROW_HEIGHT, ellipsis: true, lineBreak: false });
        x += COLS[i].width;
      }
      doc.y = y + ROW_HEIGHT;
    }

    if (drogaActual !== null) {
      if (doc.y + ROW_HEIGHT > PAGE_HEIGHT - MARGIN) nuevaPagina();
      doc.font("Helvetica-Bold").text(`Subtotal: ${subtotalActual ?? "0"}`, x0, doc.y, { width: 445 });
      doc.y += ROW_HEIGHT;
    }

    if (doc.y + ROW_HEIGHT * 2 > PAGE_HEIGHT - MARGIN) nuevaPagina();
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(10).text(`Total general: ${options.granTotal}`, x0, doc.y);

    if (options.truncated) {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#b91c1c").text("El listado fue truncado por superar el máximo de filas exportables. Acotá los filtros.", x0, doc.y, { width: 500 });
    }
  });
}

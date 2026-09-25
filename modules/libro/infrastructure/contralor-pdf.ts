/**
 * PDF layout for the libro contralor export (FASE 13 point 13.3). Same
 * engine/tabular-listing-with-manual-page-breaks shape as
 * `modules/libro/infrastructure/libro-pdf.ts`.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import type { ContralorListItem } from "./contralor-repository";

const MARGIN = 40;
const PAGE_HEIGHT = 842; // A4 in points
const ROW_HEIGHT = 16;
const COLS = [
  { label: "Nº", width: 35 },
  { label: "Fecha", width: 55 },
  { label: "Movimiento", width: 60 },
  { label: "Droga", width: 130 },
  { label: "Cantidad", width: 60 },
  { label: "Saldo ant.", width: 65 },
  { label: "Saldo post.", width: 65 },
  { label: "Vale", width: 45 },
];

const TIPO_MOVIMIENTO_LABELS: Record<string, string> = {
  APERTURA: "Apertura",
  INGRESO: "Ingreso",
  EGRESO: "Egreso",
  AJUSTE: "Ajuste",
};

export interface ContralorPdfOptions {
  filtroResumen: string;
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

export function buildContralorPdf(items: ContralorListItem[], options: ContralorPdfOptions): Promise<Buffer> {
  return renderPdf((doc) => {
    const x0 = MARGIN;

    function nuevaPagina(): void {
      doc.addPage();
      doc.y = MARGIN;
      doc.y = drawHeaderRow(doc, x0);
    }

    doc.font("Helvetica-Bold").fontSize(12).text("Libros contralor", x0, MARGIN);
    doc.font("Helvetica").fontSize(8).text(options.filtroResumen, x0, doc.y + 2);
    doc.moveDown(0.5);
    doc.y = drawHeaderRow(doc, x0);

    doc.font("Helvetica").fontSize(8);
    for (const item of items) {
      if (doc.y + ROW_HEIGHT > PAGE_HEIGHT - MARGIN) nuevaPagina();

      const y = doc.y;
      let x = x0;
      const values = [
        item.numeroCorrelativo,
        item.fechaAsiento,
        TIPO_MOVIMIENTO_LABELS[item.tipoMovimiento] ?? item.tipoMovimiento,
        item.drogaDescripcion,
        `${item.cantidad} ${item.unidadSimbolo}`,
        item.saldoAnterior,
        item.saldoPosterior,
        item.numeroValeAdquisicion ?? "—",
      ];
      for (let i = 0; i < COLS.length; i++) {
        doc.text(values[i], x, y, { width: COLS[i].width, height: ROW_HEIGHT, ellipsis: true, lineBreak: false });
        x += COLS[i].width;
      }
      doc.y = y + ROW_HEIGHT;
    }

    if (options.truncated) {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#b91c1c").text("El listado fue truncado por superar el máximo de filas exportables. Acotá los filtros.", x0, doc.y, { width: 500 });
    }
  });
}

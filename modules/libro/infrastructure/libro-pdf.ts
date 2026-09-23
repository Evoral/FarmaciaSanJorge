/**
 * PDF layout for the libro recetario export (FASE 9, M12 point 9.1). Reuses
 * `shared/pdf/pdf-document.ts#renderPdf`, same engine/setup as
 * `modules/preparaciones/infrastructure/etiqueta-pdf.ts`. A plain tabular
 * listing (A4, one row per asiento) with manual page breaks -- pdfkit does
 * NOT auto-paginate flowing content, so this tracks `doc.y` and calls
 * `doc.addPage()` before it would run off the bottom margin.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import type { AsientoListItem } from "./asiento-repository";
import { resolverEstadoVisualAsiento, etiquetaEstadoVisual } from "../domain/estado-visual";

const MARGIN = 40;
const PAGE_HEIGHT = 842; // A4 in points
const ROW_HEIGHT = 16;
const COLS = [
  { label: "Nº", width: 40 },
  { label: "Fecha", width: 60 },
  { label: "Origen", width: 60 },
  { label: "Estado", width: 130 },
  { label: "Paciente", width: 130 },
  { label: "Médico", width: 130 },
];

export interface LibroPdfOptions {
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

export function buildLibroPdf(items: AsientoListItem[], options: LibroPdfOptions): Promise<Buffer> {
  return renderPdf((doc) => {
    const x0 = MARGIN;

    function nuevaPagina(): void {
      doc.addPage();
      doc.y = MARGIN;
      doc.y = drawHeaderRow(doc, x0);
    }

    doc.font("Helvetica-Bold").fontSize(12).text("Libro recetario", x0, MARGIN);
    doc.font("Helvetica").fontSize(8).text(options.filtroResumen, x0, doc.y + 2);
    doc.moveDown(0.5);
    doc.y = drawHeaderRow(doc, x0);

    doc.font("Helvetica").fontSize(8);
    for (const item of items) {
      if (doc.y + ROW_HEIGHT > PAGE_HEIGHT - MARGIN) nuevaPagina();

      const estado = etiquetaEstadoVisual(
        resolverEstadoVisualAsiento({
          estado: item.estado,
          anulacion: item.anulacion,
          rectificativoNumeroCorrelativo: item.rectificativoNumeroCorrelativo,
        }),
      );
      const origen = item.origen === "RECTIFICATIVO" && item.asientoOriginalNumeroCorrelativo ? `Rectifica Nº ${item.asientoOriginalNumeroCorrelativo}` : "Sistema";

      const y = doc.y;
      let x = x0;
      const values = [item.numeroCorrelativo, item.fechaAsiento, origen, estado, item.pacienteTexto, item.medicoTexto];
      for (let i = 0; i < COLS.length; i++) {
        doc.text(values[i], x, y, { width: COLS[i].width, height: ROW_HEIGHT, ellipsis: true, lineBreak: false });
        x += COLS[i].width;
      }
      doc.y = y + ROW_HEIGHT;
    }

    if (options.truncated) {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#b91c1c").text("El listado fue truncado por superar el máximo de filas exportables. Acotá el rango de fechas o números.", x0, doc.y, { width: 500 });
    }
  });
}

/**
 * PDF layout for the cierre diario comprobante (FASE 10, M13a point 10.2,
 * DP-21 -- comprobante A4 content per user decision). Reuses
 * `shared/pdf/pdf-document.ts#renderPdf`, same manual-pagination discipline
 * as `modules/libro/infrastructure/libro-pdf.ts` (pdfkit does not
 * auto-paginate flowing content).
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import type { CierreDetalle, TenantDatosComprobante } from "./cierre-repository";
import { MOTIVO_DEMORA_LABELS, type MotivoDemoraValue } from "../domain/motivo-demora";

const MARGIN = 40;
const PAGE_HEIGHT = 842; // A4 points
const ROW_HEIGHT = 16;

const COLS_RECETARIO = [
  { label: "Nº", width: 40 },
  { label: "Estado", width: 120 },
  { label: "Paciente", width: 130 },
  { label: "Médico", width: 130 },
  { label: "Fórmula", width: 150 },
];

const COLS_CONTRALOR = [
  { label: "Nº", width: 40 },
  { label: "Libro", width: 90 },
  { label: "Droga", width: 150 },
  { label: "Movimiento", width: 90 },
  { label: "Cantidad", width: 80 },
  { label: "Saldo", width: 80 },
];

function fechaHora(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Argentina/Mendoza" }).format(d);
}

function drawHeaderRow(doc: PDFKit.PDFDocument, x0: number, cols: { label: string; width: number }[]): number {
  let x = x0;
  doc.font("Helvetica-Bold").fontSize(8);
  for (const col of cols) {
    doc.text(col.label, x, doc.y, { width: col.width, lineBreak: false });
    x += col.width;
  }
  return doc.y + ROW_HEIGHT;
}

function drawRow(doc: PDFKit.PDFDocument, x0: number, cols: { label: string; width: number }[], values: string[]): void {
  const y = doc.y;
  let x = x0;
  for (let i = 0; i < cols.length; i++) {
    doc.text(values[i] ?? "", x, y, { width: cols[i].width, height: ROW_HEIGHT, ellipsis: true, lineBreak: false });
    x += cols[i].width;
  }
  doc.y = y + ROW_HEIGHT;
}

export function buildCierrePdf(detalle: CierreDetalle, tenant: TenantDatosComprobante): Promise<Buffer> {
  return renderPdf((doc) => {
    const x0 = MARGIN;

    function ensureSpace(cols: { label: string; width: number }[]): void {
      if (doc.y + ROW_HEIGHT > PAGE_HEIGHT - MARGIN) {
        doc.addPage();
        doc.y = MARGIN;
        doc.y = drawHeaderRow(doc, x0, cols);
      }
    }

    // Header: farmacia.
    doc.font("Helvetica-Bold").fontSize(13).text(tenant.nombreFantasia ?? tenant.razonSocial, x0, MARGIN);
    doc.font("Helvetica").fontSize(8);
    if (tenant.nombreFantasia) doc.text(tenant.razonSocial, { width: 500 });
    doc.text(`CUIT ${tenant.cuit}${tenant.matriculaFarmacia ? ` — Matrícula de farmacia ${tenant.matriculaFarmacia}` : ""}`, { width: 500 });
    if (tenant.domicilio) doc.text(tenant.domicilio, { width: 500 });
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold").fontSize(12).text(`Comprobante de cierre diario — Jornada ${detalle.fecha}`, x0);
    doc.moveDown(0.3);

    doc.font("Helvetica").fontSize(9);
    doc.text(`Director Técnico: ${detalle.directorTecnicoApellido}, ${detalle.directorTecnicoNombre} — Matrícula ${detalle.matriculaDt}`, { width: 500 });
    doc.text(`Cantidad de asientos: ${detalle.cantidadAsientos}`, { width: 500 });
    doc.text(`Hash de lote: ${detalle.hashLote}`, { width: 500 });
    doc.text(`Firmado: ${fechaHora(detalle.fechaFirma)} (mecanismo: ${detalle.mecanismoFirma})`, { width: 500 });
    if (detalle.fueraDeTermino) {
      const label = detalle.motivoDemora ? MOTIVO_DEMORA_LABELS[detalle.motivoDemora as MotivoDemoraValue] ?? detalle.motivoDemora : "—";
      doc
        .font("Helvetica-Bold")
        .fillColor("#b91c1c")
        .text(`Firma fuera de término. Motivo: ${label}${detalle.motivoDemoraDetalle ? ` — ${detalle.motivoDemoraDetalle}` : ""}`, { width: 500 })
        .fillColor("black")
        .font("Helvetica");
    }
    doc.moveDown(0.8);

    // Libro recetario.
    doc.font("Helvetica-Bold").fontSize(10).text("Libro recetario", x0);
    doc.moveDown(0.3);
    if (detalle.asientosRecetario.length === 0) {
      doc.font("Helvetica").fontSize(8).text("Sin asientos de recetario en esta jornada.", x0);
    } else {
      doc.y = drawHeaderRow(doc, x0, COLS_RECETARIO);
      doc.font("Helvetica").fontSize(8);
      for (const item of detalle.asientosRecetario) {
        ensureSpace(COLS_RECETARIO);
        drawRow(doc, x0, COLS_RECETARIO, [item.numeroCorrelativo, item.estadoVisual, item.pacienteTexto, item.medicoTexto, item.formulaTexto]);
      }
    }
    doc.moveDown(0.8);

    // Libros contralor.
    doc.font("Helvetica-Bold").fontSize(10).text("Libros contralor (psicotrópicos / estupefacientes)", x0);
    doc.moveDown(0.3);
    if (detalle.asientosContralor.length === 0) {
      doc.font("Helvetica").fontSize(8).text("Sin asientos de contralor en esta jornada.", x0);
    } else {
      doc.y = drawHeaderRow(doc, x0, COLS_CONTRALOR);
      doc.font("Helvetica").fontSize(8);
      for (const item of detalle.asientosContralor) {
        ensureSpace(COLS_CONTRALOR);
        drawRow(doc, x0, COLS_CONTRALOR, [
          item.numeroCorrelativo,
          item.tipoLibro,
          item.drogaDescripcion,
          item.tipoMovimiento,
          item.cantidad,
          item.saldoPosterior,
        ]);
      }
    }
    doc.moveDown(1.5);

    // Blank signature area (DP-21, user decision 5).
    if (doc.y + 80 > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
      doc.y = MARGIN;
    }
    doc
      .moveTo(x0, doc.y + 60)
      .lineTo(x0 + 250, doc.y + 60)
      .lineWidth(0.5)
      .stroke();
    doc.font("Helvetica").fontSize(8).text("Firma y sello del Director Técnico", x0, doc.y + 64);
  });
}

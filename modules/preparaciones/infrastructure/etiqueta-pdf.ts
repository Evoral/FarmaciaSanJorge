/**
 * PDF layout for a preparación's etiqueta (M11, FASE 8 point 8.5). Reuses
 * `shared/pdf/pdf-document.ts#renderPdf`, same engine/setup as
 * `modules/elaboracion/infrastructure/ficha-pdf.ts` (pdfkit, no bundled
 * fonts). Deliberately small -- a printed label, not a full page -- and
 * limited to what `domain/preparacion.ts#formatearContenidoEtiqueta`'s doc
 * comment documents as in scope: DP-28's exact content rules are still
 * open.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import type { EtiquetaParaImprimirDatos } from "./preparacion-repository";

const MARGIN = 24;
const LABEL_WIDTH = 288; // ~4in at 72dpi -- a small adhesive label, not A4.
const LABEL_HEIGHT = 216; // ~3in
const CONTENT_WIDTH = LABEL_WIDTH - MARGIN * 2;

function fechaHora(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Mendoza" }).format(d);
}

export function buildEtiquetaPdf(datos: EtiquetaParaImprimirDatos): Promise<Buffer> {
  return renderPdf(
    (doc) => {
      doc.font("Helvetica-Bold").fontSize(10).text(datos.tenantNombreFantasia ?? datos.tenantRazonSocial, MARGIN, MARGIN, { width: CONTENT_WIDTH });
      if (datos.tenantMatriculaFarmacia) {
        doc.font("Helvetica").fontSize(7).text(`Matrícula de farmacia ${datos.tenantMatriculaFarmacia}`, { width: CONTENT_WIDTH });
      }
      doc.moveDown(0.4);

      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(MARGIN + CONTENT_WIDTH, doc.y)
        .lineWidth(0.5)
        .stroke();
      doc.moveDown(0.4);

      doc.font("Helvetica-Bold").fontSize(9).text(`${datos.itemDescripcion ?? datos.formaFarmaceutica} (${datos.formaFarmaceutica})`, { width: CONTENT_WIDTH });
      doc.font("Helvetica").fontSize(8).text(`${datos.cantidadUnidades} unidad${datos.cantidadUnidades === 1 ? "" : "es"}`, { width: CONTENT_WIDTH });
      doc.moveDown(0.3);

      doc.font("Helvetica-Bold").fontSize(7).text("Paciente", { continued: true, width: CONTENT_WIDTH }).font("Helvetica").text(` ${datos.pacienteTexto}`);
      doc.font("Helvetica-Bold").fontSize(7).text("Prescriptor", { continued: true, width: CONTENT_WIDTH }).font("Helvetica").text(` ${datos.medicoTexto}`);
      doc.moveDown(0.3);

      doc.font("Helvetica-Bold").fontSize(7).text("Fórmula", { width: CONTENT_WIDTH });
      doc.font("Helvetica").fontSize(7).text(datos.formulaTexto, { width: CONTENT_WIDTH });
      doc.moveDown(0.3);

      doc.font("Helvetica").fontSize(7).text(`Preparado por ${datos.preparadaPorApellido}, ${datos.preparadaPorNombre} — ${fechaHora(datos.confirmadaEn)}`, {
        width: CONTENT_WIDTH,
      });
      if (datos.asientoNumeroCorrelativo) {
        doc.font("Helvetica").fontSize(6).fillColor("#555").text(`Libro recetario Nº ${datos.asientoNumeroCorrelativo}`, { width: CONTENT_WIDTH });
      }
    },
    { size: [LABEL_WIDTH, LABEL_HEIGHT], margin: MARGIN },
  );
}

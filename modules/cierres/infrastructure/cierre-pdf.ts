/**
 * PDF of a signed jornada, printed as its sheet of the libro recetario (FASE 10, M13a point 10.2;
 * docs/specs/libro-recetario-y-contralor.md, "Impresión"): A4 landscape, only this jornada (a long day continues on
 * the next sheets) and "Hoja i de n" on every sheet (`shared/pdf/hojas.ts`). The sheet shows the farmacia, the
 * jornada, the Director Técnico and the asientos with their whole fórmula de la prescripción (no estado column: the
 * printed libro does not carry it), then the blank firma area. The libros contralor are not on it (every droga, controlled or not, is already in its asiento's fórmula).
 * Reuses `shared/pdf/pdf-document.ts#renderPdf`.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import { HOJA_ANCHO_UTIL, HOJA_LIMITE_INFERIOR, HOJA_MARGEN, OPCIONES_HOJA_LIBRO, dibujarTabla, formulaParaHoja, numerarHojas, type ColumnaTabla } from "@/shared/pdf/hojas";
import { formatFechaIso } from "@/shared/format/fecha";
import type { CierreDetalle, TenantDatosComprobante } from "./cierre-repository";

// Fits the landscape width between margins (762 pt).
const COLUMNAS: ColumnaTabla[] = [
  { label: "Nº", width: 45 },
  { label: "Paciente", width: 160 },
  { label: "Médico", width: 150 },
  { label: "Fórmula de la prescripción", width: 407 },
];

export function buildCierrePdf(detalle: CierreDetalle, tenant: TenantDatosComprobante): Promise<Buffer> {
  return renderPdf((doc) => {
    const x0 = HOJA_MARGEN;
    const jornada = `Jornada ${formatFechaIso(detalle.fecha)}`;

    // Header: farmacia on the left, the jornada on the right.
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#18181b").text(tenant.nombreFantasia ?? tenant.razonSocial, x0, HOJA_MARGEN, { width: HOJA_ANCHO_UTIL / 2 });
    doc.font("Helvetica").fontSize(8).fillColor("#52525b");
    if (tenant.nombreFantasia) doc.text(tenant.razonSocial, { width: HOJA_ANCHO_UTIL / 2 });
    doc.text(`CUIT ${tenant.cuit}${tenant.matriculaFarmacia ? ` — Matrícula de farmacia ${tenant.matriculaFarmacia}` : ""}`, { width: HOJA_ANCHO_UTIL / 2 });
    if (tenant.domicilio) doc.text(tenant.domicilio, { width: HOJA_ANCHO_UTIL / 2 });
    const finEncabezado = doc.y;

    doc.font("Helvetica-Bold").fontSize(13).fillColor("#18181b").text("Libro recetario", x0, HOJA_MARGEN, { width: HOJA_ANCHO_UTIL, align: "right" });
    doc.font("Helvetica").fontSize(10).text(jornada, { width: HOJA_ANCHO_UTIL, align: "right" });
    doc.y = Math.max(finEncabezado, doc.y) + 10;

    doc.font("Helvetica").fontSize(9).fillColor("#18181b");
    doc.text(`Director Técnico: ${detalle.directorTecnicoApellido}, ${detalle.directorTecnicoNombre} — Matrícula ${detalle.matriculaDt}`, x0, doc.y, { width: HOJA_ANCHO_UTIL });
    doc.text(`Asientos de la jornada: ${detalle.asientosRecetario.length}`, { width: HOJA_ANCHO_UTIL });
    doc.moveDown(0.8);

    if (detalle.asientosRecetario.length === 0) {
      doc.fontSize(9).fillColor("#52525b").text("Sin asientos de recetario en esta jornada.", x0).fillColor("black");
    } else {
      dibujarTabla(
        doc,
        COLUMNAS,
        detalle.asientosRecetario.map((a) => [a.numeroCorrelativo, a.pacienteTexto, a.medicoTexto, formulaParaHoja(a.formulaTexto)]),
        () => {
          doc.font("Helvetica-Bold").fontSize(10).fillColor("#18181b").text(`Libro recetario — ${jornada} (continuación)`, x0, HOJA_MARGEN);
          doc.moveDown(0.5);
        },
      );
    }

    // Blank firma area (DP-21, user decision 5).
    if (doc.y + 90 > HOJA_LIMITE_INFERIOR) {
      doc.addPage();
      doc.y = HOJA_MARGEN;
    }
    const yFirma = doc.y + 60;
    doc
      .save()
      .moveTo(x0 + HOJA_ANCHO_UTIL - 250, yFirma)
      .lineTo(x0 + HOJA_ANCHO_UTIL, yFirma)
      .lineWidth(0.5)
      .strokeColor("#18181b")
      .stroke()
      .restore();
    doc.font("Helvetica").fontSize(8).fillColor("#52525b").text("Firma y sello del Director Técnico", x0 + HOJA_ANCHO_UTIL - 250, yFirma + 4, { width: 250, align: "center" }).fillColor("black");

    const rango = doc.bufferedPageRange();
    numerarHojas(doc, [{ primera: rango.start, ultima: rango.start + rango.count - 1, etiqueta: jornada }]);
  }, OPCIONES_HOJA_LIBRO);
}

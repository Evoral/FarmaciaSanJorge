/**
 * PDF of a signed jornada, printed as its sheet of the libro recetario (FASE 10, M13a point 10.2;
 * docs/specs/libro-recetario-y-contralor.md, "Impresión"): A4 landscape, only this jornada (a long day continues on
 * the next sheets) and "Hoja i de n" on every sheet (`shared/pdf/hojas.ts`). Laid out like the legalized libro: the
 * farmacia, its propietario and the DT top left under a centered "LIBRO RECETARIO", every asiento of the jornada with
 * its whole fórmula de la prescripción, the lotes used and an Anulado column ("SI" for the ones anulados within the
 * jornada, explained by the footnote of every sheet), then the farmacéutico's firma with the farmacia, propietario
 * and domicilio under it. The libros contralor are not on it (every droga, controlled or not, is already in its
 * asiento's fórmula). Reuses `shared/pdf/pdf-document.ts#renderPdf`.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import { HOJA_ANCHO_UTIL, HOJA_LIMITE_INFERIOR, HOJA_MARGEN, LEYENDA_ANULADO, OPCIONES_HOJA_LIBRO, celdaAnulado, dibujarTabla, formulaParaHoja, numerarHojas, type ColumnaTabla } from "@/shared/pdf/hojas";
import { formatFechaIso } from "@/shared/format/fecha";
import type { CierreDetalle, TenantDatosComprobante } from "./cierre-repository";

// Fits the landscape width between margins (762 pt).
const COLUMNAS: ColumnaTabla[] = [
  { label: "Nº", width: 40 },
  { label: "Paciente", width: 130 },
  { label: "Médico", width: 130 },
  { label: "Fórmula de la prescripción", width: 292 },
  { label: "Lote", width: 120 },
  { label: "Anulado", width: 50 },
];

const ANCHO_FIRMA = 250;
/** Blank room above the firma line for the handwritten signature and sello. */
const ESPACIO_PARA_FIRMAR = 50;

export function buildCierrePdf(detalle: CierreDetalle, tenant: TenantDatosComprobante): Promise<Buffer> {
  return renderPdf((doc) => {
    const x0 = HOJA_MARGEN;
    const jornada = `Jornada ${formatFechaIso(detalle.fecha)}`;
    const farmacia = tenant.nombreFantasia ?? tenant.razonSocial;
    // The razón social is the propietario's name; printed only when it differs from the farmacia's name.
    const propietario = tenant.nombreFantasia ? tenant.razonSocial : null;

    // Header: centered title, then farmacia / propietario / DT on the left and the jornada on the right.
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#18181b").text("LIBRO RECETARIO", x0, HOJA_MARGEN, { width: HOJA_ANCHO_UTIL, align: "center" });
    const yDatos = doc.y + 4;
    doc.font("Helvetica-Bold").fontSize(9).text(farmacia, x0, yDatos, { width: HOJA_ANCHO_UTIL / 2 });
    doc.font("Helvetica").fontSize(9);
    if (propietario) doc.text(propietario, { width: HOJA_ANCHO_UTIL / 2 });
    doc.text(`DT: ${detalle.directorTecnicoApellido}, ${detalle.directorTecnicoNombre} (${detalle.matriculaDt})`, { width: HOJA_ANCHO_UTIL / 2 });
    doc.fontSize(8).fillColor("#52525b").text(`CUIT ${tenant.cuit}${tenant.matriculaFarmacia ? ` — Matrícula de farmacia ${tenant.matriculaFarmacia}` : ""}`, { width: HOJA_ANCHO_UTIL / 2 });
    const finDatos = doc.y;

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#18181b").text(jornada, x0, yDatos, { width: HOJA_ANCHO_UTIL, align: "right" });
    const anulados = detalle.asientosRecetario.filter((a) => a.anulado).length;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#52525b")
      .text(`Asientos: ${detalle.asientosRecetario.length}${anulados > 0 ? ` (${anulados} ${anulados === 1 ? "anulado" : "anulados"})` : ""}`, { width: HOJA_ANCHO_UTIL, align: "right" });
    doc.fillColor("#18181b");
    doc.y = Math.max(finDatos, doc.y) + 10;

    if (detalle.asientosRecetario.length === 0) {
      doc.fontSize(9).fillColor("#52525b").text("Sin asientos de recetario en esta jornada.", x0).fillColor("black");
    } else {
      dibujarTabla(
        doc,
        COLUMNAS,
        detalle.asientosRecetario.map((a) => [a.numeroCorrelativo, a.pacienteTexto, a.medicoTexto, formulaParaHoja(a.formulaTexto), a.lotes.join("\n"), celdaAnulado(a.anulado)]),
        () => {
          doc.font("Helvetica-Bold").fontSize(10).fillColor("#18181b").text(`Libro recetario — ${jornada} (continuación)`, x0, HOJA_MARGEN);
          doc.moveDown(0.5);
        },
      );
    }

    // Firma area (DP-21, user decision 5), like the legalized libro: always at the same place, the bottom of the
    // jornada's last sheet, centered: line, label, then who signs for. A table ending too low moves it to a new sheet.
    const pieFirma = [farmacia, propietario, tenant.domicilio].filter((linea): linea is string => Boolean(linea));
    const yFirma = HOJA_LIMITE_INFERIOR - 12 - 11 * pieFirma.length;
    if (doc.y + ESPACIO_PARA_FIRMAR > yFirma) doc.addPage();
    const xFirma = x0 + (HOJA_ANCHO_UTIL - ANCHO_FIRMA) / 2;
    doc.save().moveTo(xFirma, yFirma).lineTo(xFirma + ANCHO_FIRMA, yFirma).lineWidth(0.5).strokeColor("#18181b").stroke().restore();
    doc.font("Helvetica").fontSize(8).fillColor("#52525b").text("Firma y aclaración del Farmacéutico", xFirma, yFirma + 4, { width: ANCHO_FIRMA, align: "center" });
    doc.fillColor("#18181b");
    for (const linea of pieFirma) doc.text(linea, xFirma, doc.y + 1, { width: ANCHO_FIRMA, align: "center" });
    doc.fillColor("black");

    const rango = doc.bufferedPageRange();
    numerarHojas(doc, [{ primera: rango.start, ultima: rango.start + rango.count - 1, etiqueta: jornada }], LEYENDA_ANULADO);
  }, OPCIONES_HOJA_LIBRO);
}

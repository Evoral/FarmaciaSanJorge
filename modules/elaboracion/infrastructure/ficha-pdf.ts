/**
 * PDF layout for a ficha técnica (M10, FASE 7 point 7.3), sized for the
 * lab's 80 mm thermal receipt printer (POS80; geometry shared with every
 * ticket in `shared/pdf/ticket.ts`). Pure
 * rendering: takes the already-authorized, already-loaded `FichaParaImprimir`
 * (from `getFichaParaImprimir`, which is the ONLY place patient data is read)
 * and lays it out with `pdfkit` via `shared/pdf/pdf-document.ts#renderPdf`.
 *
 * Content, kept to what the bench reads while preparing: the preparación's
 * name (only when the ítem has one), the paciente, the médico and their
 * matrícula, and the líneas de pesaje
 * as a plain droga / cantidad list, followed by the excipiente, the material
 * (cápsulas, envases) and the adicionales; a small footer with the receta
 * number. Black only, no shading: thermal
 * printers have no greys.
 */
import { ANCHO_CONTENIDO, MARGEN, MARGEN_IZQUIERDO, mm, renderTicketPdf, separador } from "@/shared/pdf/ticket";
import { cantidadesFichaTecnica, formatCantidadExacta } from "@/shared/format/cantidad";
import type { FichaParaImprimir, InsumoImprimir, LineaImprimir } from "./ficha-repository";

const ANCHO_CANTIDAD = mm(22);
const SEPARACION = mm(2);
const ANCHO_DROGA = ANCHO_CONTENIDO - ANCHO_CANTIDAD - SEPARACION;

function textoCantidad(linea: LineaImprimir): string {
  if (linea.esEnraseManual) return "Enrase manual";
  if (!linea.cantidadAPesar) return "—";
  const info = cantidadesFichaTecnica(linea.cantidadAPesar, linea.unidadSimbolo);
  return info ? `${info.principal} ${info.simboloPrincipal}` : formatCantidadExacta(linea.cantidadAPesar, linea.unidadSimbolo);
}

/** "= 500 mg" under the cantidad when the línea is a mass in another unit (g / mg); `null` otherwise. */
function textoEquivalencia(linea: LineaImprimir): string | null {
  if (linea.esEnraseManual || !linea.cantidadAPesar) return null;
  const info = cantidadesFichaTecnica(linea.cantidadAPesar, linea.unidadSimbolo);
  return info?.equivalencia ?? null;
}

/** The insumo's cantidad like a línea's (g / mg shown in the bench's unit), "" when it has none. */
function textoCantidadInsumo(insumo: InsumoImprimir): string {
  if (!insumo.cantidad) return "";
  const info = cantidadesFichaTecnica(insumo.cantidad, insumo.unidadSimbolo);
  return info ? `${info.principal} ${info.simboloPrincipal}` : formatCantidadExacta(insumo.cantidad, insumo.unidadSimbolo);
}

/** Lays the ficha out from the top of the page; returns the y where the content ends. */
function dibujar(doc: PDFKit.PDFDocument, ficha: FichaParaImprimir): number {
  doc.fillColor("black");
  let y = MARGEN;

  if (ficha.itemDescripcion) {
    doc.font("Helvetica-Bold").fontSize(13).text(ficha.itemDescripcion, MARGEN_IZQUIERDO, y, { width: ANCHO_CONTENIDO });
    y = doc.y + 6;
  }

  doc.font("Helvetica").fontSize(8).text("Paciente", MARGEN_IZQUIERDO, y, { width: ANCHO_CONTENIDO });
  doc.font("Helvetica-Bold").fontSize(11).text(`${ficha.pacienteApellido}, ${ficha.pacienteNombre}`, MARGEN_IZQUIERDO, doc.y, { width: ANCHO_CONTENIDO });
  doc.font("Helvetica").fontSize(8).text("Médico", MARGEN_IZQUIERDO, doc.y + 4, { width: ANCHO_CONTENIDO });
  doc.font("Helvetica-Bold").fontSize(10).text(`${ficha.medicoApellido}, ${ficha.medicoNombre} - MAT. ${ficha.medicoMatricula}`, MARGEN_IZQUIERDO, doc.y, { width: ANCHO_CONTENIDO });
  y = separador(doc, doc.y + 6);

  for (const linea of ficha.lineas) {
    const cantidad = textoCantidad(linea);
    doc.font("Helvetica").fontSize(10);
    let altoDroga = doc.heightOfString(linea.drogaNombre, { width: ANCHO_DROGA });
    doc.text(linea.drogaNombre, MARGEN_IZQUIERDO, y, { width: ANCHO_DROGA });
    // A concentration line: the prescription and its breakdown ("5 % × 30 mL", migration 0112) under the droga.
    if (linea.prescripcion) {
      doc.fontSize(8);
      const altoPrescripcion = doc.heightOfString(linea.prescripcion, { width: ANCHO_DROGA });
      doc.text(linea.prescripcion, MARGEN_IZQUIERDO, y + altoDroga, { width: ANCHO_DROGA });
      altoDroga += altoPrescripcion;
      doc.fontSize(10);
    }
    doc.font("Helvetica-Bold");
    const altoCantidad = doc.heightOfString(cantidad, { width: ANCHO_CANTIDAD, align: "right" });
    doc.text(cantidad, MARGEN_IZQUIERDO + ANCHO_DROGA + SEPARACION, y, { width: ANCHO_CANTIDAD, align: "right" });
    let altoDerecha = altoCantidad;
    const equivalencia = textoEquivalencia(linea);
    if (equivalencia) {
      doc.font("Helvetica").fontSize(8);
      const altoEquivalencia = doc.heightOfString(equivalencia, { width: ANCHO_CANTIDAD, align: "right" });
      doc.text(equivalencia, MARGEN_IZQUIERDO + ANCHO_DROGA + SEPARACION, y + altoCantidad, { width: ANCHO_CANTIDAD, align: "right" });
      altoDerecha += altoEquivalencia;
      doc.font("Helvetica").fontSize(10);
    }
    y += Math.max(altoDroga, altoDerecha) + 5;
  }

  for (const insumo of ficha.insumos) {
    const cantidad = textoCantidadInsumo(insumo);
    doc.font("Helvetica").fontSize(10);
    const altoNombre = doc.heightOfString(insumo.nombre, { width: ANCHO_DROGA });
    doc.text(insumo.nombre, MARGEN_IZQUIERDO, y, { width: ANCHO_DROGA });
    doc.font("Helvetica-Bold");
    const altoCantidad = cantidad ? doc.heightOfString(cantidad, { width: ANCHO_CANTIDAD, align: "right" }) : 0;
    if (cantidad) doc.text(cantidad, MARGEN_IZQUIERDO + ANCHO_DROGA + SEPARACION, y, { width: ANCHO_CANTIDAD, align: "right" });
    let altoDerecha = altoCantidad;
    // An excipiente typed per unidad: "= 10 mg por cápsula" under its total, like a línea's equivalencia (migration 0113).
    if (insumo.detalle) {
      doc.font("Helvetica").fontSize(8);
      const altoDetalle = doc.heightOfString(insumo.detalle, { width: ANCHO_CANTIDAD, align: "right" });
      doc.text(insumo.detalle, MARGEN_IZQUIERDO + ANCHO_DROGA + SEPARACION, y + altoCantidad, { width: ANCHO_CANTIDAD, align: "right" });
      altoDerecha += altoDetalle;
      doc.font("Helvetica").fontSize(10);
    }
    y += Math.max(altoNombre, altoDerecha) + 5;
  }

  y = separador(doc, y + 1);
  doc.font("Helvetica").fontSize(8).text(`Receta Nº ${ficha.recetaNumeroInterno} · Ficha técnica`, MARGEN_IZQUIERDO, y, { width: ANCHO_CONTENIDO });
  return doc.y;
}

export async function buildFichaTecnicaPdf(ficha: FichaParaImprimir): Promise<Buffer> {
  return renderTicketPdf((doc) => dibujar(doc, ficha));
}

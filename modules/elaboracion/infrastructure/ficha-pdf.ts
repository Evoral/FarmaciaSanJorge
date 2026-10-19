/**
 * PDF layout for a ficha técnica (M10, FASE 7 point 7.3), sized for the
 * lab's 80 mm thermal receipt printer (POS80; content kept inside what it
 * actually prints, see `MARGEN_DERECHO`). Pure
 * rendering: takes the already-authorized, already-loaded `FichaParaImprimir`
 * (from `getFichaParaImprimir`, which is the ONLY place patient data is read)
 * and lays it out with `pdfkit` via `shared/pdf/pdf-document.ts#renderPdf`.
 *
 * Content, kept to what the bench reads while preparing: the preparación's
 * name (only when the ítem has one), the paciente, the médico and their
 * matrícula, and the líneas de pesaje
 * as a plain droga / cantidad list; a small footer with the receta number
 * and ficha version for traceability. Black only, no shading: thermal
 * printers have no greys.
 *
 * A receipt roll has no page height, so the page is exactly as tall as its
 * content: the layout runs once on a very tall page to measure it, then
 * again on a page of the measured height.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import { equivalenciaGramosMg, formatCantidadExacta } from "@/shared/format/cantidad";
import type { FichaParaImprimir, LineaImprimir } from "./ficha-repository";

const PUNTOS_POR_MM = 72 / 25.4;
const mm = (valor: number) => valor * PUNTOS_POR_MM;

const ANCHO_PAGINA = mm(80);
/** Top and bottom. */
const MARGEN = mm(4);
/** Left: 4 mm printed fine; 1 mm more for safety. */
const MARGEN_IZQUIERDO = mm(5);
/**
 * Right: the lab's printer clipped everything past ~66 mm from the left edge (a right-aligned "= 3.000 mg" ending
 * at 76 mm printed only "= 3 ."), so the content ends at 64 mm.
 */
const MARGEN_DERECHO = mm(16);
const ANCHO_CONTENIDO = ANCHO_PAGINA - MARGEN_IZQUIERDO - MARGEN_DERECHO;
const ANCHO_CANTIDAD = mm(22);
const SEPARACION = mm(2);
const ANCHO_DROGA = ANCHO_CONTENIDO - ANCHO_CANTIDAD - SEPARACION;
/** Measuring page: far taller than any ficha (PDF pages max out at 200 in). */
const ALTO_MEDICION = mm(2000);
/** Slack under the last line so pdfkit never wraps it onto a second page. */
const HOLGURA = 4;

function textoCantidad(linea: LineaImprimir): string {
  if (linea.esEnraseManual) return "Enrase manual";
  return linea.cantidadAPesar ? formatCantidadExacta(linea.cantidadAPesar, linea.unidadSimbolo) : "—";
}

/** "= 500 mg" under the cantidad when the línea is a mass in another unit (g / mg); `null` otherwise. */
function textoEquivalencia(linea: LineaImprimir): string | null {
  if (linea.esEnraseManual || !linea.cantidadAPesar) return null;
  const equivalencia = equivalenciaGramosMg(linea.cantidadAPesar, linea.unidadSimbolo);
  return equivalencia ? `= ${equivalencia}` : null;
}

function separador(doc: PDFKit.PDFDocument, y: number): number {
  doc
    .moveTo(MARGEN_IZQUIERDO, y)
    .lineTo(MARGEN_IZQUIERDO + ANCHO_CONTENIDO, y)
    .lineWidth(0.75)
    .strokeColor("black")
    .stroke();
  return y + 6;
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
    const altoDroga = doc.heightOfString(linea.drogaNombre, { width: ANCHO_DROGA });
    doc.text(linea.drogaNombre, MARGEN_IZQUIERDO, y, { width: ANCHO_DROGA });
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

  y = separador(doc, y + 1);
  doc.font("Helvetica").fontSize(8).text(`Receta Nº ${ficha.recetaNumeroInterno} · Ficha v${ficha.version}`, MARGEN_IZQUIERDO, y, { width: ANCHO_CONTENIDO });
  return doc.y;
}

function opciones(alto: number): PDFKit.PDFDocumentOptions {
  return { size: [ANCHO_PAGINA, alto], margins: { top: MARGEN, bottom: MARGEN, left: MARGEN_IZQUIERDO, right: MARGEN_DERECHO } };
}

export async function buildFichaTecnicaPdf(ficha: FichaParaImprimir): Promise<Buffer> {
  let fin = 0;
  await renderPdf((doc) => {
    fin = dibujar(doc, ficha);
  }, opciones(ALTO_MEDICION));
  return renderPdf((doc) => {
    dibujar(doc, ficha);
  }, opciones(fin + MARGEN + HOLGURA));
}

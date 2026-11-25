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
 *
 * Printed from the toma workspace, a `PesadaImprimir` (built by modules/preparaciones from the preparación's lots)
 * replaces a corrected línea's active cantidad (U.I., or a lot below 100 % purity) with what the bench weighs from each
 * lot; the prescribed amount stays as a secondary line. The stored ficha never changes.
 */
import { ANCHO_CONTENIDO, MARGEN, MARGEN_IZQUIERDO, mm, renderTicketPdf, separador } from "@/shared/pdf/ticket";
import { cantidadesFichaTecnica, formatCantidadExacta } from "@/shared/format/cantidad";
import type { FichaParaImprimir, InsumoImprimir, LineaImprimir } from "./ficha-repository";

const ANCHO_CANTIDAD = mm(22);
const SEPARACION = mm(2);
const ANCHO_DROGA = ANCHO_CONTENIDO - ANCHO_CANTIDAD - SEPARACION;

/** One lot a línea is weighed from: physical quantity in `unidadSimbolo`, `factor` "100.000 U.I./g" / "98 %" (`null` = none). */
export interface LotePesadaImprimir {
  lote: string;
  cantidad: string;
  unidadSimbolo: string;
  factor: string | null;
}

/** What the bench weighs for one línea: from its lots, or a cantidad manual (no U.I.<->mass equivalence; `null` = to fill in by hand). */
export type PesadaDeLineaImprimir =
  | { tipo: "LOTES"; lotes: LotePesadaImprimir[] }
  | { tipo: "MANUAL"; cantidad: string | null; unidadSimbolo: string };

/** By línea `orden`; a línea missing from the map prints its active cantidad, as the stored ficha does. */
export type PesadaImprimir = ReadonlyMap<number, PesadaDeLineaImprimir>;

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

/** "5.000 mg" (+ "= 5 g") for a mass, the exact value otherwise. */
function textosMasa(cantidad: string, simbolo: string): { principal: string; equivalencia: string | null } {
  const info = cantidadesFichaTecnica(cantidad, simbolo);
  return info ? { principal: `${info.principal} ${info.simboloPrincipal}`, equivalencia: info.equivalencia } : { principal: formatCantidadExacta(cantidad, simbolo), equivalencia: null };
}

/** A sub-row under a línea: small text on the left, the bold quantity (and its equivalence) on the right. Returns the next y. */
function filaPesada(doc: PDFKit.PDFDocument, y: number, izquierda: string, derecha: string, equivalencia: string | null): number {
  doc.font("Helvetica").fontSize(8);
  const altoIzquierda = doc.heightOfString(izquierda, { width: ANCHO_DROGA });
  doc.text(izquierda, MARGEN_IZQUIERDO, y + 1, { width: ANCHO_DROGA });
  doc.font("Helvetica-Bold").fontSize(10);
  let altoDerecha = doc.heightOfString(derecha, { width: ANCHO_CANTIDAD, align: "right" });
  doc.text(derecha, MARGEN_IZQUIERDO + ANCHO_DROGA + SEPARACION, y, { width: ANCHO_CANTIDAD, align: "right" });
  if (equivalencia) {
    doc.font("Helvetica").fontSize(8);
    const alto = doc.heightOfString(equivalencia, { width: ANCHO_CANTIDAD, align: "right" });
    doc.text(equivalencia, MARGEN_IZQUIERDO + ANCHO_DROGA + SEPARACION, y + altoDerecha, { width: ANCHO_CANTIDAD, align: "right" });
    altoDerecha += alto;
  }
  doc.font("Helvetica").fontSize(10);
  return y + Math.max(altoIzquierda + 1, altoDerecha) + 2;
}

/** A línea weighed from its lots: droga, prescripción and "(500.000 U.I.)" on the left, then one row per lot. Returns the next y. */
function dibujarLineaConPesada(doc: PDFKit.PDFDocument, y: number, linea: LineaImprimir, pesada: PesadaDeLineaImprimir): number {
  doc.font("Helvetica").fontSize(10);
  const altoDroga = doc.heightOfString(linea.drogaNombre, { width: ANCHO_CONTENIDO });
  doc.text(linea.drogaNombre, MARGEN_IZQUIERDO, y, { width: ANCHO_CONTENIDO });
  y += altoDroga;
  const secundarias = [linea.prescripcion, `(${textoCantidad(linea)})`].filter((t): t is string => Boolean(t));
  doc.fontSize(8);
  for (const texto of secundarias) {
    const alto = doc.heightOfString(texto, { width: ANCHO_CONTENIDO });
    doc.text(texto, MARGEN_IZQUIERDO, y, { width: ANCHO_CONTENIDO });
    y += alto;
  }
  y += 2;
  if (pesada.tipo === "MANUAL") {
    const textos = pesada.cantidad ? textosMasa(pesada.cantidad, pesada.unidadSimbolo) : { principal: `______ ${pesada.unidadSimbolo}`, equivalencia: null };
    y = filaPesada(doc, y, "Cantidad manual", textos.principal, textos.equivalencia);
  } else {
    for (const lote of pesada.lotes) {
      const textos = textosMasa(lote.cantidad, lote.unidadSimbolo);
      y = filaPesada(doc, y, lote.factor ? `Lote ${lote.lote} (${lote.factor})` : `Lote ${lote.lote}`, textos.principal, textos.equivalencia);
    }
  }
  return y + 3;
}

/** Lays the ficha out from the top of the page; returns the y where the content ends. */
function dibujar(doc: PDFKit.PDFDocument, ficha: FichaParaImprimir, pesada?: PesadaImprimir): number {
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
    const pesadaLinea = linea.esEnraseManual ? undefined : pesada?.get(linea.orden);
    if (pesadaLinea) {
      y = dibujarLineaConPesada(doc, y, linea, pesadaLinea);
      continue;
    }
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

export async function buildFichaTecnicaPdf(ficha: FichaParaImprimir, pesada?: PesadaImprimir): Promise<Buffer> {
  return renderTicketPdf((doc) => dibujar(doc, ficha, pesada));
}

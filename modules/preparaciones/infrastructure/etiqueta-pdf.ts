/**
 * PDF layout for a preparación's etiqueta (M11, point 8.5), a copy of the
 * farmacia's real printed label (docs/specs/etiqueta-preparado.md): a rounded
 * border; a top band with the logo and, across a vertical rule, the director
 * técnico, the domicilio and the two phones; below, "Rp/" with the fórmula on
 * the left and, on the right, the paciente, the receta number, the dosis, the
 * quantity as a large green number with its forma, vía and fracción de dosis,
 * the vencimiento and the storage note; a footer with the médico.
 *
 * Every field has a FIXED place (coordinates measured on the real label): a
 * field that is missing leaves its place blank and never moves the others.
 * Long texts shrink to fit their place instead.
 *
 * WHAT is printed comes from `domain/etiqueta.ts#armarContenidoEtiqueta`
 * (DP-28 rules live there); this file only lays it out. Same engine as
 * `modules/elaboracion/infrastructure/ficha-pdf.ts` (pdfkit, standard
 * fonts). The real label uses Arial Narrow: Helvetica (Arial's metrics) is
 * drawn horizontally condensed (`ANGOSTO`) to match it. The layout is drawn
 * in a FIXED design space (100 × 42 mm) and scaled uniformly, centered, onto
 * the label size the caller chooses (one of the sizes the administrator
 * configured -- modules/etiqueta-tamanos); the layout is not re-flowed per size.
 * The PDF page is the SHEET the farmacia prints on (modules/etiqueta-tamanos, spec
 * docs/specs/hoja-etiquetas.md R6), not the label: the label is drawn inside the cell
 * (columna, fila) of the sheet's grid the user picked and the rest of the page stays
 * blank, so the printer drops it in that spot.
 *
 * Every text is drawn with `lineBreak: false` at explicit coordinates (no
 * automatic wrapping, hence no automatic page breaks): a single label is always
 * exactly one page; several (`buildEtiquetasPdf`) share a page unless they overlap.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import type { LogoPdf } from "@/shared/pdf/logo";
import { posicionCelda } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { Celda, HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { TamanoEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { columnasRp } from "../domain/etiqueta";
import type { ContenidoEtiqueta } from "../domain/etiqueta";

const PT_POR_MM = 72 / 25.4;

/** Design space: the 100 × 42 mm label in points. */
const DW = 100 * PT_POR_MM;
const DH = 42 * PT_POR_MM;

/** The brand green, also the quantity's. */
const VERDE = "#1cb78c";
const VERDE_TELEFONO = "#3eb548";
const VERDE_WHATSAPP = "#1ca94a";
const ROJO = "#ee1d25";
const NEGRO = "#000000";
const BLANCO = "#ffffff";

/** Horizontal scale of every text: Helvetica condensed to Arial Narrow's width. */
const ANGOSTO = 0.82;

/** Helvetica's cap height / ascender (AFM 718): pdfkit draws a text with its cap top at `y`, its baseline at `y + 0.718 * size`. */
const ALTURA_MAYUSCULA = 0.718;

// Frame and rules (design-space points).
const BORDE = 3;
const BANDA_Y = 40.4; // rule under the top band
const BANDA_DIV_X = 116.3; // vertical rule in the top band
const PANEL_DIV_X = 141.9; // vertical rule between Rp/ and the right panel
const PIE_Y = 102.2; // rule above the médico footer
const DERECHA = DW - BORDE - 4; // right limit of the texts
const REGLA_MARGEN = BORDE + 11.1; // the horizontal rules stop short of the border

type Doc = PDFKit.PDFDocument;
type Fuente = "Helvetica" | "Helvetica-Bold";

interface Tramo {
  texto: string;
  fuente: Fuente;
  /** Size relative to the line's size (1 when omitted); the tramos share one baseline. */
  escala?: number;
}

function anchoDe(doc: Doc, tramos: readonly Tramo[], tamano: number): number {
  return tramos.reduce((total, t) => total + doc.font(t.fuente).fontSize(tamano * (t.escala ?? 1)).widthOfString(t.texto) * ANGOSTO, 0);
}

/** Largest size <= `tamano` at which `tramos` fit in `ancho`. */
function tamanoQueEntra(doc: Doc, tramos: readonly Tramo[], tamano: number, ancho: number): number {
  const medida = anchoDe(doc, tramos, tamano);
  return medida > ancho ? (tamano * ancho) / medida : tamano;
}

/** Condensed mixed-font single line, cap top of the base size at (x, y), no wrapping. */
function linea(doc: Doc, tramos: readonly Tramo[], x: number, y: number, tamano: number, color: string): void {
  const base = y + tamano * ALTURA_MAYUSCULA;
  let cursor = x;
  for (const t of tramos) {
    const tam = tamano * (t.escala ?? 1);
    doc.save();
    doc.translate(cursor, base - tam * ALTURA_MAYUSCULA).scale(ANGOSTO, 1);
    doc.font(t.fuente).fontSize(tam).fillColor(color).text(t.texto, 0, 0, { lineBreak: false });
    doc.restore();
    cursor += doc.font(t.fuente).fontSize(tam).widthOfString(t.texto) * ANGOSTO;
  }
}

/** A single-font text shrunk to `ancho`, left-aligned at `x` (or centered on it with `centro`). */
function texto(doc: Doc, valor: string, x: number, y: number, tamano: number, ancho: number, color = NEGRO, centro = false): void {
  const tramos: Tramo[] = [{ texto: valor, fuente: "Helvetica" }];
  const tam = tamanoQueEntra(doc, tramos, tamano, ancho);
  linea(doc, tramos, centro ? x - anchoDe(doc, tramos, tam) / 2 : x, y, tam, color);
}

function regla(doc: Doc, x1: number, y1: number, x2: number, y2: number, grosor: number): void {
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(grosor).strokeColor(NEGRO).stroke();
}

/** Classic telephone (☎) in a `t`-point square at (x, y). */
function iconoTelefono(doc: Doc, x: number, y: number, t: number): void {
  doc.save().translate(x, y).scale(t / 10);
  // Handset over the body.
  doc.path("M0.3 3.2 C0.3 1.2 2.6 0.4 5 0.4 C7.4 0.4 9.7 1.2 9.7 3.2 L9.7 4 L7.2 4 L7.2 3 C6.5 2.6 3.5 2.6 2.8 3 L2.8 4 L0.3 4 Z").fill(VERDE_TELEFONO);
  doc.path("M3.2 3.6 L6.8 3.6 L9.2 8.2 C9.3 9.2 8.8 9.6 8 9.6 L2 9.6 C1.2 9.6 0.7 9.2 0.8 8.2 Z").fill(VERDE_TELEFONO);
  doc.circle(5, 6.6, 1.6).fill(BLANCO);
  doc.circle(5, 6.6, 0.6).fill(VERDE_TELEFONO);
  doc.restore();
}

/** WhatsApp bubble in a `t`-point square at (x, y). */
function iconoWhatsapp(doc: Doc, x: number, y: number, t: number): void {
  doc.save().translate(x, y).scale(t / 10);
  doc.circle(5.2, 4.8, 4.6).fill(VERDE_WHATSAPP);
  doc.path("M0.6 9.8 L1.6 6.4 L3.6 8.6 Z").fill(VERDE_WHATSAPP);
  // Handset (Material "phone" glyph, 24-unit box) in white.
  doc.save().translate(2.6, 2.2).scale(5.2 / 24);
  doc
    .path(
      "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
    )
    .fill(BLANCO);
  doc.restore();
  doc.restore();
}

/** Gap between the two Rp/ columns (`columnasRp`). */
const SEPARACION_COLUMNAS_RP = 1.5;

/** Rp/ line pitch, as a multiple of the font size (the real label: 6.9 pt for 6.4 pt type). */
const INTERLINEA_RP = 1.08;

/**
 * Rp/ font size by number of rows (per column, see `columnasRp`) -- largest
 * for one line. Further reduced to fit the column's width and the panel's height.
 */
export function tamanoFuenteRp(lineas: number): number {
  const tabla = [16, 12.5, 10, 8.5, 7.5, 6.9, 6.4, 5.8];
  return lineas <= tabla.length ? tabla[Math.max(lineas, 1) - 1]! : Math.max(3.5, 42 / (lineas * 1.2));
}

/** The box the tenant's logo fits in, keeping its proportion. */
const LOGO_ANCHO_MAX = 89.9;
const LOGO_ALTO_MAX = 30.2;

function dibujarBanda(doc: Doc, c: ContenidoEtiqueta, logo: LogoPdf | null): void {
  if (logo) {
    const alto = Math.min(LOGO_ANCHO_MAX / logo.proporcion, LOGO_ALTO_MAX);
    const ancho = alto * logo.proporcion;
    doc.image(logo.imagen, 20.5, (BORDE + BANDA_Y - alto) / 2, { width: ancho, height: alto });
  }

  const x = 124;
  const ancho = DERECHA - x;

  // "Director Técnico NAME - MAT. 1665": the name larger and bold, one baseline.
  const dt: Tramo[] = c.directorTecnico
    ? [
        { texto: "Director Técnico ", fuente: "Helvetica" },
        { texto: c.directorTecnico.nombre, fuente: "Helvetica-Bold", escala: 1.34 },
        { texto: ` - MAT. ${c.directorTecnico.matricula}`, fuente: "Helvetica", escala: 1.1 },
      ]
    : [{ texto: "Director Técnico ________________  MAT. ______", fuente: "Helvetica" }];
  linea(doc, dt, x, 11.2, tamanoQueEntra(doc, dt, 5.3, ancho), NEGRO);

  if (c.domicilio) texto(doc, c.domicilio, x, 17.8, 5.3, ancho);

  const xTelefono = 129.4;
  const tamanoIcono = 4.8;
  // Each icon is centered on its text's capitals.
  const iconoY = (textoY: number) => textoY + (5.3 * ALTURA_MAYUSCULA) / 2 - tamanoIcono / 2;
  if (c.telefonoFijo) {
    iconoTelefono(doc, 123.2, iconoY(25.4), tamanoIcono);
    texto(doc, `Teléfono fijo  ${c.telefonoFijo}`, xTelefono, 25.4, 5.3, DERECHA - xTelefono);
  }
  if (c.celular) {
    iconoWhatsapp(doc, 123.2, iconoY(32.2), tamanoIcono);
    texto(doc, `Celular  ${c.celular}`, xTelefono, 32.2, 5.3, DERECHA - xTelefono);
  }
}

function dibujarRp(doc: Doc, c: ContenidoEtiqueta): void {
  linea(doc, [{ texto: "Rp/", fuente: "Helvetica" }], 13.5, 43.7, 6.5, NEGRO);

  const x = 21.4;
  const ancho = PANEL_DIV_X - 2.5 - x;
  const arriba = 50;
  const abajo = PIE_Y - 3.6;
  const columnas = columnasRp(c.rp);
  if (columnas.length === 0) return;
  // One font size for the whole Rp/, driven by the rows of the tallest column
  // and shrunk until the widest line fits its column and every row fits the panel.
  const filas = Math.max(...columnas.map((col) => col.length));
  const fuente: Fuente = c.rp.length <= 2 ? "Helvetica-Bold" : "Helvetica";
  const anchoColumna = (ancho - SEPARACION_COLUMNAS_RP * (columnas.length - 1)) / columnas.length;
  let tamano = tamanoFuenteRp(filas);
  const masAncha = Math.max(...columnas.flat().map((l) => anchoDe(doc, [{ texto: l, fuente }], tamano)));
  if (masAncha > anchoColumna) tamano = (tamano * anchoColumna) / masAncha;
  if (tamano * INTERLINEA_RP * filas > abajo - arriba) tamano = (abajo - arriba) / (filas * INTERLINEA_RP);
  const primeraY = arriba + (abajo - arriba - tamano * INTERLINEA_RP * filas) / 2;
  columnas.forEach((col, i) => {
    const colX = x + i * (anchoColumna + SEPARACION_COLUMNAS_RP);
    col.forEach((l, fila) => linea(doc, [{ texto: l, fuente }], colX, primeraY + fila * tamano * INTERLINEA_RP, tamano, NEGRO));
  });
}

/** Wraps `valor` into at most `maxLineas` lines of `ancho`, shrinking the size from `tamano` until it does. */
function envolver(doc: Doc, valor: string, tamano: number, ancho: number, maxLineas: number): { lineas: string[]; tamano: number } {
  const palabras = valor.split(" ");
  for (let tam = tamano; ; tam -= 0.25) {
    const medir = (s: string) => anchoDe(doc, [{ texto: s, fuente: "Helvetica" }], tam);
    const lineas: string[] = [];
    let actual = "";
    let entra = true;
    for (const palabra of palabras) {
      if (medir(palabra) > ancho) entra = false;
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (medir(prueba) <= ancho || !actual) actual = prueba;
      else {
        lineas.push(actual);
        actual = palabra;
      }
    }
    if (actual) lineas.push(actual);
    if ((entra && lineas.length <= maxLineas) || tam <= 3) return { lineas: lineas.slice(0, maxLineas), tamano: tam };
  }
}

function dibujarPanel(doc: Doc, c: ContenidoEtiqueta): void {
  const xIzquierda = 145.2;
  const xDerecha = 232.6;

  if (c.paciente) texto(doc, `Paciente:${c.paciente}`, xIzquierda, 45, 6.5, xDerecha - 3 - xIzquierda);
  texto(doc, `Receta N:${c.recetaNumero}`, xDerecha, 44.7, 6.5, DERECHA - xDerecha);
  if (c.dosis) {
    // "Dosis: ..." in its column under the receta number, wrapped down to the storage note.
    const { lineas, tamano } = envolver(doc, `Dosis: ${c.dosis}`, 6.5, DERECHA - xDerecha, 4);
    lineas.forEach((l, i) => linea(doc, [{ texto: l, fuente: "Helvetica" }], xDerecha, 53.3 + i * tamano * 1.15, tamano, NEGRO));
  }

  // Large green quantity, right-aligned so its digits always end at the same place.
  const numero: Tramo[] = [{ texto: String(c.cantidad), fuente: "Helvetica" }];
  const finNumero = 189;
  const tamanoNumero = tamanoQueEntra(doc, numero, 33, finNumero - (PANEL_DIV_X + 3));
  linea(doc, numero, finNumero - anchoDe(doc, numero, tamanoNumero), 57.9 + (33 - tamanoNumero) * ALTURA_MAYUSCULA * 0.5, tamanoNumero, VERDE);

  // Forma / vía / fracción: three fixed lines, centered on one axis.
  const centroForma = 210.2;
  const anchoForma = 2 * (xDerecha - 3 - centroForma);
  texto(doc, c.forma, centroForma, 59.2, 7.8, anchoForma, NEGRO, true);
  if (c.via) texto(doc, c.via, centroForma, 67.3, 7.8, anchoForma, NEGRO, true);
  if (c.fraccionDosis) texto(doc, c.fraccionDosis, centroForma, 75.6, 7.8, anchoForma, NEGRO, true);

  texto(doc, c.vence, xIzquierda, 93, 6.4, 45);
  texto(doc, c.conservacion, 223.8, 94, 5, 2 * (DERECHA - 223.8), ROJO, true);
}

function dibujarPie(doc: Doc, c: ContenidoEtiqueta): void {
  texto(doc, c.medico, DW / 2, 105.5, 6.4, DW - 2 * (BORDE + 14), NEGRO, true);
}

/** Where the design lands on the page, in points: the origin of the (scaled) design space and its uniform scale. */
export interface ColocacionEtiqueta {
  x: number;
  y: number;
  escala: number;
}

/**
 * R4 + R6: the design is scaled uniformly and centered inside the cell (columna, fila) of the grid of `tamano` on `hoja`,
 * whose top-left corner is `posicionCelda` (exact in mm, the grid is anchored at the sheet's margin).
 */
export function colocarEtiqueta(tamano: TamanoEtiqueta, hoja: HojaEtiqueta, celda: Celda): ColocacionEtiqueta {
  const ancho = tamano.anchoMm * PT_POR_MM;
  const alto = tamano.altoMm * PT_POR_MM;
  const escala = Math.min(ancho / DW, alto / DH);
  const { xMm, yMm } = posicionCelda(hoja, tamano, celda);
  return { x: xMm * PT_POR_MM + (ancho - DW * escala) / 2, y: yMm * PT_POR_MM + (alto - DH * escala) / 2, escala };
}

/** Draws one etiqueta on the current page, its design space placed by `colocacion`. */
function dibujarEtiqueta(doc: PDFKit.PDFDocument, contenido: ContenidoEtiqueta, colocacion: ColocacionEtiqueta, logo: LogoPdf | null): void {
  doc.save();
  doc.translate(colocacion.x, colocacion.y).scale(colocacion.escala);

  // Frame and rules.
  doc.roundedRect(BORDE, BORDE, DW - 2 * BORDE, DH - 2 * BORDE, 12).lineWidth(1.1).strokeColor(NEGRO).stroke();
  regla(doc, BANDA_DIV_X, 8.6, BANDA_DIV_X, 37.8, 1);
  regla(doc, REGLA_MARGEN, BANDA_Y, DW - REGLA_MARGEN, BANDA_Y, 1.6);
  regla(doc, PANEL_DIV_X, 43.4, PANEL_DIV_X, 99.6, 1.2);
  regla(doc, REGLA_MARGEN, PIE_Y, DW - REGLA_MARGEN, PIE_Y, 1.6);

  dibujarBanda(doc, contenido, logo);
  dibujarRp(doc, contenido);
  dibujarPanel(doc, contenido);
  dibujarPie(doc, contenido);

  doc.restore();
}

/** Renders the sheet (`hoja`, mm) as ONE page with the etiqueta of `tamano` (mm) drawn in the cell `celda` (1-based). The caller checks that the cell is in the grid (`celdaValida`). */
export function buildEtiquetaPdf(
  contenido: ContenidoEtiqueta,
  tamano: TamanoEtiqueta,
  hoja: HojaEtiqueta,
  celda: Celda = { columna: 1, fila: 1 },
  logo: LogoPdf | null = null,
): Promise<Buffer> {
  return buildEtiquetasPdf([{ contenido, tamano, celda }], hoja, logo);
}

/** One etiqueta of a multi-etiqueta print: what, at which size, in which cell. */
export interface EtiquetaEnHoja {
  contenido: ContenidoEtiqueta;
  tamano: TamanoEtiqueta;
  celda: Celda;
}

interface Rectangulo {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

function rectanguloDe({ tamano, celda }: EtiquetaEnHoja, hoja: HojaEtiqueta): Rectangulo {
  const { xMm, yMm } = posicionCelda(hoja, tamano, celda);
  return { x: xMm, y: yMm, ancho: tamano.anchoMm, alto: tamano.altoMm };
}

function seSuperponen(a: Rectangulo, b: Rectangulo): boolean {
  return a.x < b.x + b.ancho && b.x < a.x + a.ancho && a.y < b.y + b.alto && b.y < a.y + a.alto;
}

/**
 * Several etiquetas in ONE PDF (the toma's single "Imprimir", docs/specs/hoja-etiquetas.md R14), in the given order:
 * each in its own cell of the SAME sheet while they do not overlap -- the farmacia prints them all on one sheet -- and
 * a new page (sheet) when one would overlap an etiqueta already on the current page (e.g. two left on 1 / 1).
 */
export function buildEtiquetasPdf(etiquetas: readonly EtiquetaEnHoja[], hoja: HojaEtiqueta, logo: LogoPdf | null = null): Promise<Buffer> {
  const pagina: [number, number] = [hoja.anchoMm * PT_POR_MM, hoja.altoMm * PT_POR_MM];
  return renderPdf(
    (doc) => {
      let ocupados: Rectangulo[] = [];
      for (const etiqueta of etiquetas) {
        const rectangulo = rectanguloDe(etiqueta, hoja);
        if (ocupados.some((otro) => seSuperponen(otro, rectangulo))) {
          doc.addPage({ size: pagina, margin: 0 });
          ocupados = [];
        }
        ocupados.push(rectangulo);
        dibujarEtiqueta(doc, etiqueta.contenido, colocarEtiqueta(etiqueta.tamano, hoja, etiqueta.celda), logo);
      }
    },
    { size: pagina, margin: 0 },
  );
}

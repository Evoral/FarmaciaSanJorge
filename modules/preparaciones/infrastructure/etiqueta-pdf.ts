/**
 * PDF layout for a preparación's etiqueta (M11, point 8.5), modeled on the
 * farmacia's real printed label: a thick rounded border; a top band with the
 * brand (logo + "san jorge" wordmark) and, across a vertical rule, the
 * director técnico and domicilio; below, "Rp/" with the fórmula on the left
 * and, on the right, the receta number, the quantity as a large green number
 * with its forma and vía, and the storage note; a footer with the médico.
 *
 * WHAT is printed comes from `domain/etiqueta.ts#armarContenidoEtiqueta`
 * (DP-28 rules live there); this file only lays it out. Same engine as
 * `modules/elaboracion/infrastructure/ficha-pdf.ts` (pdfkit, standard
 * fonts). The layout is drawn in a fixed design space and scaled uniformly
 * onto `ETIQUETA_TAMANO_MM`, so changing the size is a one-line edit.
 *
 * Every text is drawn with `lineBreak: false` at explicit coordinates (no
 * automatic wrapping, hence no automatic page breaks): the label is always
 * exactly one page.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderPdf } from "@/shared/pdf/pdf-document";
import type { ContenidoEtiqueta } from "../domain/etiqueta";

/** PENDING (DP-28): label size, landscape. The printer is not known yet. */
export const ETIQUETA_TAMANO_MM = { ancho: 100, alto: 42 } as const;

const PT_POR_MM = 72 / 25.4;

/** Design space: the 100 × 42 mm label in points. */
const DW = 100 * PT_POR_MM;
const DH = 42 * PT_POR_MM;

/** The farmacia green: `--color-primary` in app/globals.css. */
const VERDE = "#037a5c";
const GRIS = "#3f3f46";
const ROJO = "#c62828";
const NEGRO = "#000000";

const MARCA = { nombre: "san jorge", bajada: "FARMACIA Y LABORATORIO" } as const;

// Layout (design-space points).
const BORDE = 3;
const BANDA_Y = 40; // bottom of the top band
const BANDA_DIV_X = 115; // vertical rule in the top band
const PANEL_DIV_X = 150; // vertical rule between Rp/ and the quantity panel
const PIE_Y = 101; // rule above the médico footer
const PAD = 6;

let logoCache: Buffer | null | undefined;

/** `public/logo.png` (the pill icon), read once. Missing file -> the label is drawn without it. */
function logo(): Buffer | null {
  if (logoCache === undefined) {
    try {
      logoCache = readFileSync(path.join(process.cwd(), "public", "logo.png"));
    } catch {
      logoCache = null;
    }
  }
  return logoCache;
}

type Doc = PDFKit.PDFDocument;
type Fuente = "Helvetica" | "Helvetica-Bold";

interface Tramo {
  texto: string;
  fuente: Fuente;
}

/** Largest size <= `tamano` at which `tramos` fit in `ancho`. */
function tamanoQueEntra(doc: Doc, tramos: readonly Tramo[], tamano: number, ancho: number): number {
  const medida = tramos.reduce((total, t) => total + doc.font(t.fuente).fontSize(tamano).widthOfString(t.texto), 0);
  return medida > ancho ? (tamano * ancho) / medida : tamano;
}

function anchoDe(doc: Doc, tramos: readonly Tramo[], tamano: number): number {
  return tramos.reduce((total, t) => total + doc.font(t.fuente).fontSize(tamano).widthOfString(t.texto), 0);
}

/** Mixed-font single line at (x, y), no wrapping. */
function linea(doc: Doc, tramos: readonly Tramo[], x: number, y: number, tamano: number, color: string): void {
  let cursor = x;
  for (const t of tramos) {
    doc.font(t.fuente).fontSize(tamano).fillColor(color).text(t.texto, cursor, y, { lineBreak: false });
    cursor += doc.widthOfString(t.texto);
  }
}

function regla(doc: Doc, x1: number, y1: number, x2: number, y2: number): void {
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(0.8).strokeColor(NEGRO).stroke();
}

/**
 * PENDING (DP-28): Rp/ font size by number of lines -- largest for one line,
 * about 8 lines still fit. Further reduced to fit the panel's width/height.
 */
export function tamanoFuenteRp(lineas: number): number {
  const tabla = [16, 12.5, 10, 8.5, 7.5, 6.5, 5.8, 5.2];
  return lineas <= tabla.length ? tabla[Math.max(lineas, 1) - 1]! : Math.max(3.5, 42 / (lineas * 1.2));
}

function dibujarBanda(doc: Doc, c: ContenidoEtiqueta): void {
  // Brand: icon + wordmark.
  const icono = logo();
  const tamanoIcono = 29;
  const iconoX = BORDE + 5;
  if (icono) doc.image(icono, iconoX, (BORDE + BANDA_Y - tamanoIcono) / 2, { width: tamanoIcono, height: tamanoIcono });
  const marcaX = icono ? iconoX + tamanoIcono + 2 : iconoX;
  const marcaAncho = BANDA_DIV_X - marcaX - 4;
  const tamanoNombre = tamanoQueEntra(doc, [{ texto: MARCA.nombre, fuente: "Helvetica-Bold" }], 17, marcaAncho);
  linea(doc, [{ texto: MARCA.nombre, fuente: "Helvetica-Bold" }], marcaX, 9, tamanoNombre, GRIS);
  const tamanoBajada = tamanoQueEntra(doc, [{ texto: MARCA.bajada, fuente: "Helvetica-Bold" }], 4.8, marcaAncho);
  linea(doc, [{ texto: MARCA.bajada, fuente: "Helvetica-Bold" }], marcaX, 9 + tamanoNombre + 1, tamanoBajada, VERDE);

  // Director técnico + domicilio. Phones: no data on the farmacia yet (DP-28), omitted.
  const x = BANDA_DIV_X + PAD;
  const ancho = DW - BORDE - PAD - x;
  const dt: Tramo[] = c.directorTecnico
    ? [
        { texto: "Director Técnico ", fuente: "Helvetica" },
        { texto: c.directorTecnico.nombre, fuente: "Helvetica-Bold" },
        { texto: ` - MAT. ${c.directorTecnico.matricula}`, fuente: "Helvetica" },
      ]
    : [{ texto: "Director Técnico ________________  MAT. ______", fuente: "Helvetica" }];
  const tamanoDt = tamanoQueEntra(doc, dt, 5.8, ancho);
  linea(doc, dt, x, 10, tamanoDt, NEGRO);
  if (c.domicilio) {
    doc.font("Helvetica").fontSize(5.3).fillColor(NEGRO).text(c.domicilio, x, 19, { width: ancho, height: 16, ellipsis: true });
  }
}

function dibujarRp(doc: Doc, c: ContenidoEtiqueta): void {
  linea(doc, [{ texto: "Rp/", fuente: "Helvetica-Bold" }], BORDE + PAD, BANDA_Y + 4, 6.5, NEGRO);

  const x = BORDE + PAD + 5;
  const ancho = PANEL_DIV_X - PAD - x;
  const arriba = BANDA_Y + 12;
  const abajo = PIE_Y - 12;
  const n = c.rp.length;
  if (n > 0) {
    const fuente: Fuente = n <= 2 ? "Helvetica-Bold" : "Helvetica";
    let tamano = tamanoFuenteRp(n);
    const masAncha = Math.max(...c.rp.map((l) => anchoDe(doc, [{ texto: l, fuente }], tamano)));
    if (masAncha > ancho) tamano = (tamano * ancho) / masAncha;
    const interlinea = tamano * 1.2;
    if (interlinea * n > abajo - arriba) tamano = (abajo - arriba) / (n * 1.2);
    const alto = tamano * 1.2 * n;
    let y = arriba + (abajo - arriba - alto) / 2;
    for (const l of c.rp) {
      linea(doc, [{ texto: l, fuente }], x, y, tamano, NEGRO);
      y += tamano * 1.2;
    }
  }

  linea(doc, [{ texto: c.vence, fuente: "Helvetica" }], BORDE + PAD, PIE_Y - 9, 6, NEGRO);
}

function dibujarCantidad(doc: Doc, c: ContenidoEtiqueta): void {
  const izquierda = PANEL_DIV_X;
  const derecha = DW - BORDE;
  const ancho = derecha - izquierda - 2 * PAD;

  // "Receta N 42", top-right.
  const receta: Tramo[] = [
    { texto: "Receta N ", fuente: "Helvetica" },
    { texto: c.recetaNumero, fuente: "Helvetica-Bold" },
  ];
  const tamanoReceta = tamanoQueEntra(doc, receta, 6.5, ancho);
  linea(doc, receta, derecha - PAD - anchoDe(doc, receta, tamanoReceta), BANDA_Y + 4, tamanoReceta, NEGRO);

  // Large green quantity, forma/vía in two small lines to its right, centered as a block.
  const numero = String(c.cantidad);
  const tamanoForma = 7;
  const anchoForma = Math.max(anchoDe(doc, [{ texto: c.forma, fuente: "Helvetica" }], tamanoForma), c.via ? anchoDe(doc, [{ texto: c.via, fuente: "Helvetica" }], tamanoForma) : 0);
  const separacion = 3;
  const tamanoNumero = tamanoQueEntra(doc, [{ texto: numero, fuente: "Helvetica-Bold" }], 30, ancho - anchoForma - separacion);
  const anchoNumero = anchoDe(doc, [{ texto: numero, fuente: "Helvetica-Bold" }], tamanoNumero);
  const bloqueX = izquierda + PAD + (ancho - anchoNumero - separacion - anchoForma) / 2;
  const numeroY = BANDA_Y + 15;
  linea(doc, [{ texto: numero, fuente: "Helvetica-Bold" }], bloqueX, numeroY, tamanoNumero, VERDE);

  // Centered on the digits' visual middle (cap height ~0.72 of the size, below the ascender gap).
  const centro = numeroY + tamanoNumero * 0.47;
  const formaX = bloqueX + anchoNumero + separacion;
  if (c.via) {
    linea(doc, [{ texto: c.forma, fuente: "Helvetica" }], formaX, centro - tamanoForma * 1.1, tamanoForma, NEGRO);
    linea(doc, [{ texto: c.via, fuente: "Helvetica" }], formaX, centro + tamanoForma * 0.05, tamanoForma, NEGRO);
  } else {
    linea(doc, [{ texto: c.forma, fuente: "Helvetica" }], formaX, centro - tamanoForma * 0.55, tamanoForma, NEGRO);
  }

  const conservacion: Tramo[] = [{ texto: c.conservacion, fuente: "Helvetica" }];
  const tamanoConservacion = tamanoQueEntra(doc, conservacion, 5.8, ancho);
  linea(doc, conservacion, izquierda + PAD + (ancho - anchoDe(doc, conservacion, tamanoConservacion)) / 2, PIE_Y - 9, tamanoConservacion, ROJO);
}

function dibujarPie(doc: Doc, c: ContenidoEtiqueta): void {
  const texto = c.paciente ? `Paciente ${c.paciente}    ${c.medico}` : c.medico;
  const tramos: Tramo[] = [{ texto, fuente: "Helvetica" }];
  const ancho = DW - 2 * (BORDE + PAD);
  const tamano = tamanoQueEntra(doc, tramos, 6.5, ancho);
  const x = (DW - anchoDe(doc, tramos, tamano)) / 2;
  const y = PIE_Y + (DH - BORDE - PIE_Y - tamano) / 2 - 0.5;
  linea(doc, tramos, x, y, tamano, NEGRO);
}

export function buildEtiquetaPdf(contenido: ContenidoEtiqueta): Promise<Buffer> {
  const ancho = ETIQUETA_TAMANO_MM.ancho * PT_POR_MM;
  const alto = ETIQUETA_TAMANO_MM.alto * PT_POR_MM;
  const escala = Math.min(ancho / DW, alto / DH);

  return renderPdf(
    (doc) => {
      doc.save();
      doc.translate((ancho - DW * escala) / 2, (alto - DH * escala) / 2).scale(escala);

      // Frame and rules.
      doc.roundedRect(BORDE, BORDE, DW - 2 * BORDE, DH - 2 * BORDE, 9).lineWidth(2.4).strokeColor(NEGRO).stroke();
      regla(doc, BANDA_DIV_X, BORDE, BANDA_DIV_X, BANDA_Y);
      regla(doc, BORDE, BANDA_Y, DW - BORDE, BANDA_Y);
      regla(doc, PANEL_DIV_X, BANDA_Y, PANEL_DIV_X, PIE_Y);
      regla(doc, BORDE, PIE_Y, DW - BORDE, PIE_Y);

      dibujarBanda(doc, contenido);
      dibujarRp(doc, contenido);
      dibujarCantidad(doc, contenido);
      dibujarPie(doc, contenido);

      doc.restore();
    },
    { size: [ancho, alto], margin: 0 },
  );
}

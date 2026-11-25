/**
 * Drawing primitives shared by every layout of the preparado's etiqueta (`etiqueta-pdf.ts`, the classic 100 × 42 mm
 * design, and `etiqueta-pdf-compacta.ts`, the wide and the tall ones): condensed text that shrinks to its place, rules,
 * the rounded frame, the phone icons and the Rp/ columns. Every layout is drawn in its own fixed design space stretched
 * to the label's size; `enCelda` turns on the horizontal compensation that keeps glyphs, icons and the logo in proportion.
 */
import { columnasRp } from "../domain/etiqueta";

export const PT_POR_MM = 72 / 25.4;

/** The brand green, also the quantity's. */
export const VERDE = "#1cb78c";
export const VERDE_TELEFONO = "#3eb548";
export const VERDE_WHATSAPP = "#1ca94a";
export const ROJO = "#ee1d25";
export const NEGRO = "#000000";
export const BLANCO = "#ffffff";

/** Horizontal scale of every text: Helvetica condensed to Arial Narrow's width. */
const ANGOSTO = 0.82;

/** Helvetica's cap height / ascender (AFM 718): pdfkit draws a text with its cap top at `y`, its baseline at `y + 0.718 * size`. */
export const ALTURA_MAYUSCULA = 0.718;

export type Doc = PDFKit.PDFDocument;
export type Fuente = "Helvetica" | "Helvetica-Bold";

export interface Tramo {
  texto: string;
  fuente: Fuente;
  /** Size relative to the line's size (1 when omitted); the tramos share one baseline. */
  escala?: number;
}

/**
 * Horizontal compensation per document while an etiqueta is drawn: the design is stretched to fill its cell
 * (`escalaX` ≠ `escalaY`), so every glyph, icon and the logo are drawn `escalaY / escalaX` as wide in design space to
 * keep their proportions on paper. 1 (absent) for a cell with the design's own proportion.
 */
const compensacionX = new WeakMap<Doc, number>();

export function compX(doc: Doc): number {
  return compensacionX.get(doc) ?? 1;
}

/** Where a design lands on the page, in points: the origin of the design space (the cell's corner) and its scale on each axis. */
export interface ColocacionEtiqueta {
  x: number;
  y: number;
  escalaX: number;
  escalaY: number;
}

/** Runs `dibujar` in the design space placed by `colocacion`, with the stretch's horizontal compensation on. */
export function enCelda(doc: Doc, colocacion: ColocacionEtiqueta, dibujar: () => void): void {
  doc.save();
  doc.translate(colocacion.x, colocacion.y).scale(colocacion.escalaX, colocacion.escalaY);
  compensacionX.set(doc, colocacion.escalaY / colocacion.escalaX);
  try {
    dibujar();
  } finally {
    compensacionX.delete(doc);
    doc.restore();
  }
}

/** Horizontal scale of a glyph in design space: Arial Narrow's width, compensated for the cell's stretch. */
function angosto(doc: Doc): number {
  return ANGOSTO * compX(doc);
}

export function anchoDe(doc: Doc, tramos: readonly Tramo[], tamano: number): number {
  return tramos.reduce((total, t) => total + doc.font(t.fuente).fontSize(tamano * (t.escala ?? 1)).widthOfString(t.texto) * angosto(doc), 0);
}

/** Largest size <= `tamano` at which `tramos` fit in `ancho`. */
export function tamanoQueEntra(doc: Doc, tramos: readonly Tramo[], tamano: number, ancho: number): number {
  const medida = anchoDe(doc, tramos, tamano);
  return medida > ancho ? (tamano * ancho) / medida : tamano;
}

/** Condensed mixed-font single line, cap top of the base size at (x, y), no wrapping. */
export function linea(doc: Doc, tramos: readonly Tramo[], x: number, y: number, tamano: number, color: string): void {
  const base = y + tamano * ALTURA_MAYUSCULA;
  let cursor = x;
  for (const t of tramos) {
    const tam = tamano * (t.escala ?? 1);
    doc.save();
    doc.translate(cursor, base - tam * ALTURA_MAYUSCULA).scale(angosto(doc), 1);
    doc.font(t.fuente).fontSize(tam).fillColor(color).text(t.texto, 0, 0, { lineBreak: false });
    doc.restore();
    cursor += doc.font(t.fuente).fontSize(tam).widthOfString(t.texto) * angosto(doc);
  }
}

/** A single-font text shrunk to `ancho`, left-aligned at `x` (or centered on it with `centro`). */
export function texto(doc: Doc, valor: string, x: number, y: number, tamano: number, ancho: number, color = NEGRO, centro = false, fuente: Fuente = "Helvetica"): void {
  lineaQueEntra(doc, [{ texto: valor, fuente }], x, y, tamano, ancho, color, centro);
}

/** Mixed-font line shrunk to `ancho`, left-aligned at `x` (or centered on it with `centro`); its cap top stays at `y`. */
export function lineaQueEntra(doc: Doc, tramos: readonly Tramo[], x: number, y: number, tamano: number, ancho: number, color = NEGRO, centro = false): void {
  const tam = tamanoQueEntra(doc, tramos, tamano, ancho);
  linea(doc, tramos, centro ? x - anchoDe(doc, tramos, tam) / 2 : x, y, tam, color);
}

/**
 * Priority fallback for a field that must stay legible on a small label: the first of `variantes` (most complete first)
 * that fits `ancho` at `minimo` or larger; when none does, the last (shortest) one, shrunk to fit. Drawn as `lineaQueEntra`.
 */
export function lineaPrioritaria(
  doc: Doc,
  variantes: readonly (readonly Tramo[])[],
  x: number,
  y: number,
  tamano: number,
  minimo: number,
  ancho: number,
  color = NEGRO,
  centro = false,
): void {
  const elegida = variantes.find((v) => tamanoQueEntra(doc, v, tamano, ancho) >= minimo) ?? variantes[variantes.length - 1];
  if (elegida) lineaQueEntra(doc, elegida, x, y, tamano, ancho, color, centro);
}

/**
 * The médico from most to least complete: "Médico: Nombre - MAT:número", "Nombre - MAT:número", "Nombre". On a small
 * label the médico is never dropped: at worst only the name is printed, as large as it fits.
 */
export function variantesMedico(medico: string): Tramo[][] {
  const sinRotulo = medico.replace(/^Médico:\s*/, "").trim();
  const nombre = sinRotulo.split(/\s+-\s+MAT:/)[0]!.trim();
  return [...new Set([medico.trim(), sinRotulo, nombre])].filter(Boolean).map((t) => [{ texto: t, fuente: "Helvetica" as const }]);
}

/** A horizontal or vertical rule; a vertical one is thinned by the stretch so both keep the same thickness on paper. */
export function regla(doc: Doc, x1: number, y1: number, x2: number, y2: number, grosor: number): void {
  doc
    .moveTo(x1, y1)
    .lineTo(x2, y2)
    .lineWidth(x1 === x2 ? grosor * compX(doc) : grosor)
    .strokeColor(NEGRO)
    .stroke();
}

/** Rounded rectangle whose corners stay round on paper: the corner's horizontal radius is compensated for the stretch. */
export function rectanguloRedondeado(doc: Doc, x: number, y: number, ancho: number, alto: number, radio: number): Doc {
  const rx = radio * compX(doc);
  const ry = radio;
  const k = 0.5523; // cubic Bézier approximation of a quarter ellipse
  return doc
    .moveTo(x + rx, y)
    .lineTo(x + ancho - rx, y)
    .bezierCurveTo(x + ancho - rx + rx * k, y, x + ancho, y + ry - ry * k, x + ancho, y + ry)
    .lineTo(x + ancho, y + alto - ry)
    .bezierCurveTo(x + ancho, y + alto - ry + ry * k, x + ancho - rx + rx * k, y + alto, x + ancho - rx, y + alto)
    .lineTo(x + rx, y + alto)
    .bezierCurveTo(x + rx - rx * k, y + alto, x, y + alto - ry + ry * k, x, y + alto - ry)
    .lineTo(x, y + ry)
    .bezierCurveTo(x, y + ry - ry * k, x + rx - rx * k, y, x + rx, y)
    .closePath();
}

/** The rounded frame (and the background inside it, when the size has one). */
export function dibujarRecuadro(doc: Doc, ancho: number, alto: number, borde: number, radio: number, colorFondo?: string | null): void {
  if (colorFondo) {
    doc.save();
    // Same rounded shape as the marco: a plain rect shows past its corners and outer edge.
    rectanguloRedondeado(doc, borde, borde, ancho - 2 * borde, alto - 2 * borde, radio).fillColor(colorFondo).fill();
    doc.restore();
  }
  rectanguloRedondeado(doc, borde, borde, ancho - 2 * borde, alto - 2 * borde, radio).lineWidth(1.1).strokeColor(NEGRO).stroke();
}

/** Classic telephone (☎) in a `t`-point square at (x, y). */
export function iconoTelefono(doc: Doc, x: number, y: number, t: number): void {
  doc.save().translate(x, y).scale((t / 10) * compX(doc), t / 10);
  // Handset over the body.
  doc.path("M0.3 3.2 C0.3 1.2 2.6 0.4 5 0.4 C7.4 0.4 9.7 1.2 9.7 3.2 L9.7 4 L7.2 4 L7.2 3 C6.5 2.6 3.5 2.6 2.8 3 L2.8 4 L0.3 4 Z").fill(VERDE_TELEFONO);
  doc.path("M3.2 3.6 L6.8 3.6 L9.2 8.2 C9.3 9.2 8.8 9.6 8 9.6 L2 9.6 C1.2 9.6 0.7 9.2 0.8 8.2 Z").fill(VERDE_TELEFONO);
  doc.circle(5, 6.6, 1.6).fill(BLANCO);
  doc.circle(5, 6.6, 0.6).fill(VERDE_TELEFONO);
  doc.restore();
}

/** WhatsApp bubble in a `t`-point square at (x, y). */
export function iconoWhatsapp(doc: Doc, x: number, y: number, t: number): void {
  doc.save().translate(x, y).scale((t / 10) * compX(doc), t / 10);
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

/** Wraps `valor` into at most `maxLineas` lines of `ancho`, shrinking the size from `tamano` until it does. */
export function envolver(doc: Doc, valor: string, tamano: number, ancho: number, maxLineas: number): { lineas: string[]; tamano: number } {
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

/** Gap between the two Rp/ columns (`columnasRp`). */
const SEPARACION_COLUMNAS_RP = 4;

/** Rp/ line pitch, as a multiple of the font size (the real label: 6.9 pt for 6.4 pt type). */
export const INTERLINEA_RP = 1.08;

/**
 * Rp/ font size by number of rows (per column, see `columnasRp`) -- largest
 * for one line. Further reduced to fit the column's width and the area's height.
 */
export function tamanoFuenteRp(lineas: number): number {
  const tabla = [16, 12.5, 10, 8.5, 7.5, 6.9, 6.4, 5.8];
  return lineas <= tabla.length ? tabla[Math.max(lineas, 1) - 1]! : Math.max(3.5, 42 / (lineas * 1.2));
}

/** The box the fórmula fills, in design-space points. */
export interface AreaRp {
  x: number;
  derecha: number;
  arriba: number;
  abajo: number;
}

/**
 * R12: how much narrower than its usual width the fórmula's type may get when the width, not the height, limits its
 * size (a long drug line with room left below): the type grows taller instead, every drug still on one line.
 */
export const CONDENSACION_MINIMA_RP = 0.85;

/** Where the Rp/ columns go: one font size for all of them, the left edge of each and where the first row starts. */
export interface DistribucionRp {
  tamano: number;
  xs: number[];
  primeraY: number;
  /** Extra horizontal scale of the glyphs: 1 = none, down to `CONDENSACION_MINIMA_RP`. */
  condensacion: number;
}

/**
 * Lays out the Rp/ columns in `area`. `anchosBase` is each column's widest line measured at `tamanoFuenteRp(filas)`.
 * Each column is as wide as its own widest line (one long line does not squeeze the other column); the size shrinks
 * until the columns side by side fit the width and every row fits the height. When the width is what limits it and the
 * height has room, the glyphs are first condensed (down to `CONDENSACION_MINIMA_RP`) so the size can grow toward what
 * the height allows. The block is centered both ways: the width left over is shared equally before, between and after
 * the columns (a short fórmula sits in the middle).
 */
export function distribuirColumnasRp(anchosBase: readonly number[], filas: number, area: AreaRp): DistribucionRp {
  const { x, derecha, arriba, abajo } = area;
  const base = tamanoFuenteRp(filas);
  const disponible = derecha - x - SEPARACION_COLUMNAS_RP * (anchosBase.length - 1);
  const total = anchosBase.reduce((suma, a) => suma + a, 0);
  const topeAlto = (abajo - arriba) / (filas * INTERLINEA_RP);
  // The size the rows and the height allow; condensing only helps to reach it, never beyond.
  const objetivo = Math.min(base, topeAlto);
  const condensacion = total > 0 ? Math.min(1, Math.max(CONDENSACION_MINIMA_RP, (disponible * base) / (total * objetivo))) : 1;
  const totalCondensado = total * condensacion;
  let tamano = totalCondensado > disponible ? (base * disponible) / totalCondensado : base;
  if (tamano > topeAlto) tamano = topeAlto;
  const escala = (tamano / base) * condensacion;
  const hueco = Math.max(0, disponible - total * escala) / (anchosBase.length + 1);
  const xs: number[] = [];
  let colX = x + hueco;
  for (const ancho of anchosBase) {
    xs.push(colX);
    colX += ancho * escala + hueco + SEPARACION_COLUMNAS_RP;
  }
  return { tamano, xs, primeraY: arriba + (abajo - arriba - tamano * INTERLINEA_RP * filas) / 2, condensacion };
}

/** The fórmula in `area`: one or two columns (`columnasRp`), bold when it is one or two drugs. */
export function dibujarFormula(doc: Doc, rp: readonly string[], area: AreaRp): void {
  const columnas = columnasRp(rp);
  if (columnas.length === 0) return;
  const filas = Math.max(...columnas.map((col) => col.length));
  const fuente: Fuente = rp.length <= 2 ? "Helvetica-Bold" : "Helvetica";
  const base = tamanoFuenteRp(filas);
  const anchos = columnas.map((col) => Math.max(...col.map((l) => anchoDe(doc, [{ texto: l, fuente }], base))));
  const { tamano, xs, primeraY, condensacion } = distribuirColumnasRp(anchos, filas, area);
  const previa = compensacionX.get(doc);
  compensacionX.set(doc, (previa ?? 1) * condensacion);
  try {
    columnas.forEach((col, i) => {
      col.forEach((l, fila) => linea(doc, [{ texto: l, fuente }], xs[i]!, primeraY + fila * tamano * INTERLINEA_RP, tamano, NEGRO));
    });
  } finally {
    if (previa === undefined) compensacionX.delete(doc);
    else compensacionX.set(doc, previa);
  }
}

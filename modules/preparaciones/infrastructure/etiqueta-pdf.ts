/**
 * PDF layout for a preparación's etiqueta (M11, point 8.5), a copy of the
 * farmacia's real printed label (openspec/specs/etiqueta-preparado/spec.md): a rounded
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
 * drawn horizontally condensed to match it (`etiqueta-pdf-trazos.ts`). The layout is drawn
 * in a FIXED design space (100 × 42 mm) and stretched on each axis to fill
 * the label size the caller chooses (one of the sizes the administrator
 * configured -- modules/etiqueta-tamanos); glyphs, icons and the logo are
 * compensated so they keep their proportions, only the fields' places spread.
 * A size much wider or much taller than 100 × 42 uses its own design instead
 * (`etiqueta-pdf-compacta.ts`): stretching this one would waste the room and leave the text unreadable.
 * The PDF page is the SHEET the farmacia prints on (modules/etiqueta-tamanos, spec
 * openspec/specs/hoja-etiquetas/spec.md R6), not the label: the label is drawn inside the cell
 * (columna, fila) of the sheet's grid the user picked and the rest of the page stays
 * blank, so the printer drops it in that spot.
 *
 * Every text is drawn with `lineBreak: false` at explicit coordinates (no
 * automatic wrapping, hence no automatic page breaks): a single label is always
 * exactly one page; several (`buildEtiquetasPdf`) share a page unless they overlap.
 *
 * `buildEtiquetaLotePdf`: the etiqueta of a lot elaborated in the farmacia (modules/stock/domain/etiqueta-lote.ts) --
 * the same frame and top band, the lot's name under "Rp/" and its lote, origen, months and aspecto in the panel.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import type { LogoPdf } from "@/shared/pdf/logo";
import { posicionCelda } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { Celda, HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { TamanoEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import type { ContenidoEtiqueta } from "../domain/etiqueta";
import type { ContenidoEtiquetaLote } from "@/modules/stock/domain/etiqueta-lote";
import {
  ALTURA_MAYUSCULA,
  INTERLINEA_RP,
  NEGRO,
  PT_POR_MM,
  ROJO,
  VERDE,
  anchoDe,
  compX,
  dibujarFormula,
  dibujarRecuadro,
  distribuirColumnasRp as distribuirEnArea,
  enCelda,
  envolver,
  iconoTelefono,
  iconoWhatsapp,
  linea,
  lineaPrioritaria,
  regla,
  tamanoQueEntra,
  texto,
  variantesMedico,
} from "./etiqueta-pdf-trazos";
import type { AreaRp, ColocacionEtiqueta, DistribucionRp, Doc, Tramo } from "./etiqueta-pdf-trazos";
import { disposicionCompacta } from "./etiqueta-pdf-compacta";

export { tamanoFuenteRp } from "./etiqueta-pdf-trazos";
export type { ColocacionEtiqueta, DistribucionRp } from "./etiqueta-pdf-trazos";

/** Design space: the 100 × 42 mm label in points. */
const DW = 100 * PT_POR_MM;
const DH = 42 * PT_POR_MM;

// Frame and rules (design-space points).
const BORDE = 3;
const BANDA_Y = 40.4; // rule under the top band
const BANDA_DIV_X = 116.3; // vertical rule in the top band
const PANEL_DIV_X = 141.9; // vertical rule between Rp/ and the right panel
const PIE_Y = 102.2; // rule above the médico footer
const DERECHA = DW - BORDE - 4; // right limit of the texts
const REGLA_MARGEN = BORDE + 11.1; // the horizontal rules stop short of the border

/** Smallest size (design points) a must-read field (the médico) keeps before it falls back to a shorter text. */
const TAMANO_MINIMO_PRIORITARIO = 5;

/** The box the tenant's logo fits in, keeping its proportion. */
const LOGO_ANCHO_MAX = 89.9;
const LOGO_ALTO_MAX = 30.2;

/** The top band is the same on a preparado's and on an elaborated lot's etiqueta. */
type DatosBanda = Pick<ContenidoEtiqueta, "directorTecnico" | "domicilio" | "telefonoFijo" | "celular">;

function dibujarBanda(doc: Doc, c: DatosBanda, logo: LogoPdf | null): void {
  if (logo) {
    // Its width in design space is compensated for the stretch (it keeps its proportion on paper); a logo made
    // narrower by the stretch stays centered where it would be without it.
    const k = compX(doc);
    const alto = Math.min(LOGO_ANCHO_MAX / (logo.proporcion * k), LOGO_ALTO_MAX);
    const ancho = alto * logo.proporcion * k;
    const anchoSinCompensar = Math.min(LOGO_ANCHO_MAX / logo.proporcion, LOGO_ALTO_MAX) * logo.proporcion;
    const x = 20.5 + Math.max(0, (anchoSinCompensar - ancho) / 2);
    doc.image(logo.imagen, x, (BORDE + BANDA_Y - alto) / 2, { width: ancho, height: alto });
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

/**
 * The fórmula's area (design-space points): from just inside the frame to just short of the panel's rule, from under
 * the "Rp/" mark down to just above the footer's rule.
 */
export const AREA_RP: AreaRp = { x: BORDE + 5, derecha: PANEL_DIV_X - 2, arriba: 49.5, abajo: PIE_Y - 2 };

/** R12: the Rp/ columns in `AREA_RP` (see `etiqueta-pdf-trazos.ts#distribuirColumnasRp`). */
export function distribuirColumnasRp(anchosBase: readonly number[], filas: number): DistribucionRp {
  return distribuirEnArea(anchosBase, filas, AREA_RP);
}

function dibujarRp(doc: Doc, c: ContenidoEtiqueta): void {
  linea(doc, [{ texto: "Rp/", fuente: "Helvetica" }], 13.5, 43.7, 6.5, NEGRO);
  dibujarFormula(doc, c.rp, AREA_RP);
}

/** The large green quantity: its cap top at full size and that size (it shrinks around the same middle). */
const NUMERO_Y = 57.9;
const TAMANO_NUMERO = 33;
const TAMANO_FORMA = 7.8;
const PASO_FORMA = 8.2;

/** Cap top of the first forma / vía / fracción line and the line pitch: the `lineas` lines centered on the quantity's middle. */
export function bloqueFormaY(lineas: number): { primeraY: number; paso: number } {
  const centro = NUMERO_Y + (TAMANO_NUMERO * ALTURA_MAYUSCULA) / 2;
  const alto = (Math.max(lineas, 1) - 1) * PASO_FORMA + TAMANO_FORMA * ALTURA_MAYUSCULA;
  return { primeraY: centro - alto / 2, paso: PASO_FORMA };
}

function dibujarPanel(doc: Doc, c: ContenidoEtiqueta): void {
  const xIzquierda = 145.2;
  const xDerecha = 232.6;

  if (c.paciente) texto(doc, `Paciente:${c.paciente}`, xIzquierda, 45, 6.5, xDerecha - 3 - xIzquierda);
  texto(doc, `N° ${c.recetaNumero}`, xDerecha, 44.7, 6.5, DERECHA - xDerecha);
  if (c.dosis) {
    // "Dosis: ..." in its column under the receta number, wrapped down to the storage note.
    const { lineas, tamano } = envolver(doc, `Dosis: ${c.dosis}`, 6.5, DERECHA - xDerecha, 4);
    lineas.forEach((l, i) => linea(doc, [{ texto: l, fuente: "Helvetica" }], xDerecha, 53.3 + i * tamano * 1.15, tamano, NEGRO));
  }

  // Large green quantity, right-aligned so its digits always end at the same place.
  const numero: Tramo[] = [{ texto: c.cantidadTotal ?? String(c.cantidad), fuente: "Helvetica" }];
  const finNumero = 189;
  const tamanoNumero = tamanoQueEntra(doc, numero, TAMANO_NUMERO, finNumero - (PANEL_DIV_X + 3));
  linea(doc, numero, finNumero - anchoDe(doc, numero, tamanoNumero), NUMERO_Y + (TAMANO_NUMERO - tamanoNumero) * ALTURA_MAYUSCULA * 0.5, tamanoNumero, VERDE);

  // Forma / vía / fracción: the lines present, centered on one axis and, as a block, on the quantity's height
  // (a lone "Solución" sits beside the number, not above it).
  const centroForma = 210.2;
  const anchoForma = 2 * (xDerecha - 3 - centroForma);
  const lineasForma = [c.forma, c.via, c.fraccionDosis].filter((l): l is string => Boolean(l));
  const { primeraY, paso } = bloqueFormaY(lineasForma.length);
  lineasForma.forEach((l, i) => texto(doc, l, centroForma, primeraY + i * paso, TAMANO_FORMA, anchoForma, NEGRO, true));

  texto(doc, c.vence, xIzquierda, 93, 6.4, 45);
  texto(doc, c.conservacion, 223.8, 94, 5, 2 * (DERECHA - 223.8), ROJO, true);
}

function dibujarPie(doc: Doc, c: ContenidoEtiqueta): void {
  lineaPrioritaria(doc, variantesMedico(c.medico), DW / 2, 105.5, 6.4, TAMANO_MINIMO_PRIORITARIO, DW - 2 * (BORDE + 14), NEGRO, true);
}

/** A design space in points: the classic 100 × 42 mm one, or a compact one (`etiqueta-pdf-compacta.ts`). */
interface Diseno {
  ancho: number;
  alto: number;
}

const DISENO_CLASICO: Diseno = { ancho: DW, alto: DH };

/**
 * R4 + R6: the design fills the cell (columna, fila) of the grid of `tamano` on `hoja` -- whose top-left corner is
 * `posicionCelda` (exact in mm, the grid is anchored at the sheet's margin) -- stretched on each axis to the size the
 * administrator configured (a 60 × 15 mm size prints 60 × 15 mm). Glyphs, icons and the logo keep their proportions
 * (`compensacionX`); only the places of the fields spread.
 */
export function colocarEtiqueta(tamano: TamanoEtiqueta, hoja: HojaEtiqueta, celda: Celda, diseno: Diseno = DISENO_CLASICO): ColocacionEtiqueta {
  const { xMm, yMm } = posicionCelda(hoja, tamano, celda);
  return { x: xMm * PT_POR_MM, y: yMm * PT_POR_MM, escalaX: (tamano.anchoMm * PT_POR_MM) / diseno.ancho, escalaY: (tamano.altoMm * PT_POR_MM) / diseno.alto };
}

/** Frame and rules, shared by both etiquetas. */
function dibujarMarco(doc: Doc, colorFondo?: string | null): void {
  dibujarRecuadro(doc, DW, DH, BORDE, 12, colorFondo);
  regla(doc, BANDA_DIV_X, 8.6, BANDA_DIV_X, 37.8, 1);
  regla(doc, REGLA_MARGEN, BANDA_Y, DW - REGLA_MARGEN, BANDA_Y, 1.6);
  regla(doc, PANEL_DIV_X, 43.4, PANEL_DIV_X, 99.6, 1.2);
  regla(doc, REGLA_MARGEN, PIE_Y, DW - REGLA_MARGEN, PIE_Y, 1.6);
}

/** Draws one etiqueta on the current page in the cell of `tamano`: the compact design for a very wide or very tall size, else the classic one. */
function dibujarEtiqueta(doc: Doc, contenido: ContenidoEtiqueta, tamano: TamanoEtiqueta, hoja: HojaEtiqueta, celda: Celda, logo: LogoPdf | null, colorFondo?: string | null): void {
  const compacta = disposicionCompacta(tamano);
  if (compacta) {
    enCelda(doc, colocarEtiqueta(tamano, hoja, celda, compacta), () => compacta.dibujar(doc, contenido, logo, colorFondo));
    return;
  }
  enCelda(doc, colocarEtiqueta(tamano, hoja, celda), () => {
    dibujarMarco(doc, colorFondo);
    dibujarBanda(doc, contenido, logo);
    dibujarRp(doc, contenido);
    dibujarPanel(doc, contenido);
    dibujarPie(doc, contenido);
  });
}

/** Renders the sheet (`hoja`, mm) as ONE page with the etiqueta of `tamano` (mm) drawn in the cell `celda` (1-based). The caller checks that the cell is in the grid (`celdaValida`). */
export function buildEtiquetaPdf(
  contenido: ContenidoEtiqueta,
  tamano: TamanoEtiqueta,
  hoja: HojaEtiqueta,
  celda: Celda = { columna: 1, fila: 1 },
  logo: LogoPdf | null = null,
  colorFondo?: string | null,
): Promise<Buffer> {
  return buildEtiquetasPdf([{ contenido, tamano, celda, colorFondo }], hoja, logo);
}

/** One etiqueta of a multi-etiqueta print: what, at which size, in which cell. */
export interface EtiquetaEnHoja {
  contenido: ContenidoEtiqueta;
  tamano: TamanoEtiqueta;
  celda: Celda;
  colorFondo?: string | null;
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
 * Several etiquetas in ONE PDF (the toma's single "Imprimir", openspec/specs/hoja-etiquetas/spec.md R14), in the given order:
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
        dibujarEtiqueta(doc, etiqueta.contenido, etiqueta.tamano, hoja, etiqueta.celda, logo, etiqueta.colorFondo);
      }
    },
    { size: pagina, margin: 0 },
  );
}

/** The lot's name under "Rp/": large, centered, up to two lines. */
function dibujarNombreLote(doc: Doc, nombre: string): void {
  linea(doc, [{ texto: "Rp/", fuente: "Helvetica" }], 13.5, 43.7, 6.5, NEGRO);
  const x = 21.4;
  const ancho = PANEL_DIV_X - 2.5 - x;
  const arriba = 50;
  const abajo = PIE_Y - 3.6;
  const { lineas, tamano } = envolver(doc, nombre, 16, ancho, 2);
  const primeraY = arriba + (abajo - arriba - lineas.length * tamano * INTERLINEA_RP) / 2;
  lineas.forEach((l, i) => texto(doc, l, x + ancho / 2, primeraY + i * tamano * INTERLINEA_RP, tamano, ancho, NEGRO, true));
}

/** Lote, origen, elaboration and vencimiento, aspecto and the storage note, centered on the panel. */
function dibujarPanelLote(doc: Doc, c: ContenidoEtiquetaLote): void {
  const centro = (PANEL_DIV_X + DERECHA) / 2;
  const ancho = DERECHA - PANEL_DIV_X - 6;
  texto(doc, `Lote: ${c.lote}`, centro, 47.5, 7.8, ancho, NEGRO, true);
  if (c.origen) texto(doc, `Origen: ${c.origen}`, centro, 56.5, 6, ancho, NEGRO, true);
  texto(doc, `Elab: ${c.elaborado}`, centro, 64.5, 7.8, ancho, NEGRO, true);
  texto(doc, `Vence: ${c.vence}`, centro, 73.5, 7.8, ancho, NEGRO, true);
  if (c.aspecto) texto(doc, `Aspecto: ${c.aspecto}`, centro, 84, 6, ancho, NEGRO, true);
  texto(doc, c.conservacion, centro, 93.5, 5, ancho, ROJO, true);
}

/** Renders the sheet as ONE page with an elaborated lot's etiqueta of `tamano` in the cell `celda` (same placement as `buildEtiquetaPdf`). */
export function buildEtiquetaLotePdf(
  contenido: ContenidoEtiquetaLote,
  tamano: TamanoEtiqueta,
  hoja: HojaEtiqueta,
  celda: Celda = { columna: 1, fila: 1 },
  logo: LogoPdf | null = null,
): Promise<Buffer> {
  const pagina: [number, number] = [hoja.anchoMm * PT_POR_MM, hoja.altoMm * PT_POR_MM];
  const colocacion = colocarEtiqueta(tamano, hoja, celda);
  return renderPdf(
    (doc) =>
      enCelda(doc, colocacion, () => {
        dibujarMarco(doc);
        dibujarBanda(doc, contenido, logo);
        dibujarNombreLote(doc, contenido.nombre);
        dibujarPanelLote(doc, contenido);
      }),
    { size: pagina, margin: 0 },
  );
}

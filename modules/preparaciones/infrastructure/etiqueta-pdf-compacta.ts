/**
 * Compact designs of the preparado's etiqueta (openspec/specs/etiqueta-preparado/spec.md R13) for sizes far from the
 * classic 100 × 42 mm proportion (`etiqueta-pdf.ts`): stretching the classic one to a 60 × 15 mm label leaves blank
 * room beside the quantity and every text a couple of points high. Each design is drawn in its own design space, the
 * one whose proportion is closest to the label's:
 *
 * - WIDE (100 × 25 mm, for e.g. 60 × 15): a top band with the logo, the director técnico's name large and the rest of
 *   the farmacia's data in one small line; Rp/ on the left; the quantity, its forma and, in the room beside them, the
 *   paciente, N° / vencimiento, dosis and storage note; the médico across the whole footer.
 * - TALL (50 × 60 mm, for e.g. 40 × 60): everything stacked -- band, Rp/, paciente, N° / vencimiento, quantity with its
 *   forma, dosis and storage note, médico.
 *
 * Priorities (user decision, 2026-11-18): no field is dropped, the least important ones (domicilio, phones) shrink first;
 * the director técnico's name and the médico keep a legible size by dropping their labels ("Director Técnico",
 * "Médico:", then the matrícula) before shrinking further; the paciente prints without "Paciente:".
 */
import type { LogoPdf } from "@/shared/pdf/logo";
import type { TamanoEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import type { ContenidoEtiqueta } from "../domain/etiqueta";
import {
  ALTURA_MAYUSCULA,
  NEGRO,
  PT_POR_MM,
  ROJO,
  VERDE,
  anchoDe,
  compX,
  dibujarFormula,
  dibujarRecuadro,
  envolver,
  linea,
  lineaPrioritaria,
  regla,
  tamanoQueEntra,
  texto,
  variantesMedico,
} from "./etiqueta-pdf-trazos";
import type { Doc, Tramo } from "./etiqueta-pdf-trazos";

/** A compact design: its design space (points) and how it draws an etiqueta in it. */
export interface DisposicionCompacta {
  ancho: number;
  alto: number;
  dibujar: (doc: Doc, c: ContenidoEtiqueta, logo: LogoPdf | null, colorFondo?: string | null) => void;
}

/** Width / height of the classic design (100 × 42 mm). */
const PROPORCION_CLASICA = 100 / 42;

/** Smallest size (design points) a must-read field keeps before it falls back to a shorter text. */
const MINIMO_PRIORITARIO = 5;

interface Caja {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/** The logo as large as it fits `caja`, centered in it, keeping its proportion on paper. */
function dibujarLogo(doc: Doc, logo: LogoPdf, caja: Caja): void {
  const k = compX(doc);
  const alto = Math.min(caja.ancho / (logo.proporcion * k), caja.alto);
  const ancho = alto * logo.proporcion * k;
  doc.image(logo.imagen, caja.x + (caja.ancho - ancho) / 2, caja.y + (caja.alto - alto) / 2, { width: ancho, height: alto });
}

const DT_EN_BLANCO = "Director Técnico ________________  MAT. ______";

/** The director técnico from most to least complete; the name always bold and larger, the matrícula never dropped. */
function variantesDt(c: ContenidoEtiqueta): Tramo[][] {
  if (!c.directorTecnico) return [[{ texto: DT_EN_BLANCO, fuente: "Helvetica" }]];
  const nombre: Tramo = { texto: c.directorTecnico.nombre, fuente: "Helvetica-Bold", escala: 1.3 };
  const matricula: Tramo = { texto: ` - MAT. ${c.directorTecnico.matricula}`, fuente: "Helvetica" };
  return [[{ texto: "Director Técnico ", fuente: "Helvetica", escala: 0.85 }, nombre, matricula], [nombre, matricula]];
}

/** The phones in one line ("Tel. ... · Cel. ..."); empty when the farmacia has none. */
function telefonos(c: ContenidoEtiqueta): string {
  return [c.telefonoFijo && `Tel. ${c.telefonoFijo}`, c.celular && `Cel. ${c.celular}`].filter(Boolean).join("  ·  ");
}

/** "N° 3  ·  Vence: 02/27". */
function numeroYVence(c: ContenidoEtiqueta): string {
  return `N° ${c.recetaNumero}  ·  ${c.vence}`;
}

/** The large green quantity right-aligned at `fin`, shrunk to `ancho`, its middle at `centroY`. */
function dibujarCantidad(doc: Doc, c: ContenidoEtiqueta, fin: number, ancho: number, centroY: number, tamano: number): void {
  const numero: Tramo[] = [{ texto: c.cantidadTotal ?? String(c.cantidad), fuente: "Helvetica" }];
  const tam = tamanoQueEntra(doc, numero, tamano, ancho);
  linea(doc, numero, fin - anchoDe(doc, numero, tam), centroY - (tam * ALTURA_MAYUSCULA) / 2, tam, VERDE);
}

/** Forma / vía / fracción present, centered on `centroX` and, as a block, on `centroY`. */
function dibujarForma(doc: Doc, c: ContenidoEtiqueta, centroX: number, ancho: number, centroY: number, tamano: number): void {
  const lineas = [c.forma, c.via, c.fraccionDosis].filter((l): l is string => Boolean(l));
  const paso = tamano * 1.1;
  const primeraY = centroY - ((lineas.length - 1) * paso + tamano * ALTURA_MAYUSCULA) / 2;
  lineas.forEach((l, i) => texto(doc, l, centroX, primeraY + i * paso, tamano, ancho, NEGRO, true));
}

// ---------------------------------------------------------------------------------------------------------------------
// WIDE: 100 × 25 mm
// ---------------------------------------------------------------------------------------------------------------------

/** Largest size of the paciente on the wide label and its line pitch (as a multiple of the size). */
const TAMANO_PACIENTE_MAX = 10;
const INTERLINEA_PACIENTE = 1.08;

/**
 * The paciente in up to two lines (user decision, 2026-11-18: larger, in two lines): "Apellido," / "Nombre" when the
 * text has a comma, else wrapped at a word; a single word stays on one line.
 */
function lineasPaciente(doc: Doc, paciente: string, ancho: number): string[] {
  const coma = paciente.indexOf(",");
  if (coma > 0 && coma < paciente.length - 1) return [paciente.slice(0, coma + 1).trim(), paciente.slice(coma + 1).trim()];
  if (!paciente.includes(" ")) return [paciente];
  return envolver(doc, paciente, TAMANO_PACIENTE_MAX, ancho, 2).lineas;
}

const AW = 100 * PT_POR_MM;
const AH = 25 * PT_POR_MM;

function dibujarApaisada(doc: Doc, c: ContenidoEtiqueta, logo: LogoPdf | null, colorFondo?: string | null): void {
  const borde = 2.5;
  const bandaY = 22;
  const pieY = 58;
  const panelX = 124;
  const derecha = AW - 7;

  dibujarRecuadro(doc, AW, AH, borde, 8, colorFondo);
  regla(doc, 72, 6, 72, bandaY - 3, 0.8);
  regla(doc, 10, bandaY, AW - 10, bandaY, 1.2);
  regla(doc, panelX, bandaY + 3, panelX, pieY - 3, 1);
  regla(doc, 10, pieY, AW - 10, pieY, 1.2);

  // Band: logo, the director técnico large, the rest of the farmacia's data in one line.
  if (logo) dibujarLogo(doc, logo, { x: 8, y: borde + 2, ancho: 60, alto: bandaY - borde - 4 });
  const xBanda = 76;
  lineaPrioritaria(doc, variantesDt(c), xBanda, 5.5, 7.5, MINIMO_PRIORITARIO, derecha - xBanda);
  const farmacia = [c.domicilio, telefonos(c)].filter(Boolean).join("  ·  ");
  if (farmacia) texto(doc, farmacia, xBanda, 15.2, 4.6, derecha - xBanda);

  // Rp/ beside its mark, centered in its area.
  linea(doc, [{ texto: "Rp/", fuente: "Helvetica" }], 7, bandaY + 2.5, 5, NEGRO);
  dibujarFormula(doc, c.rp, { x: 18, derecha: panelX - 3, arriba: bandaY + 2.5, abajo: pieY - 2 });

  // Panel: quantity and forma, then paciente, N° / vence, dosis and storage note in the room beside them.
  const centroY = (bandaY + pieY) / 2;
  dibujarCantidad(doc, c, 178, 178 - (panelX + 3), centroY, 24);
  dibujarForma(doc, c, 194, 28, centroY, 6);
  // Info column, stacked from the top: the paciente in two lines as large as the room allows, N° / vence, dosis; the
  // storage note at the bottom.
  const xInfo = 211;
  const anchoInfo = derecha - xInfo;
  const arriba = bandaY + 2.5;
  const conservacionY = pieY - 6;
  const tamanoVence = 7;
  const tamanoDosis = 5;
  const separacion = 1.5;
  const dosis = c.dosis ? envolver(doc, `Dosis: ${c.dosis}`, tamanoDosis, anchoInfo, 2) : null;
  const altoDosis = dosis ? separacion + (dosis.lineas.length - 1) * dosis.tamano * 1.15 + dosis.tamano * ALTURA_MAYUSCULA : 0;
  const altoResto = separacion + tamanoVence * ALTURA_MAYUSCULA + altoDosis + 1;
  let y = arriba;
  if (c.paciente) {
    const lineas = lineasPaciente(doc, c.paciente, anchoInfo);
    const porLinea = lineas.length === 1 ? ALTURA_MAYUSCULA : INTERLINEA_PACIENTE + ALTURA_MAYUSCULA;
    const tope = Math.min(TAMANO_PACIENTE_MAX, (conservacionY - arriba - altoResto) / porLinea);
    const tramos = lineas.map((l): Tramo[] => [{ texto: l, fuente: "Helvetica-Bold" }]);
    const tamano = Math.min(...tramos.map((t) => tamanoQueEntra(doc, t, tope, anchoInfo)));
    tramos.forEach((t, i) => linea(doc, t, xInfo, y + i * tamano * INTERLINEA_PACIENTE, tamano, NEGRO));
    y += (lineas.length - 1) * tamano * INTERLINEA_PACIENTE + tamano * ALTURA_MAYUSCULA + separacion;
  }
  // The vencimiento large and bold, the receta number small on its baseline.
  const vence: Tramo[] = [
    { texto: c.vence, fuente: "Helvetica-Bold" },
    { texto: `    N° ${c.recetaNumero}`, fuente: "Helvetica", escala: 0.75 },
  ];
  linea(doc, vence, xInfo, y, tamanoQueEntra(doc, vence, tamanoVence, anchoInfo), NEGRO);
  y += tamanoVence * ALTURA_MAYUSCULA + separacion;
  dosis?.lineas.forEach((l, i) => linea(doc, [{ texto: l, fuente: "Helvetica" }], xInfo, y + i * dosis.tamano * 1.15, dosis.tamano, NEGRO));
  texto(doc, c.conservacion, xInfo, conservacionY, 4.4, anchoInfo, ROJO);

  // Médico across the whole footer.
  lineaPrioritaria(doc, variantesMedico(c.medico), AW / 2, pieY + 2.5, 7, MINIMO_PRIORITARIO, AW - 24, NEGRO, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// TALL: 50 × 60 mm
// ---------------------------------------------------------------------------------------------------------------------

const TW = 50 * PT_POR_MM;
const TH = 60 * PT_POR_MM;

function dibujarAlta(doc: Doc, c: ContenidoEtiqueta, logo: LogoPdf | null, colorFondo?: string | null): void {
  const borde = 3;
  const centro = TW / 2;
  const ancho = TW - 16;
  const bandaY = 50.5;
  const rpY = 95;
  const pieY = 157;

  dibujarRecuadro(doc, TW, TH, borde, 10, colorFondo);
  regla(doc, 10, bandaY, TW - 10, bandaY, 1.2);
  regla(doc, 10, rpY, TW - 10, rpY, 1.2);
  regla(doc, 10, pieY, TW - 10, pieY, 1.2);

  // Band: logo, director técnico, domicilio, phones -- stacked and centered.
  // The name on a line of its own, as large as it fits; "Director Técnico · MAT." under it.
  if (logo) dibujarLogo(doc, logo, { x: 20, y: 6, ancho: TW - 40, alto: 14 });
  if (c.directorTecnico) {
    texto(doc, c.directorTecnico.nombre, centro, 23, 8, ancho, NEGRO, true, "Helvetica-Bold");
    texto(doc, `Director Técnico  ·  MAT. ${c.directorTecnico.matricula}`, centro, 31.5, 5, ancho, NEGRO, true);
  } else texto(doc, DT_EN_BLANCO, centro, 27, 5, ancho, NEGRO, true);
  if (c.domicilio) texto(doc, c.domicilio, centro, 38, 4.6, ancho, NEGRO, true);
  const tel = telefonos(c);
  if (tel) texto(doc, tel, centro, 44, 4.6, ancho, NEGRO, true);

  // Rp/ across the whole width, centered in its area.
  linea(doc, [{ texto: "Rp/", fuente: "Helvetica" }], 9, bandaY + 2.5, 6, NEGRO);
  dibujarFormula(doc, c.rp, { x: 9, derecha: TW - 9, arriba: bandaY + 9, abajo: rpY - 3 });

  // Paciente, N° / vence, quantity with its forma, dosis, storage note.
  if (c.paciente) texto(doc, c.paciente, centro, rpY + 3, 7.5, ancho, NEGRO, true, "Helvetica-Bold");
  texto(doc, numeroYVence(c), centro, rpY + 12, 6.2, ancho, NEGRO, true);
  const centroCantidad = rpY + 29;
  dibujarCantidad(doc, c, 82, 82 - 9, centroCantidad, 24);
  dibujarForma(doc, c, 112, 2 * (TW - 8 - 112), centroCantidad, 6.5);
  if (c.dosis) {
    const { lineas, tamano } = envolver(doc, `Dosis: ${c.dosis}`, 5.5, ancho, 2);
    lineas.forEach((l, i) => texto(doc, l, centro, rpY + 45 + i * tamano * 1.15, tamano, ancho, NEGRO, true));
  }
  texto(doc, c.conservacion, centro, pieY - 5.5, 4.6, ancho, ROJO, true);

  // Kept clear of the rounded corners.
  lineaPrioritaria(doc, variantesMedico(c.medico), centro, pieY + 2.5, 6, MINIMO_PRIORITARIO, TW - 24, NEGRO, true);
}

const APAISADA: DisposicionCompacta = { ancho: AW, alto: AH, dibujar: dibujarApaisada };
const ALTA: DisposicionCompacta = { ancho: TW, alto: TH, dibujar: dibujarAlta };

/**
 * R13: the compact design for `tamano` when its proportion is closer (on a log scale, so 2× wider weighs like 2×
 * taller) to a compact design's than to the classic 100 × 42; `null` keeps the classic one.
 */
export function disposicionCompacta(tamano: TamanoEtiqueta): DisposicionCompacta | null {
  const proporcion = tamano.anchoMm / tamano.altoMm;
  const distancia = (p: number) => Math.abs(Math.log(proporcion / p));
  const candidatas: Array<[DisposicionCompacta | null, number]> = [
    [null, distancia(PROPORCION_CLASICA)],
    [APAISADA, distancia(AW / AH)],
    [ALTA, distancia(TW / TH)],
  ];
  return candidatas.reduce((mejor, actual) => (actual[1] < mejor[1] ? actual : mejor))[0];
}

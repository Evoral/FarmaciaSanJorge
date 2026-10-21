/**
 * Pure domain rules for the sheet the etiquetas are printed on
 * (`fsj.etiqueta_hoja`, migration 0096, docs/specs/hoja-etiquetas.md). The etiqueta
 * PDF page IS the sheet; a label size (`etiqueta-tamano.ts`) is the etiqueta inside it.
 * The grid of cells is computed from the sheet, its margin and the label size, never
 * stored.
 *
 * Every measure is a `numeric(.., 1)`: the grid is computed in integer TENTHS of a
 * millimetre and divided with integer arithmetic, never with float division, so an
 * exact fit (200 / 100 = 2) can not round down and a near miss (3 x 66,7 = 200,1 > 200)
 * can not round up.
 */
import { TAMANO_MM_MIN, formatearMedidaMm } from "./etiqueta-tamano";
import type { TamanoEtiqueta } from "./etiqueta-tamano";

/** Mirror the `etiqueta_hoja_*_check` constraints of migration 0096. */
export const HOJA_MM_MIN = 50;
export const HOJA_MM_MAX = 500;
export const MARGEN_MM_MIN = 0;
export const MARGEN_MM_MAX = 30;

/** The sheet, in millimetres. `margenMm` is the same on the four sides. */
export interface HojaEtiqueta {
  anchoMm: number;
  altoMm: number;
  margenMm: number;
}

/** A4 portrait with a 5 mm margin: the seed of every tenant (migration 0096 and scripts/create-tenant.ts) and the fallback when a tenant has no row. */
export const HOJA_PREDETERMINADA: HojaEtiqueta = { anchoMm: 210, altoMm: 297, margenMm: 5 };

/** How many etiquetas of a given size fit on the sheet. */
export interface Grilla {
  columnas: number;
  filas: number;
}

/** A cell of the grid: both 1-based, reading order left to right, top to bottom. */
export interface Celda {
  columna: number;
  fila: number;
}

/** Name of the field of a size that does not fit the sheet. */
export type CampoMedida = "anchoMm" | "altoMm";

/** Measure in integer tenths of a millimetre. */
function decimas(mm: number): number {
  return Math.round(mm * 10);
}

/** Integer division of two non-negative integers, no float division involved. */
function cociente(dividendo: number, divisor: number): number {
  if (divisor <= 0 || dividendo <= 0) return 0;
  return (dividendo - (dividendo % divisor)) / divisor;
}

/** The sheet's printable width and height (sheet minus both margins), in tenths of a mm. */
function areaUtilDecimas(hoja: HojaEtiqueta): { ancho: number; alto: number } {
  const margen = 2 * decimas(hoja.margenMm);
  return { ancho: decimas(hoja.anchoMm) - margen, alto: decimas(hoja.altoMm) - margen };
}

/** The largest label (width, height) the sheet can hold: its printable area, in mm. */
export function areaUtilMm(hoja: HojaEtiqueta): TamanoEtiqueta {
  const { ancho, alto } = areaUtilDecimas(hoja);
  return { anchoMm: Math.max(ancho, 0) / 10, altoMm: Math.max(alto, 0) / 10 };
}

/** `true` when the printable area holds at least the smallest label size (10 mm) each way (R2). */
export function areaUtilSuficiente(hoja: HojaEtiqueta): boolean {
  const { ancho, alto } = areaUtilDecimas(hoja);
  const minimo = decimas(TAMANO_MM_MIN);
  return ancho >= minimo && alto >= minimo;
}

/** R3: `columnas = floor((ancho - 2 * margen) / ancho_etiqueta)`, `filas` likewise; 0 when the size does not fit. */
export function grillaHoja(hoja: HojaEtiqueta, tamano: TamanoEtiqueta): Grilla {
  const util = areaUtilDecimas(hoja);
  return { columnas: cociente(util.ancho, decimas(tamano.anchoMm)), filas: cociente(util.alto, decimas(tamano.altoMm)) };
}

/** Etiquetas per sheet. */
export function etiquetasPorHoja(grilla: Grilla): number {
  return grilla.columnas * grilla.filas;
}

/** R5: a size fits the sheet when at least one etiqueta fits in each direction. */
export function entraEnHoja(hoja: HojaEtiqueta, tamano: TamanoEtiqueta): boolean {
  const grilla = grillaHoja(hoja, tamano);
  return grilla.columnas >= 1 && grilla.filas >= 1;
}

/** The measures of a size that make it not fit the sheet (empty when it fits). */
export function camposQueNoEntran(hoja: HojaEtiqueta, tamano: TamanoEtiqueta): CampoMedida[] {
  const grilla = grillaHoja(hoja, tamano);
  const campos: CampoMedida[] = [];
  if (grilla.columnas < 1) campos.push("anchoMm");
  if (grilla.filas < 1) campos.push("altoMm");
  return campos;
}

/** R5: the sizes of `tamanos` that would not fit `hoja`. */
export function tamanosQueNoEntran<T extends TamanoEtiqueta>(hoja: HojaEtiqueta, tamanos: readonly T[]): T[] {
  return tamanos.filter((tamano) => !entraEnHoja(hoja, tamano));
}

/** R4: top-left corner of the cell on the sheet, in mm: `(margen + (c - 1) * ancho_etiqueta, margen + (f - 1) * alto_etiqueta)`. The grid is anchored at the margin and the cells touch. */
export function posicionCelda(hoja: HojaEtiqueta, tamano: TamanoEtiqueta, celda: Celda): { xMm: number; yMm: number } {
  const margen = decimas(hoja.margenMm);
  return {
    xMm: (margen + (celda.columna - 1) * decimas(tamano.anchoMm)) / 10,
    yMm: (margen + (celda.fila - 1) * decimas(tamano.altoMm)) / 10,
  };
}

/** `true` for an integer cell inside the grid (1-based). */
export function celdaValida(grilla: Grilla, celda: { columna: number; fila: number }): boolean {
  return Number.isInteger(celda.columna) && Number.isInteger(celda.fila) && celda.columna >= 1 && celda.columna <= grilla.columnas && celda.fila >= 1 && celda.fila <= grilla.filas;
}

/** The cell itself if it is still in the grid, else the first one (R8: changing the size keeps the cell only if it still fits). */
export function conservarCelda(grilla: Grilla, celda: Celda): Celda {
  return celdaValida(grilla, celda) ? celda : { columna: 1, fila: 1 };
}

/** The cell after `celda` in reading order; after the last one it wraps to the first (R11). */
export function siguienteCelda(grilla: Grilla, celda: Celda): Celda {
  if (celda.columna < grilla.columnas) return { columna: celda.columna + 1, fila: celda.fila };
  if (celda.fila < grilla.filas) return { columna: 1, fila: celda.fila + 1 };
  return { columna: 1, fila: 1 };
}

/** "A4 vertical" / "A4 horizontal" for the A4 sheet, `null` for any other. */
export function nombreHoja(hoja: Pick<HojaEtiqueta, "anchoMm" | "altoMm">): string | null {
  if (hoja.anchoMm === 210 && hoja.altoMm === 297) return "A4 vertical";
  if (hoja.anchoMm === 297 && hoja.altoMm === 210) return "A4 horizontal";
  return null;
}

/** "A4 vertical — 210 × 297 mm, margen 5 mm", or "310 × 400 mm, margen 5 mm" for any other sheet. */
export function formatearHoja(hoja: HojaEtiqueta): string {
  const medidas = `${formatearMedidaMm(hoja.anchoMm)} × ${formatearMedidaMm(hoja.altoMm)} mm, margen ${formatearMedidaMm(hoja.margenMm)} mm`;
  const nombre = nombreHoja(hoja);
  return nombre ? `${nombre} — ${medidas}` : medidas;
}

/** "2 × 6 = 12 por hoja" (admin list). */
export function formatearCapacidad(grilla: Grilla): string {
  return `${grilla.columnas} × ${grilla.filas} = ${etiquetasPorHoja(grilla)} por hoja`;
}

/** "2 columnas × 6 filas · 12 etiquetas por hoja" (print dialog). */
export function resumenGrilla(grilla: Grilla): string {
  const total = etiquetasPorHoja(grilla);
  const columnas = grilla.columnas === 1 ? "columna" : "columnas";
  const filas = grilla.filas === 1 ? "fila" : "filas";
  const etiquetas = total === 1 ? "etiqueta" : "etiquetas";
  return `${grilla.columnas} ${columnas} × ${grilla.filas} ${filas} · ${total} ${etiquetas} por hoja`;
}

/** "Columna 3, fila 2". */
export function formatearCelda(celda: Celda): string {
  return `Columna ${celda.columna}, fila ${celda.fila}`;
}

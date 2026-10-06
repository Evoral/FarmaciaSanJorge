/**
 * Pure domain rules for the etiqueta sizes a farmacia can print on
 * (`fsj.etiqueta_tamano`, migration 0066). A size is a free-form name plus
 * the page width x height in millimetres (landscape: ancho is the long side
 * of the roll). The label layout itself is drawn in a fixed design space and
 * scaled onto whatever page size is chosen (see
 * modules/preparaciones/infrastructure/etiqueta-pdf.ts), so a size is nothing
 * but its measures.
 */

/** Mirrors the `etiqueta_tamano_*_check` constraints of migration 0066. */
export const TAMANO_MM_MIN = 10;
export const TAMANO_MM_MAX = 300;

/** The page size of a printed etiqueta, in millimetres. */
export interface TamanoEtiqueta {
  anchoMm: number;
  altoMm: number;
}

/** A configured size, as listed to admins and offered when printing. Measures are plain numbers (never Prisma `Decimal`s) so the object can cross into a client component. */
export interface EtiquetaTamano extends TamanoEtiqueta {
  id: string;
  nombre: string;
}

/** The size the label was originally designed for; used when a print request names no size (old links) and as the seed of every tenant. */
export const ETIQUETA_TAMANO_PREDETERMINADO: TamanoEtiqueta = { anchoMm: 100, altoMm: 42 };

/** Name of the size seeded for every tenant (migration 0066 and scripts/create-tenant.ts). */
export const ETIQUETA_TAMANO_PREDETERMINADO_NOMBRE = "Estándar 100 × 42 mm";

/** `true` for a finite value within [TAMANO_MM_MIN, TAMANO_MM_MAX] with at most one decimal (the column is `numeric(5,1)`). */
export function medidaMmValida(valor: number): boolean {
  if (!Number.isFinite(valor)) return false;
  if (valor < TAMANO_MM_MIN || valor > TAMANO_MM_MAX) return false;
  const decimos = valor * 10;
  return Math.abs(decimos - Math.round(decimos)) < 1e-9;
}

/** `100` -> "100", `42.5` -> "42,5" (es-AR decimal comma, no trailing ",0"). */
export function formatearMedidaMm(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(1).replace(".", ",");
}

/** "100 × 42 mm". */
export function formatearMedidas(tamano: TamanoEtiqueta): string {
  return `${formatearMedidaMm(tamano.anchoMm)} × ${formatearMedidaMm(tamano.altoMm)} mm`;
}

/** Picker label: "Frasco chico — 50 × 30 mm". */
export function formatearTamano(tamano: TamanoEtiqueta & { nombre: string }): string {
  return `${tamano.nombre} — ${formatearMedidas(tamano)}`;
}

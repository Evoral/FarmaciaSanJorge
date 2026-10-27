/**
 * Pure presentation rules of the "Costos de proveedores" section
 * (openspec/specs/costos-proveedor/spec.md, "Interface"): how old a price is, and what
 * state each version of a (droga, proveedor) history is in. NO I/O.
 */

import { formatearCostoUnitario } from "@/shared/format/monto";

const MS_POR_DIA = 86_400_000;

/** A price with its unidad de precio, in pesos (R7): "$ 40.898,00 / kg" -- the precio informado (net) or its value with IVA (R7a). Up to 6 decimals, never rounded to cents. */
export function etiquetaPrecio(precioInformado: string, unidadSimbolo: string): string {
  return `$ ${formatearCostoUnitario(precioInformado)} / ${unidadSimbolo}`;
}

/** `YYYY-MM-DD` -> UTC midnight in ms (callers pass real ISO dates: they come from the DB or `fsj.jornada_actual`). */
function diaEnMs(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

/** Whole days from `fechaPrecio` to `jornadaActual` (both `YYYY-MM-DD`); never negative (a price dated in the future reads as today). */
export function antiguedadDias(fechaPrecio: string, jornadaActual: string): number {
  return Math.max(0, Math.round((diaEnMs(jornadaActual) - diaEnMs(fechaPrecio)) / MS_POR_DIA));
}

/** "hoy", "hace 1 día", "hace 12 días", "hace 3 meses", "hace 2 años": the age shown next to a price's date. */
export function etiquetaAntiguedad(dias: number): string {
  if (dias <= 0) return "hoy";
  if (dias === 1) return "hace 1 día";
  if (dias < 60) return `hace ${dias} días`;
  if (dias < 730) return `hace ${Math.floor(dias / 30)} meses`;
  return `hace ${Math.floor(dias / 365)} años`;
}

export type EstadoVersionCosto = "VIGENTE" | "REEMPLAZADO" | "BAJA";

export const ESTADO_VERSION_LABELS: Readonly<Record<EstadoVersionCosto, string>> = {
  VIGENTE: "Vigente",
  REEMPLAZADO: "Reemplazado",
  BAJA: "Dado de baja",
};

/**
 * The state of every version of one pair's history (R2, R11), keyed by id:
 * `VIGENTE` while `vigenteHasta` is null; a closed version is `REEMPLAZADO`
 * when another version starts at the very instant it closed (a change closes
 * the old and opens the new at the same `ahoraServidor`), and `BAJA` when
 * nothing follows it (a baja closes without a replacement).
 */
export function clasificarVersiones(versiones: readonly { id: string; vigenteDesde: Date; vigenteHasta: Date | null }[]): Map<string, EstadoVersionCosto> {
  const inicios = new Set(versiones.map((version) => version.vigenteDesde.getTime()));
  return new Map(
    versiones.map((version) => {
      const estado: EstadoVersionCosto = version.vigenteHasta === null ? "VIGENTE" : inicios.has(version.vigenteHasta.getTime()) ? "REEMPLAZADO" : "BAJA";
      return [version.id, estado];
    }),
  );
}

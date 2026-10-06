/**
 * Why a ficha técnica could not be calculated, as a stable code next to the
 * Spanish message (FASE 7 point 7.2 + docs/specs/presupuesto-receta.md).
 * The message is what the farmacéutico reads (unchanged from before); the
 * code is what a caller that must NOT carry free text around -- the
 * post-confirmation generation's redirect notice (modules/recetas) -- keeps.
 *
 * Also the "is the latest ficha still current" comparison used to avoid a
 * redundant new version after an edit that did not change an item.
 * Pure, no I/O.
 */
import { DomainError } from "@/shared/errors";
import { dec } from "@/shared/decimal";
import type { LineaPesajeCalculada } from "./calcular-ficha-tecnica";

/** `V1`..`V9` (docs/specs/ficha-tecnica.md; V3 was removed with the componentes' order, migration 0065) or a missing piece of configuration/data. */
export type CodigoFichaNoGenerable = "V1" | "V2" | "V4" | "V5" | "V6" | "V7" | "V8" | "V9" | "SIN_UNIDAD_BASE" | "DATOS_INVALIDOS";

export const CODIGOS_FICHA_NO_GENERABLE: readonly CodigoFichaNoGenerable[] = [
  "V1",
  "V2",
  "V4",
  "V5",
  "V6",
  "V7",
  "V8",
  "V9",
  "SIN_UNIDAD_BASE",
  "DATOS_INVALIDOS",
];

export function esCodigoFichaNoGenerable(codigo: string): codigo is CodigoFichaNoGenerable {
  return (CODIGOS_FICHA_NO_GENERABLE as readonly string[]).includes(codigo);
}

export class FichaNoGenerableError extends DomainError {
  readonly codigo: CodigoFichaNoGenerable;

  constructor(codigo: CodigoFichaNoGenerable, message: string) {
    super(message);
    this.codigo = codigo;
  }
}

/** What a stored linea_pesaje looks like for the comparison below (decimals as strings). */
export interface LineaPesajeGuardada {
  drogaId: string;
  cantidadTeorica: string | null;
  excesoAplicado: string;
  cantidadAPesar: string | null;
  unidadMedidaId: string;
  esEnraseManual: boolean;
}

/** A decimal in canonical form ("3.000" and "3" agree), or "-" for `null`. */
function decimalCanonico(valor: { toString(): string } | null): string {
  return valor === null ? "-" : dec(valor.toString()).toString();
}

function claveLinea(drogaId: string, unidadMedidaId: string, esEnraseManual: boolean, cantidades: readonly ({ toString(): string } | null)[]): string {
  return [drogaId, unidadMedidaId, String(esEnraseManual), ...cantidades.map(decimalCanonico)].join("|");
}

/**
 * `true` when freshly calculated lines are exactly the latest ficha's
 * (same droga, unidad, manual flag and quantities, compared as decimals):
 * the stored ficha is still current, and a new version would only
 * duplicate it. The lines' position is NOT compared -- an item's
 * componentes have no order (migration 0065), and fichas saved before
 * that kept the order the componentes were loaded in.
 */
export function mismasLineasPesaje(calculadas: readonly LineaPesajeCalculada[], guardadas: readonly LineaPesajeGuardada[]): boolean {
  if (calculadas.length !== guardadas.length) return false;
  const nuevas = calculadas.map((c) => claveLinea(c.drogaId, c.unidadMedida.id, c.esEnraseManual, [c.cantidadTeorica, c.excesoAplicado, c.cantidadAPesar])).sort();
  const actuales = guardadas.map((g) => claveLinea(g.drogaId, g.unidadMedidaId, g.esEnraseManual, [g.cantidadTeorica, g.excesoAplicado, g.cantidadAPesar])).sort();
  return nuevas.every((clave, i) => clave === actuales[i]);
}

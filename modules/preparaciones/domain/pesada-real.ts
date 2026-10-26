/**
 * Pesada real (openspec/specs/pesada-real/spec.md): the lab weighs by hand, so a non-manual línea records what the balance
 * showed. Pure and client-safe: the form prefills and flags with it, the server (`planificarConsumoEnTx`) decides
 * with it. Every quantity here is PHYSICAL and in the LÍNEA's unit (the magnitud's base unit, e.g. g).
 *
 *   - Prefill: the expected physical weight (purity-corrected) rounded half-up to the balance (`precision_balanza`,
 *     defined in GRAMO -- the base unit of MASA, the unit a MASA línea is in). 0,0455 g -> 0,046 g; 0,0454 g -> 0,045 g.
 *     A línea of another magnitud (volumen, unidades) is not rounded: no balance applies.
 *   - Tolerance: |real - esperada| <= margen, margen = max(esperada x tolerancia %, one balance division) -- never
 *     stricter than what the balance can show. Outside it the DT co-signs.
 */
import { Decimal, dec } from "@/shared/decimal";

/** `precision_balanza` (GRAMO) in a línea's unit, or `null` when the línea is not weighed on the balance (not MASA). */
export function precisionDeLinea(unidad: { tipoMagnitud: string; factorABase: Decimal | string }, precisionBalanzaGramos: Decimal | string): Decimal | null {
  if (unidad.tipoMagnitud !== "MASA") return null;
  // GRAMO is MASA's base unit (factor 1): a línea unit with factor f holds 1 / f of the base per unit.
  return dec(precisionBalanzaGramos).dividedBy(dec(unidad.factorABase));
}

/** `cantidad` rounded half-up to a multiple of `precision` (unchanged when `null`). */
export function redondearABalanza(cantidad: Decimal | string, precision: Decimal | null): Decimal {
  const valor = dec(cantidad);
  if (!precision || !precision.greaterThan(0)) return valor;
  return valor.toNearest(precision, Decimal.ROUND_HALF_UP);
}

export interface EvaluacionPesada {
  /** Allowed |real - esperada|. */
  margen: Decimal;
  /** real - esperada (signed). */
  desvio: Decimal;
  /** desvio / esperada x 100, 2 decimals (signed). */
  desvioPorcentaje: Decimal;
  fueraDeTolerancia: boolean;
}

export function evaluarPesada(
  real: Decimal | string,
  esperada: Decimal | string,
  toleranciaPorcentaje: Decimal | string,
  precision: Decimal | null,
): EvaluacionPesada {
  const r = dec(real);
  const e = dec(esperada);
  const margen = Decimal.max(e.times(dec(toleranciaPorcentaje)).dividedBy(100), precision ?? 0);
  const desvio = r.minus(e);
  return {
    margen,
    desvio,
    desvioPorcentaje: e.greaterThan(0) ? desvio.dividedBy(e).times(100).toDecimalPlaces(2) : dec(0),
    fueraDeTolerancia: desvio.abs().greaterThan(margen),
  };
}

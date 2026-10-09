/**
 * Quantity conversion between two `fsj.unidad_medida` rows of the SAME
 * `tipo_magnitud`, with the exact arithmetic of the DB's `fsj.convertir`
 * (migration 0006, INV-M01): `valor x factor_origen / factor_destino`.
 * Pure: callers load the two units' `factor_a_base` and `tipo_magnitud`.
 *
 * Use it where a quantity crosses from one unit to another without a DB
 * round trip, e.g. a línea de pesaje (in its magnitud's base unit, g / mL)
 * becoming a stock quantity (in the droga's unidad base, e.g. mg / mcg).
 * Never converts across magnitudes (no density, DP-06b): check
 * `mismaMagnitud` first and give the user a clear message.
 */
import { Decimal, dec } from "./index";

/** The fields of a `fsj.unidad_medida` row a conversion needs. */
export interface UnidadDeConversion {
  /** `factor_a_base` (numeric as text or `Decimal`), > 0. */
  factorABase: Decimal | string;
  tipoMagnitud: string;
}

/** `true` when a quantity in `a` can be converted into `b` (same `tipo_magnitud`, INV-M01). */
export function mismaMagnitud(a: UnidadDeConversion, b: UnidadDeConversion): boolean {
  return a.tipoMagnitud === b.tipoMagnitud;
}

/** `valor` (in `origen`) expressed in `destino`. Throws `RangeError` across magnitudes -- callers check `mismaMagnitud` first. */
export function convertirCantidad(valor: Decimal | string, origen: UnidadDeConversion, destino: UnidadDeConversion): Decimal {
  if (!mismaMagnitud(origen, destino)) {
    throw new RangeError(`convertirCantidad: cannot convert ${origen.tipoMagnitud} into ${destino.tipoMagnitud} (INV-M01).`);
  }
  const factorOrigen = dec(origen.factorABase);
  const factorDestino = dec(destino.factorABase);
  if (factorOrigen.equals(factorDestino)) return dec(valor);
  return dec(valor).times(factorOrigen).dividedBy(factorDestino);
}

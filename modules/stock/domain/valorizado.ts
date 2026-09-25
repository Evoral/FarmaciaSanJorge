/**
 * Pure Decimal math for the stock valorizado report (FASE 13 point 13.2).
 * `number` (IEEE-754 float) is never used for money/quantity math
 * (INV-PL-003, plan §9 M00) -- every value here is a decimal STRING in and
 * out, run through `decimal.js` (`shared/decimal`), never a native `+`/`*`.
 *
 * The report's per-row `valor` and per-droga subtotals are computed in SQL
 * (`fsj.partida.cantidad_disponible * fsj.partida.costo_unitario`, cast to
 * text -- see `modules/stock/infrastructure/valorizado-repository.ts`),
 * which is Postgres `numeric` arithmetic end to end and therefore already
 * float-free. `calcularValorPartida` below is the JS-side reference
 * implementation of that exact multiplication -- kept here (a) as a
 * documented, independently unit-testable spec of what the SQL must
 * compute, and (b) for any caller that only has the two decimal strings on
 * hand (no DB round trip). `sumarValores` IS on the real production path:
 * it combines the SQL-computed per-droga subtotals into the report's grand
 * total using exact Decimal addition, which is mathematically identical to
 * (and cheaper than) a second SQL-wide SUM query.
 */
import { Decimal, dec } from "@/shared/decimal";

/** `cantidadDisponible x costoUnitario` (both per unidad base of the droga), as an exact decimal string. Mirrors the SQL valorization -- see module doc comment. */
export function calcularValorPartida(cantidadDisponible: string, costoUnitario: string): string {
  return dec(cantidadDisponible).times(dec(costoUnitario)).toString();
}

/** Exact Decimal sum of a list of decimal-string values (e.g. per-droga subtotals) -- never `Array#reduce` with native `+`. Returns `"0"` for an empty list. */
export function sumarValores(valores: readonly string[]): string {
  return valores.reduce((acc: Decimal, v) => acc.plus(dec(v)), new Decimal(0)).toString();
}

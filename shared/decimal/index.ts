/**
 * Decimal arithmetic for quantities and money. `number` (IEEE-754 float)
 * is never used for quantities or amounts -- see INV-PL-003 in plan §9
 * (M00). All such values are `numeric` in Postgres and `Decimal` here.
 */
import { Decimal } from "decimal.js";

Decimal.set({
  precision: 34, // generous for pharmaceutical quantities (mg/mL dilutions) and currency
  rounding: Decimal.ROUND_HALF_UP,
});

export { Decimal };

/** Parses a string/number into a `Decimal`. Throws on invalid input -- callers should validate with zod first. */
export function dec(value: string | number | Decimal): Decimal {
  return new Decimal(value);
}

/** True if `value` is strictly greater than zero. */
export function isPositive(value: Decimal): boolean {
  return value.greaterThan(0);
}

/** True if `value` is greater than or equal to zero. */
export function isNonNegative(value: Decimal): boolean {
  return value.greaterThanOrEqualTo(0);
}

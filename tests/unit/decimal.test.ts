import { describe, it, expect } from "vitest";
import { Decimal, dec, isPositive, isNonNegative } from "@/shared/decimal";

describe("shared/decimal", () => {
  it("dec() parses strings without float precision loss", () => {
    // The classic float trap: 0.1 + 0.2 !== 0.3 in IEEE-754.
    const sum = dec("0.1").plus(dec("0.2"));
    expect(sum.toString()).toBe("0.3");
  });

  it("dec() accepts numbers and Decimal instances too", () => {
    expect(dec(5).toString()).toBe("5");
    expect(dec(new Decimal("2.5")).toString()).toBe("2.5");
  });

  it("isPositive() is strict (zero is not positive)", () => {
    expect(isPositive(dec("0.01"))).toBe(true);
    expect(isPositive(dec("0"))).toBe(false);
    expect(isPositive(dec("-1"))).toBe(false);
  });

  it("isNonNegative() allows zero", () => {
    expect(isNonNegative(dec("0"))).toBe(true);
    expect(isNonNegative(dec("-0.01"))).toBe(false);
  });

  it("rounds half away from zero (ROUND_HALF_UP), per the configured rounding mode", () => {
    expect(new Decimal("2.5").toDecimalPlaces(0).toString()).toBe("3");
    // ROUND_HALF_UP in decimal.js means ties round AWAY from zero, so -2.5 -> -3 (not -2).
    expect(new Decimal("-2.5").toDecimalPlaces(0).toString()).toBe("-3");
  });
});

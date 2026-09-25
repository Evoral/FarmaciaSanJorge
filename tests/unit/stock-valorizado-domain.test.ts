/**
 * Pure Decimal math for the stock valorizado report (FASE 13 point 13.2).
 * See `modules/stock/domain/valorizado.ts`'s doc comment for why
 * `calcularValorPartida` is tested here even though the production path
 * computes the same multiplication in SQL.
 */
import { describe, it, expect } from "vitest";
import { calcularValorPartida, sumarValores } from "@/modules/stock/domain/valorizado";

describe("calcularValorPartida", () => {
  it("multiplies cantidad x costo with exact decimal precision (no float rounding)", () => {
    // 0.1 * 3 === 0.30000000000000004 in IEEE-754 float; Decimal must not.
    expect(calcularValorPartida("0.1", "3")).toBe("0.3");
  });

  it("handles many-decimal pharmaceutical quantities correctly", () => {
    expect(calcularValorPartida("123.456", "7.89")).toBe("974.06784");
  });

  it("returns 0 when cantidad is 0", () => {
    expect(calcularValorPartida("0", "999.99")).toBe("0");
  });

  it("throws on invalid decimal input (never silently coerces)", () => {
    expect(() => calcularValorPartida("not-a-number", "1")).toThrow();
  });
});

describe("sumarValores", () => {
  it("sums decimal-string subtotals exactly (never Array#reduce with native +)", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754 float; Decimal must not.
    expect(sumarValores(["0.1", "0.2"])).toBe("0.3");
  });

  it("returns '0' for an empty list", () => {
    expect(sumarValores([])).toBe("0");
  });

  it("sums a mix of large and small values without precision loss", () => {
    expect(sumarValores(["1000000.01", "0.02", "999999.97"])).toBe("2000000");
  });
});

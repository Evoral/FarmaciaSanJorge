/**
 * Vencimiento del preparado (DP-28 "Vencimiento", resolved 2026-10-07): the
 * pure calendar arithmetic in modules/preparaciones/domain/vencimiento.ts.
 * No JS Date involved, so none of these depend on the machine's timezone.
 */
import { describe, it, expect } from "vitest";
import {
  MESES_VENCIMIENTO_PREPARADO_DEFAULT,
  calcularVencimientoPreparado,
  parseMesesVencimientoPreparado,
} from "@/modules/preparaciones/domain/vencimiento";

describe("calcularVencimientoPreparado", () => {
  it("adds calendar months keeping the day of the month", () => {
    expect(calcularVencimientoPreparado("2026-03-15", 3)).toBe("2026-06-15");
    expect(calcularVencimientoPreparado("2026-10-07", 3)).toBe("2027-01-07");
    expect(calcularVencimientoPreparado("2026-12-01", 1)).toBe("2027-01-01");
  });

  it("clamps to the last day of a shorter target month", () => {
    expect(calcularVencimientoPreparado("2026-01-31", 1)).toBe("2026-02-28");
    expect(calcularVencimientoPreparado("2026-08-31", 1)).toBe("2026-09-30");
    expect(calcularVencimientoPreparado("2028-11-30", 3)).toBe("2029-02-28");
  });

  it("clamps to Feb 29 when the target year is a leap year", () => {
    expect(calcularVencimientoPreparado("2027-11-29", 3)).toBe("2028-02-29");
    expect(calcularVencimientoPreparado("2027-11-30", 3)).toBe("2028-02-29");
    expect(calcularVencimientoPreparado("2027-11-29", 15)).toBe("2029-02-28");
  });

  it("handles the century leap-year rules", () => {
    expect(calcularVencimientoPreparado("2099-11-30", 3)).toBe("2100-02-28"); // 2100 is not a leap year
    expect(calcularVencimientoPreparado("1999-11-30", 3)).toBe("2000-02-29"); // 2000 is
  });

  it("crosses years for long periods", () => {
    expect(calcularVencimientoPreparado("2026-10-07", 12)).toBe("2027-10-07");
    expect(calcularVencimientoPreparado("2026-10-07", 30)).toBe("2029-04-07");
  });

  it("rejects a malformed or impossible date", () => {
    expect(() => calcularVencimientoPreparado("2026-02-30", 3)).toThrow();
    expect(() => calcularVencimientoPreparado("2026-13-01", 3)).toThrow();
    expect(() => calcularVencimientoPreparado("07/10/2026", 3)).toThrow();
    expect(() => calcularVencimientoPreparado("", 3)).toThrow();
  });

  it("rejects a non-positive or non-integer number of months", () => {
    expect(() => calcularVencimientoPreparado("2026-10-07", 0)).toThrow();
    expect(() => calcularVencimientoPreparado("2026-10-07", -1)).toThrow();
    expect(() => calcularVencimientoPreparado("2026-10-07", 1.5)).toThrow();
    expect(() => calcularVencimientoPreparado("2026-10-07", Number.NaN)).toThrow();
  });
});

describe("parseMesesVencimientoPreparado", () => {
  it("parses a positive integer", () => {
    expect(parseMesesVencimientoPreparado("6")).toBe(6);
    expect(parseMesesVencimientoPreparado(" 12 ")).toBe(12);
    expect(parseMesesVencimientoPreparado("60")).toBe(60);
  });

  it("falls back to the default (3) when the tenant has no row or the value is unusable", () => {
    expect(MESES_VENCIMIENTO_PREPARADO_DEFAULT).toBe(3);
    for (const raw of [null, undefined, "", "abc", "0", "-2", "1.5", "61", "999999999"]) {
      expect(parseMesesVencimientoPreparado(raw)).toBe(MESES_VENCIMIENTO_PREPARADO_DEFAULT);
    }
  });
});

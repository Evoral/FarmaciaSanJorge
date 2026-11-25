import { describe, it, expect } from "vitest";
import { actividadDesdeRelacion, parsearActividad, uiEnMasa } from "@/modules/stock/domain/actividad";

describe("actividad (4.1)", () => {
  it('parses "1000 U.I. cada 10 g" -> 100 U.I./g (UI4)', () => {
    const res = parsearActividad("1000 U.I. cada 10 g");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.uiPorGramo.toFixed()).toBe("100");
  });

  it('parses reversed order "10 g cada 1000 U.I." -> 100 U.I./g', () => {
    const res = parsearActividad("10 g cada 1000 U.I.");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.uiPorGramo.toFixed()).toBe("100");
  });

  it("converts mass units (mg, mcg, kg) to U.I./g", () => {
    const mg = parsearActividad("500 U.I. cada 500 mg");
    expect(mg.ok).toBe(true);
    if (mg.ok) expect(mg.uiPorGramo.toFixed()).toBe("1000");

    const mcg = parsearActividad("1 UI cada 100 mcg");
    expect(mcg.ok).toBe(true);
    if (mcg.ok) expect(mcg.uiPorGramo.toFixed()).toBe("10000");

    const kg = parsearActividad("500000 U.I. cada 1 kg");
    expect(kg.ok).toBe(true);
    if (kg.ok) expect(kg.uiPorGramo.toFixed()).toBe("500");
  });

  it('supports slash notation "100 U.I./g" and comma decimals', () => {
    const slash = parsearActividad("100 U.I./g");
    expect(slash.ok).toBe(true);
    if (slash.ok) expect(slash.uiPorGramo.toFixed()).toBe("100");

    const comma = parsearActividad("125,5 U.I. cada 0,5 g");
    expect(comma.ok).toBe(true);
    if (comma.ok) expect(comma.uiPorGramo.toFixed()).toBe("251");
  });

  it("rejects non-positive, empty, ambiguous or malformed expressions", () => {
    expect(parsearActividad("").ok).toBe(false);
    expect(parsearActividad("0 U.I. cada 10 g").ok).toBe(false);
    expect(parsearActividad("100 U.I. cada 0 g").ok).toBe(false);
    expect(parsearActividad("-100 U.I. cada 1 g").ok).toBe(false);
    expect(parsearActividad("100 U.I. cada 10 mL").ok).toBe(false);
    expect(parsearActividad("1.500 U.I. cada 1 g").ok).toBe(false);
    expect(parsearActividad("100 U.I.").ok).toBe(false);
  });

  it("computes actividadDesdeRelacion and uiEnMasa with Decimal", () => {
    const uiPorG = actividadDesdeRelacion("50000", "250", "MILIGRAMO");
    expect(uiPorG.toFixed()).toBe("200000");
    expect(uiEnMasa(uiPorG, "250", "MILIGRAMO").toFixed()).toBe("50000");
    expect(() => actividadDesdeRelacion("0", "1", "GRAMO")).toThrow(RangeError);
    expect(() => actividadDesdeRelacion("10", "-1", "GRAMO")).toThrow(RangeError);
  });
});

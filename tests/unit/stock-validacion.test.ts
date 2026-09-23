/**
 * Pure validation tests for `modules/stock/domain/partida.ts` (FASE 5,
 * points 5.1/5.4). No database, no mocked transaction.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { esFechaVencimientoFutura, ajusteExcedeSaldo, esMotivoAjuste, MOTIVOS_AJUSTE, positiveDecimalString, nonNegativeDecimalString } from "@/modules/stock/domain/partida";

describe("esFechaVencimientoFutura", () => {
  it("accepts a date strictly after the jornada", () => {
    expect(esFechaVencimientoFutura("2026-07-01", "2026-06-15")).toBe(true);
  });
  it("rejects a date equal to the jornada (must be strictly future)", () => {
    expect(esFechaVencimientoFutura("2026-06-15", "2026-06-15")).toBe(false);
  });
  it("rejects a date before the jornada", () => {
    expect(esFechaVencimientoFutura("2026-06-01", "2026-06-15")).toBe(false);
  });
});

describe("ajusteExcedeSaldo (5.4)", () => {
  it("rejects an ajuste quantity greater than the available balance", () => {
    expect(ajusteExcedeSaldo(new Decimal("11"), new Decimal("10"))).toBe(true);
  });
  it("accepts an ajuste quantity equal to the available balance (drains it fully)", () => {
    expect(ajusteExcedeSaldo(new Decimal("10"), new Decimal("10"))).toBe(false);
  });
  it("accepts an ajuste quantity less than the available balance", () => {
    expect(ajusteExcedeSaldo(new Decimal("5"), new Decimal("10"))).toBe(false);
  });
});

describe("esMotivoAjuste / MOTIVOS_AJUSTE", () => {
  it("accepts every declared motivo (ROTURA, DERRAME, VENCIMIENTO, PREPARACION_DESCARTADA, DIFERENCIA_ARQUEO)", () => {
    for (const motivo of MOTIVOS_AJUSTE) {
      expect(esMotivoAjuste(motivo)).toBe(true);
    }
    expect(MOTIVOS_AJUSTE).toEqual(["ROTURA", "DERRAME", "VENCIMIENTO", "PREPARACION_DESCARTADA", "DIFERENCIA_ARQUEO"]);
  });
  it("rejects an unknown motivo", () => {
    expect(esMotivoAjuste("SOBRANTE")).toBe(false);
  });
});

describe("positiveDecimalString", () => {
  it.each(["0", "-1", "abc", ""])("rejects %s", (value) => {
    expect(positiveDecimalString.safeParse(value).success).toBe(false);
  });
  it("accepts a positive decimal", () => {
    const result = positiveDecimalString.safeParse("12.5");
    expect(result.success).toBe(true);
  });
});

describe("nonNegativeDecimalString (5.5, partida.costo_unitario >= 0)", () => {
  it.each(["-1", "abc", ""])("rejects %s", (value) => {
    expect(nonNegativeDecimalString.safeParse(value).success).toBe(false);
  });
  it.each(["0", "12.5"])("accepts %s", (value) => {
    expect(nonNegativeDecimalString.safeParse(value).success).toBe(true);
  });
});

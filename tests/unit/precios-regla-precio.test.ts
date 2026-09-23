/**
 * Unit tests for `modules/precios/domain/regla-precio.ts` (M08, FASE 4
 * point 4.6, DP-09 RESUELTA / INV-PR-001).
 */
import { describe, it, expect } from "vitest";
import { esMargenValido, calcularPrecioFinal, planVersionarReglaPrecio } from "@/modules/precios/domain/regla-precio";

describe("esMargenValido", () => {
  it("accepts 0 (no markup at all is a valid margen)", () => {
    expect(esMargenValido("0")).toBe(true);
  });

  it("accepts a positive margen", () => {
    expect(esMargenValido("300")).toBe(true);
  });

  it("rejects a negative margen", () => {
    expect(esMargenValido("-1")).toBe(false);
  });
});

describe("calcularPrecioFinal -- DP-09: precio = costo + margen% del costo", () => {
  it("margen 100 adds 100% on top: price is twice the cost", () => {
    expect(calcularPrecioFinal("50", "100").toString()).toBe("100");
  });

  it("margen 300 adds 300% on top: price is four times the cost", () => {
    expect(calcularPrecioFinal("50", "300").toString()).toBe("200");
  });

  it("the user's own example: cost 1000 with margen 150 is 2500", () => {
    expect(calcularPrecioFinal("1000", "150").toString()).toBe("2500");
  });

  it("margen 0 means selling at cost, never zero", () => {
    expect(calcularPrecioFinal("50", "0").toString()).toBe("50");
  });

  it("costoInsumos 0 (every linea was enrase manual) yields precio 0 regardless of margen", () => {
    expect(calcularPrecioFinal("0", "300").toString()).toBe("0");
  });
});

describe("planVersionarReglaPrecio -- INV-PR-001 (versioned, never updated)", () => {
  it("plans to close the current row when one is already open", () => {
    expect(planVersionarReglaPrecio(true)).toEqual({ debeCerrarActual: true });
  });

  it("plans a plain insert (nothing to close) for the very first regla of a tenant", () => {
    expect(planVersionarReglaPrecio(false)).toEqual({ debeCerrarActual: false });
  });
});

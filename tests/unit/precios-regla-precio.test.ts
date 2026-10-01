/**
 * Unit tests for `modules/precios/domain/regla-precio.ts` (M08): the
 * 2026-10-01 price rule set (margin tramos by cost + precio mínimo,
 * docs/specs/reglas-precio.md) and INV-PR-001 versioning.
 */
import { describe, it, expect } from "vitest";
import {
  calcularPrecioFinal,
  describirTramos,
  esMargenValido,
  indiceTramoParaCosto,
  planVersionarReglaPrecio,
  validarReglasPrecio,
} from "@/modules/precios/domain/regla-precio";
import type { ReglasPrecio } from "@/modules/precios/domain/regla-precio";

/** The user's own example: <= 100000 -> +100%, > 100000 -> +70%, floor 20000. */
const EJEMPLO: ReglasPrecio = {
  precioMinimo: "20000",
  tramos: [
    { costoHasta: "100000", margen: "100" },
    { costoHasta: null, margen: "70" },
  ],
};

function unico(margen: string, precioMinimo = "0"): ReglasPrecio {
  return { precioMinimo, tramos: [{ costoHasta: null, margen }] };
}

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

describe("calcularPrecioFinal -- markup on the WHOLE cost of the tramo the cost falls into", () => {
  it("single open tramo, no floor: margen 100 doubles the cost (the old DP-09 formula)", () => {
    expect(calcularPrecioFinal("50", unico("100")).precioFinal.toString()).toBe("100");
  });

  it("the DP-09 example still holds with one tramo: cost 1000 with margen 150 is 2500", () => {
    expect(calcularPrecioFinal("1000", unico("150")).precioFinal.toString()).toBe("2500");
  });

  it("margen 0 means selling at cost", () => {
    expect(calcularPrecioFinal("50", unico("0")).precioFinal.toString()).toBe("50");
  });

  it("cost exactly equal to costoHasta belongs to THAT tramo: 100000 -> 200000", () => {
    const r = calcularPrecioFinal("100000", EJEMPLO);
    expect(r.tramoAplicado).toBe(0);
    expect(r.margenAplicado.toString()).toBe("100");
    expect(r.precioFinal.toString()).toBe("200000");
    expect(r.precioMinimoAplicado).toBe(false);
  });

  it("just above the boundary is the next tramo, on the WHOLE cost (not progressive): 100001 -> 170001.7 -- the price drop is INTENDED", () => {
    const r = calcularPrecioFinal("100001", EJEMPLO);
    expect(r.tramoAplicado).toBe(1);
    expect(r.margenAplicado.toString()).toBe("70");
    expect(r.precioFinal.toString()).toBe("170001.7");
    expect(r.precioFinal.lessThan(calcularPrecioFinal("100000", EJEMPLO).precioFinal)).toBe(true);
  });

  it("the floor is compared against the tramo price, not the cost: 15000 at +100% -> 30000 (floor not applied)", () => {
    const r = calcularPrecioFinal("15000", EJEMPLO);
    expect(r.precioFinal.toString()).toBe("30000");
    expect(r.precioMinimoAplicado).toBe(false);
  });

  it("a tramo price below the floor is raised to it: 5000 at +100% = 10000 -> 20000", () => {
    const r = calcularPrecioFinal("5000", EJEMPLO);
    expect(r.precioFinal.toString()).toBe("20000");
    expect(r.precioMinimoAplicado).toBe(true);
    expect(r.margenAplicado.toString()).toBe("100");
  });

  it("a tramo price exactly equal to the floor is not flagged as floored", () => {
    const r = calcularPrecioFinal("10000", EJEMPLO);
    expect(r.precioFinal.toString()).toBe("20000");
    expect(r.precioMinimoAplicado).toBe(false);
  });

  it("cost 0 is priced at the floor (first tramo, floor applied)", () => {
    const r = calcularPrecioFinal("0", EJEMPLO);
    expect(r.tramoAplicado).toBe(0);
    expect(r.precioFinal.toString()).toBe("20000");
    expect(r.precioMinimoAplicado).toBe(true);
  });

  it("cost 0 without a floor yields 0 regardless of margen", () => {
    const r = calcularPrecioFinal("0", unico("300"));
    expect(r.precioFinal.toString()).toBe("0");
    expect(r.precioMinimoAplicado).toBe(false);
  });

  it("three tramos: each boundary inclusive, a cost far above the last tope uses the open tramo", () => {
    const reglas: ReglasPrecio = {
      precioMinimo: "0",
      tramos: [
        { costoHasta: "1000", margen: "200" },
        { costoHasta: "5000", margen: "100" },
        { costoHasta: null, margen: "50" },
      ],
    };
    expect(indiceTramoParaCosto("1000", reglas.tramos)).toBe(0);
    expect(indiceTramoParaCosto("1000.01", reglas.tramos)).toBe(1);
    expect(indiceTramoParaCosto("5000", reglas.tramos)).toBe(1);
    expect(indiceTramoParaCosto("5000.01", reglas.tramos)).toBe(2);
    expect(calcularPrecioFinal("1000000", reglas).precioFinal.toString()).toBe("1500000");
  });

  it("throws on a rule set no tramo covers (invalid: last tramo has a tope)", () => {
    expect(() => calcularPrecioFinal("200", { precioMinimo: "0", tramos: [{ costoHasta: "100", margen: "10" }] })).toThrow(/no tramo covers/);
  });
});

describe("validarReglasPrecio -- overlaps and gaps impossible by construction", () => {
  it("accepts the user's example", () => {
    expect(validarReglasPrecio(EJEMPLO)).toEqual([]);
  });

  it("accepts a single open tramo", () => {
    expect(validarReglasPrecio(unico("100"))).toEqual([]);
  });

  it("rejects an empty tramo list", () => {
    expect(validarReglasPrecio({ precioMinimo: "0", tramos: [] })).toEqual([{ campo: "tramos", mensaje: expect.stringContaining("al menos un tramo") }]);
  });

  it("rejects a non-increasing costoHasta (overlap) and an equal one", () => {
    const decreciente = validarReglasPrecio({
      precioMinimo: "0",
      tramos: [
        { costoHasta: "1000", margen: "10" },
        { costoHasta: "500", margen: "10" },
        { costoHasta: null, margen: "10" },
      ],
    });
    expect(decreciente).toEqual([{ campo: "costoHasta", indiceTramo: 1, mensaje: expect.stringContaining("mayor que el del tramo anterior") }]);

    const igual = validarReglasPrecio({
      precioMinimo: "0",
      tramos: [
        { costoHasta: "1000", margen: "10" },
        { costoHasta: "1000", margen: "10" },
        { costoHasta: null, margen: "10" },
      ],
    });
    expect(igual).toHaveLength(1);
    expect(igual[0]).toMatchObject({ campo: "costoHasta", indiceTramo: 1 });
  });

  it("rejects a null costoHasta that is not the last tramo", () => {
    const problemas = validarReglasPrecio({
      precioMinimo: "0",
      tramos: [
        { costoHasta: null, margen: "10" },
        { costoHasta: null, margen: "10" },
      ],
    });
    expect(problemas).toEqual([{ campo: "costoHasta", indiceTramo: 0, mensaje: expect.stringContaining("Solo el último tramo") }]);
  });

  it("rejects a last tramo with a tope", () => {
    const problemas = validarReglasPrecio({ precioMinimo: "0", tramos: [{ costoHasta: "1000", margen: "10" }] });
    expect(problemas).toEqual([{ campo: "costoHasta", indiceTramo: 0, mensaje: expect.stringContaining("último tramo no lleva tope") }]);
  });

  it("rejects a costoHasta of 0 or less", () => {
    const problemas = validarReglasPrecio({
      precioMinimo: "0",
      tramos: [
        { costoHasta: "0", margen: "10" },
        { costoHasta: null, margen: "10" },
      ],
    });
    expect(problemas).toEqual([{ campo: "costoHasta", indiceTramo: 0, mensaje: expect.stringContaining("mayor que 0") }]);
  });

  it("rejects a negative margen and a negative precioMinimo", () => {
    const problemas = validarReglasPrecio({ precioMinimo: "-1", tramos: [{ costoHasta: null, margen: "-5" }] });
    expect(problemas).toEqual([
      { campo: "precioMinimo", mensaje: expect.stringContaining("precio mínimo") },
      { campo: "margen", indiceTramo: 0, mensaje: expect.stringContaining("margen") },
    ]);
  });

  it("accepts margen 0 and precioMinimo 0", () => {
    expect(validarReglasPrecio(unico("0", "0"))).toEqual([]);
  });
});

describe("describirTramos (audit summary)", () => {
  it("reads one line per tramo", () => {
    expect(describirTramos(EJEMPLO.tramos)).toBe("hasta 100000: +100%; más de 100000: +70%");
    expect(describirTramos(unico("150").tramos)).toBe("cualquier costo: +150%");
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

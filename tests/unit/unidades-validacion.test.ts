/**
 * Unit tests for `modules/unidades/domain/unidad.ts` (FASE 4 point 4.1):
 * `esBaseValido` (mirrors migration 0006's `unidad_medida_base_factor_check`)
 * and the factor validation (`positiveDecimalString`, via crear-unidad.ts's
 * exported input schema).
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { esBaseValido, esTipoMagnitud, TIPOS_MAGNITUD } from "@/modules/unidades/domain/unidad";
import { crearUnidadInput } from "@/modules/unidades/application/crear-unidad";

describe("esBaseValido (mirrors unidad_medida_base_factor_check)", () => {
  it("a base unit must have factor exactly 1", () => {
    expect(esBaseValido(true, new Decimal(1))).toBe(true);
    expect(esBaseValido(true, new Decimal(2))).toBe(false);
    expect(esBaseValido(true, new Decimal("0.5"))).toBe(false);
  });
  it("a non-base unit may have any factor", () => {
    expect(esBaseValido(false, new Decimal(1))).toBe(true);
    expect(esBaseValido(false, new Decimal(1000))).toBe(true);
  });
});

describe("esTipoMagnitud", () => {
  it("accepts only the seeded magnitudes (DP-07 partially resolved)", () => {
    for (const tipo of TIPOS_MAGNITUD) {
      expect(esTipoMagnitud(tipo)).toBe(true);
    }
  });
  it("rejects magnitudes DP-07 has not resolved yet", () => {
    expect(esTipoMagnitud("GOTA")).toBe(false);
    expect(esTipoMagnitud("PORCENTAJE")).toBe(false);
    expect(esTipoMagnitud("")).toBe(false);
  });
});

describe("crearUnidadInput (factorABase via shared positiveDecimalString)", () => {
  const base = { codigo: "test", nombre: "Test", simbolo: "t", tipoMagnitud: "MASA" as const };

  it("accepts a positive factor", () => {
    const result = crearUnidadInput.safeParse({ ...base, factorABase: "1.5" });
    expect(result.success).toBe(true);
  });
  it("uppercases codigo", () => {
    const result = crearUnidadInput.safeParse({ ...base, factorABase: "1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.codigo).toBe("TEST");
  });
  it("rejects a zero or negative factor", () => {
    expect(crearUnidadInput.safeParse({ ...base, factorABase: "0" }).success).toBe(false);
    expect(crearUnidadInput.safeParse({ ...base, factorABase: "-1" }).success).toBe(false);
  });
  it("rejects a non-numeric factor", () => {
    expect(crearUnidadInput.safeParse({ ...base, factorABase: "abc" }).success).toBe(false);
  });
});

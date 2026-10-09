import { describe, it, expect } from "vitest";
import { convertirCantidad, type UnidadDeConversion } from "@/shared/decimal/convertir-unidad";

const GRAMO: UnidadDeConversion = { factorABase: "1", tipoMagnitud: "MASA" };
const KILOGRAMO: UnidadDeConversion = { factorABase: "1000", tipoMagnitud: "MASA" };
const MILIGRAMO: UnidadDeConversion = { factorABase: "0.001", tipoMagnitud: "MASA" };
const MICROGRAMO: UnidadDeConversion = { factorABase: "0.000001", tipoMagnitud: "MASA" };
const LITRO: UnidadDeConversion = { factorABase: "1", tipoMagnitud: "VOLUMEN" };
const MILILITRO: UnidadDeConversion = { factorABase: "0.001", tipoMagnitud: "VOLUMEN" };

describe("convertirCantidad (fsj.convertir's arithmetic)", () => {
  it("converts identity (same unit)", () => {
    expect(convertirCantidad("100", GRAMO, GRAMO).toFixed()).toBe("100");
    expect(convertirCantidad("100", MILILITRO, MILILITRO).toFixed()).toBe("100");
  });

  it("converts mcg <-> g <-> kg", () => {
    // mcg to g
    expect(convertirCantidad("500000", MICROGRAMO, GRAMO).toFixed()).toBe("0.5");
    // g to mcg
    expect(convertirCantidad("0.5", GRAMO, MICROGRAMO).toFixed()).toBe("500000");
    // g to kg
    expect(convertirCantidad("1500", GRAMO, KILOGRAMO).toFixed()).toBe("1.5");
    // kg to g
    expect(convertirCantidad("1.5", KILOGRAMO, GRAMO).toFixed()).toBe("1500");
    // mcg to kg
    expect(convertirCantidad("1000000000", MICROGRAMO, KILOGRAMO).toFixed()).toBe("1");
    // kg to mcg
    expect(convertirCantidad("1", KILOGRAMO, MICROGRAMO).toFixed()).toBe("1000000000");
  });

  it("converts mL <-> L", () => {
    expect(convertirCantidad("1500", MILILITRO, LITRO).toFixed()).toBe("1.5");
    expect(convertirCantidad("1.5", LITRO, MILILITRO).toFixed()).toBe("1500");
  });

  it("refuses across different magnitudes", () => {
    expect(() => convertirCantidad("1", GRAMO, MILILITRO)).toThrow(RangeError);
    expect(() => convertirCantidad("1", LITRO, KILOGRAMO)).toThrow(RangeError);
  });
});



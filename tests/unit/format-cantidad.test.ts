import { describe, it, expect } from "vitest";
import {
  crearCatalogoUnidades,
  equivalenciasPracticas,
  formatCantidad,
  formatCantidadesFila,
  formatCantidadExacta,
  formatNumero,
  unidadesPracticas,
  type UnidadFormato,
} from "@/shared/format/cantidad";

/** Migration 0006's seed (plus a non-whitelisted unit sharing MASA, to prove the whitelist is by codigo). */
const UNIDADES: UnidadFormato[] = [
  { id: "mcg", codigo: "MICROGRAMO", simbolo: "mcg", tipoMagnitud: "MASA", factorABase: "0.0000010000", esBase: false },
  { id: "mg", codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factorABase: "0.0010000000", esBase: false },
  { id: "g", codigo: "GRAMO", simbolo: "g", tipoMagnitud: "MASA", factorABase: "1.0000000000", esBase: true },
  { id: "kg", codigo: "KILOGRAMO", simbolo: "kg", tipoMagnitud: "MASA", factorABase: "1000.0000000000", esBase: false },
  { id: "mcl", codigo: "MICROLITRO", simbolo: "mcL", tipoMagnitud: "VOLUMEN", factorABase: "0.0010000000", esBase: false },
  { id: "ml", codigo: "MILILITRO", simbolo: "mL", tipoMagnitud: "VOLUMEN", factorABase: "1.0000000000", esBase: true },
  { id: "l", codigo: "LITRO", simbolo: "L", tipoMagnitud: "VOLUMEN", factorABase: "1000.0000000000", esBase: false },
  { id: "u", codigo: "UNIDAD", simbolo: "u", tipoMagnitud: "UNIDADES", factorABase: "1.0000000000", esBase: true },
  { id: "ton", codigo: "TONELADA", simbolo: "t", tipoMagnitud: "MASA", factorABase: "1000000.0000000000", esBase: false },
];
const catalogo = crearCatalogoUnidades(UNIDADES);
const unidad = (id: string) => ({ id, simbolo: UNIDADES.find((u) => u.id === id)!.simbolo });

describe("shared/format/cantidad -- formatNumero (es-AR)", () => {
  it("groups thousands with '.' and uses ',' for decimals, stripping trailing zeros", () => {
    expect(formatNumero("1234567.8900")).toBe("1.234.567,89");
    expect(formatNumero("500000000.0000000000")).toBe("500.000.000");
    expect(formatNumero("0.0500")).toBe("0,05");
    expect(formatNumero("-1234.5")).toBe("-1.234,5");
  });

  it("rounds half up only when asked", () => {
    expect(formatNumero("1.005", 2)).toBe("1,01");
    expect(formatNumero("1.0049999", 2)).toBe("1");
    expect(formatNumero("1.0049999")).toBe("1,0049999");
    expect(formatNumero("-0.001", 2)).toBe("0");
  });
});

describe("shared/format/cantidad -- auto mode", () => {
  it.each([
    ["500000000.0000000000", "mcg", "500 g"],
    ["0.7", "kg", "700 g"],
    ["790000000.000000000000", "mcg", "790 g"],
    ["0.004", "mg", "4 mcg"],
    ["1500", "mg", "1,5 g"],
    ["1234.5", "g", "1,23 kg"],
    ["9999.99", "g", "10 kg"],
    ["2500", "mL", "2,5 L"],
    ["0.5", "mL", "500 mcL"],
  ])("%s %s -> %s", (valor, id, esperado) => {
    const origen = UNIDADES.find((u) => u.simbolo === id)!;
    expect(formatCantidad(valor, { id: origen.id, simbolo: origen.simbolo }, catalogo).texto).toBe(esperado);
  });

  it("shows zero in the magnitude's base unit", () => {
    expect(formatCantidad("0.0000000000", unidad("mcg"), catalogo).texto).toBe("0 g");
    expect(formatCantidad("0", unidad("l"), catalogo).texto).toBe("0 mL");
  });

  it("picks the closest unit when none keeps the value in [1, 10000)", () => {
    expect(formatCantidad("50000", unidad("kg"), catalogo).texto).toBe("50.000 kg");
    expect(formatCantidad("0.0000005", unidad("mg"), catalogo).texto).toBe("< 0,01 mcg");
  });

  it("never converts units outside the whitelisted chains, even within the same magnitude", () => {
    expect(formatCantidad("12.3456", unidad("u"), catalogo).texto).toBe("12,35 u");
    expect(formatCantidad("0.002", unidad("ton"), catalogo).texto).toBe("< 0,01 t");
    expect(formatCantidad("1500000", unidad("g"), catalogo).texto).toBe("1.500 kg");
  });

  it("falls back to the given symbol for a unit missing from the catalog", () => {
    expect(formatCantidad("3.10000", { id: "desconocida", simbolo: "gotas" }, catalogo).texto).toBe("3,1 gotas");
  });

  it("keeps the exact, unrounded value in the original unit for the tooltip", () => {
    expect(formatCantidad("500000000.1234567890", unidad("mcg"), catalogo)).toEqual({
      texto: "500 g",
      exacto: "500.000.000,123456789 mcg",
    });
  });

  it("never loses precision to floats", () => {
    expect(formatCantidad("0.3", unidad("g"), catalogo, { modo: "base" }).texto).toBe("0,3 g");
    expect(formatCantidad("100000.000000000000000001", unidad("mcg"), catalogo).exacto).toBe("100.000,000000000000000001 mcg");
  });
});

describe("shared/format/cantidad -- base mode (Unificar unidades)", () => {
  it("shows convertible chains in the base unit with up to 3 decimals", () => {
    expect(formatCantidad("500000000", unidad("mcg"), catalogo, { modo: "base" }).texto).toBe("500 g");
    expect(formatCantidad("1234.5678", unidad("mg"), catalogo, { modo: "base" }).texto).toBe("1,235 g");
    expect(formatCantidad("2.5", unidad("l"), catalogo, { modo: "base" }).texto).toBe("2.500 mL");
    expect(formatCantidad("0.1", unidad("mcg"), catalogo, { modo: "base" }).texto).toBe("< 0,001 g");
  });

  it("leaves non-convertible units unchanged", () => {
    expect(formatCantidad("7.125", unidad("u"), catalogo, { modo: "base" }).texto).toBe("7,13 u");
  });
});

describe("shared/format/cantidad -- one unit per row", () => {
  it("chooses the unit from the larger value so both figures are comparable", () => {
    const [stock, minimo] = formatCantidadesFila(["5000", "100"], unidad("mg"), catalogo);
    expect(stock!.texto).toBe("5 g");
    expect(minimo!.texto).toBe("0,1 g");
  });

  it("uses the base unit when every value is zero", () => {
    expect(formatCantidadesFila(["0", "0"], unidad("mcg"), catalogo).map((c) => c.texto)).toEqual(["0 g", "0 g"]);
  });

  it("honors base mode for the whole row", () => {
    expect(formatCantidadesFila(["2", "0.5"], unidad("kg"), catalogo, "base").map((c) => c.texto)).toEqual(["2.000 g", "500 g"]);
  });
});

describe("shared/format/cantidad -- exact (libro contralor)", () => {
  it("only strips trailing zeros: no unit change, no rounding", () => {
    expect(formatCantidadExacta("1500.1234500000", "mg")).toBe("1.500,12345 mg");
    expect(formatCantidadExacta("0.0000010000", "g")).toBe("0,000001 g");
  });
});

describe("shared/format/cantidad -- practical units (ajuste form)", () => {
  const texto = (valor: string, id: string, cat = catalogo) => {
    const { primaria, secundaria } = equivalenciasPracticas(valor, unidad(id), cat);
    return [primaria.texto, secundaria?.texto ?? null];
  };

  it("lists only mg/g/kg and mL/L, smallest first (never mcg/mcL, never another magnitude)", () => {
    expect(unidadesPracticas(unidad("mcg"), catalogo).map((u) => u.simbolo)).toEqual(["mg", "g", "kg"]);
    expect(unidadesPracticas(unidad("g"), catalogo).map((u) => u.simbolo)).toEqual(["mg", "g", "kg"]);
    expect(unidadesPracticas(unidad("mcl"), catalogo).map((u) => u.simbolo)).toEqual(["mL", "L"]);
  });

  it("has no practical units for a non-convertible or unknown unit", () => {
    expect(unidadesPracticas(unidad("u"), catalogo)).toEqual([]);
    expect(unidadesPracticas({ id: "gota", simbolo: "gota" }, catalogo)).toEqual([]);
  });

  it("skips units dadas de baja", () => {
    const sinKg = crearCatalogoUnidades(UNIDADES.map((u) => (u.id === "kg" ? { ...u, vigente: false } : u)));
    expect(unidadesPracticas(unidad("g"), sinKg).map((u) => u.simbolo)).toEqual(["mg", "g"]);
    expect(texto("2500", "g", sinKg)).toEqual(["2.500 g", "2.500.000 mg"]);
  });

  it.each([
    ["500000000.0000000000", "mcg", "500 g", "500.000 mg"],
    ["2500", "g", "2,5 kg", "2.500 g"],
    ["1234.5678", "g", "1,2345678 kg", "1.234,5678 g"],
    ["999.9999", "g", "999,9999 g", "999.999,9 mg"],
    ["0.5", "g", "500 mg", "0,5 g"],
    ["0.0004", "g", "0,4 mg", "0,0004 g"],
    ["1500", "mcl", "1,5 mL", "0,0015 L"],
    ["1500", "ml", "1,5 L", "1.500 mL"],
    ["0", "g", "0 mg", "0 g"],
  ])("%s %s -> primary %s, secondary %s (exact, no rounding)", (valor, id, primaria, secundaria) => {
    expect(texto(valor, id)).toEqual([primaria, secundaria]);
  });

  it("names the unit of each equivalence (the form preselects the primary one)", () => {
    const { primaria, secundaria } = equivalenciasPracticas("2500", unidad("g"), catalogo);
    expect(primaria.unidadId).toBe("kg");
    expect(secundaria?.unidadId).toBe("g");
  });

  it("shows a non-convertible unit exactly, with no secondary equivalence", () => {
    expect(texto("12.5000", "u")).toEqual(["12,5 u", null]);
    expect(equivalenciasPracticas("12.5", unidad("u"), catalogo).primaria.unidadId).toBe("u");
  });
});

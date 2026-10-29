/**
 * Unit tests for insumos de la preparación domain rules (spec openspec/specs/insumos-preparacion/spec.md):
 * - modules/preparaciones/domain/insumo.ts: claseAdmitida (I1, I3, I6), nombreTipoInsumo, drogaRepetida (I8),
 *   cantidadCapsulas (I2), textoInsumo / TEXTO_INSUMO_MAX (I6, I9). Pure rules, no I/O.
 * - modules/preparaciones/domain/formula-prescripcion.ts: formatearFormulaPrescripcion with insumos adicionales (I9).
 */
import { describe, it, expect } from "vitest";
import {
  claseAdmitida,
  nombreTipoInsumo,
  drogaRepetida,
  cantidadCapsulas,
  textoInsumo,
  TEXTO_INSUMO_MAX,
} from "@/modules/preparaciones/domain/insumo";
import { formatearFormulaPrescripcion, type ItemPrescripto } from "@/modules/preparaciones/domain/formula-prescripcion";

describe("insumos domain: claseAdmitida (I1, I3, I6)", () => {
  it("MATERIAL admits only drogas of clase MATERIAL", () => {
    expect(claseAdmitida("MATERIAL", "MATERIAL")).toBe(true);
    expect(claseAdmitida("MATERIAL", "EXCIPIENTE")).toBe(false);
    expect(claseAdmitida("MATERIAL", "DROGA")).toBe(false);
  });

  it("ADICIONAL admits drogas of clase EXCIPIENTE or MATERIAL, never DROGA", () => {
    expect(claseAdmitida("ADICIONAL", "EXCIPIENTE")).toBe(true);
    expect(claseAdmitida("ADICIONAL", "MATERIAL")).toBe(true);
    expect(claseAdmitida("ADICIONAL", "DROGA")).toBe(false);
  });
});

describe("insumos domain: nombreTipoInsumo", () => {
  it("maps MATERIAL to 'material' and ADICIONAL to 'insumo'", () => {
    expect(nombreTipoInsumo("MATERIAL")).toBe("material");
    expect(nombreTipoInsumo("ADICIONAL")).toBe("insumo");
  });
});

describe("insumos domain: drogaRepetida (I8)", () => {
  it("returns null when the array is empty", () => {
    expect(drogaRepetida([])).toBeNull();
  });

  it("returns null when all droga ids are distinct", () => {
    expect(drogaRepetida(["droga-1", "droga-2", "droga-3"])).toBeNull();
  });

  it("ignores null and undefined entries and returns null if no duplicates among strings", () => {
    expect(drogaRepetida([null, undefined, "droga-1", null, "droga-2", undefined])).toBeNull();
  });

  it("returns the duplicate droga id when a droga appears twice", () => {
    expect(drogaRepetida(["droga-1", "droga-2", "droga-1"])).toBe("droga-1");
  });

  it("detects when an insumo repeats the excipiente's droga (passed as first item)", () => {
    const excipienteDrogaId = "droga-excipiente";
    const insumoDrogaId = "droga-excipiente";
    expect(drogaRepetida([excipienteDrogaId, "droga-material", insumoDrogaId])).toBe("droga-excipiente");
  });

  it("returns the first repeated droga encountered", () => {
    expect(drogaRepetida(["d1", "d2", "d2", "d1"])).toBe("d2");
  });
});

describe("insumos domain: cantidadCapsulas (I2)", () => {
  it("returns the unit count as string when forma is CAPSULA and cantidadUnidades > 0", () => {
    expect(cantidadCapsulas({ formaFarmaceutica: "CAPSULA", cantidadUnidades: 60 })).toBe("60");
    expect(cantidadCapsulas({ formaFarmaceutica: "CAPSULA", cantidadUnidades: 100 })).toBe("100");
  });

  it("returns null when forma is not CAPSULA", () => {
    expect(cantidadCapsulas({ formaFarmaceutica: "CREMA", cantidadUnidades: 60 })).toBeNull();
    expect(cantidadCapsulas({ formaFarmaceutica: "JARABE", cantidadUnidades: 1 })).toBeNull();
    expect(cantidadCapsulas({ formaFarmaceutica: "COMPRIMIDO", cantidadUnidades: 30 })).toBeNull();
    expect(cantidadCapsulas({ formaFarmaceutica: "POMADA", cantidadUnidades: 50 })).toBeNull();
  });

  it("returns null when cantidadUnidades is 0 or negative", () => {
    expect(cantidadCapsulas({ formaFarmaceutica: "CAPSULA", cantidadUnidades: 0 })).toBeNull();
    expect(cantidadCapsulas({ formaFarmaceutica: "CAPSULA", cantidadUnidades: -10 })).toBeNull();
  });
});

describe("insumos domain: textoInsumo and TEXTO_INSUMO_MAX (I6, I9)", () => {
  it("formats the insumo text with Argentine decimal comma format and unidad symbol", () => {
    expect(textoInsumo("Aerosil", "0.5", "g")).toBe("Aerosil 0,5 g");
    expect(textoInsumo("Cápsula vacía Nº 0", "60", "u")).toBe("Cápsula vacía Nº 0 60 u");
    expect(textoInsumo("Celulosa microcristalina", "10.25", "g")).toBe("Celulosa microcristalina 10,25 g");
  });

  it("truncates to TEXTO_INSUMO_MAX (120 chars) when longer", () => {
    const longName = "A".repeat(150);
    const result = textoInsumo(longName, "1", "g");
    expect(result.length).toBe(TEXTO_INSUMO_MAX);
    expect(TEXTO_INSUMO_MAX).toBe(120);
  });
});

describe("insumos in fórmula de la prescripción: formatearFormulaPrescripcion (I9)", () => {
  const baseItem: ItemPrescripto = {
    formaFarmaceutica: "CAPSULA",
    cantidadUnidades: 60,
    fraccionDosisPorUnidad: "0.5",
    cantidadTotal: null,
    unidadTotalSimbolo: null,
    componentes: [
      { drogaNombre: "Minoxidil", cantidad: "5", unidadSimbolo: "mg", modoExpresion: "POR_DOSIS", esPrincipioActivo: true },
      { drogaNombre: "Finasteride", cantidad: "1", unidadSimbolo: "mg", modoExpresion: "POR_DOSIS", esPrincipioActivo: true },
    ],
    excipiente: "Ludipress",
  };

  it("appends an ADICIONAL of clase EXCIPIENTE after the excipiente's 'c.s.p.' entry, without 'c.s.p.'", () => {
    const item: ItemPrescripto = {
      ...baseItem,
      adicionales: ["Aerosil 0,5 g"],
    };
    expect(formatearFormulaPrescripcion(item)).toBe(
      "Finasteride 1 mg; Minoxidil 5 mg; Ludipress c.s.p.; Aerosil 0,5 g — 60 Cápsulas (1 cápsula = ½ dosis)",
    );
  });

  it("appends multiple ADICIONAL entries in order after excipiente", () => {
    const item: ItemPrescripto = {
      ...baseItem,
      adicionales: ["Aerosil 0,5 g", "Celulosa microcristalina 1 g"],
    };
    expect(formatearFormulaPrescripcion(item)).toBe(
      "Finasteride 1 mg; Minoxidil 5 mg; Ludipress c.s.p.; Aerosil 0,5 g; Celulosa microcristalina 1 g — 60 Cápsulas (1 cápsula = ½ dosis)",
    );
  });

  it("formats formula when item has no excipiente but has adicionales", () => {
    const item: ItemPrescripto = {
      ...baseItem,
      excipiente: null,
      adicionales: ["Aerosil 0,5 g"],
    };
    expect(formatearFormulaPrescripcion(item)).toBe(
      "Finasteride 1 mg; Minoxidil 5 mg; Aerosil 0,5 g — 60 Cápsulas (1 cápsula = ½ dosis)",
    );
  });

  it("handles undefined or empty adicionales array without trailing semicolons", () => {
    const itemWithoutAdicionales: ItemPrescripto = {
      ...baseItem,
      adicionales: undefined,
    };
    expect(formatearFormulaPrescripcion(itemWithoutAdicionales)).toBe(
      "Finasteride 1 mg; Minoxidil 5 mg; Ludipress c.s.p. — 60 Cápsulas (1 cápsula = ½ dosis)",
    );

    const itemWithEmptyAdicionales: ItemPrescripto = {
      ...baseItem,
      adicionales: [],
    };
    expect(formatearFormulaPrescripcion(itemWithEmptyAdicionales)).toBe(
      "Finasteride 1 mg; Minoxidil 5 mg; Ludipress c.s.p. — 60 Cápsulas (1 cápsula = ½ dosis)",
    );
  });

  it("normalizes and trims whitespace in adicionales entries", () => {
    const item: ItemPrescripto = {
      ...baseItem,
      adicionales: ["  Aerosil 0,5 g  ", "   "],
    };
    expect(formatearFormulaPrescripcion(item)).toBe(
      "Finasteride 1 mg; Minoxidil 5 mg; Ludipress c.s.p.; Aerosil 0,5 g — 60 Cápsulas (1 cápsula = ½ dosis)",
    );
  });
});

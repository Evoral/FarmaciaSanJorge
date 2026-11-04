/**
 * Unit tests for excipiente por unidad domain logic (migration 0113, openspec/specs/excipiente-preparacion/spec.md):
 * - modules/preparaciones/domain/excipiente-por-unidad.ts: dosisDelItem, unidadesDelItem, pesoDeDrogas,
 *   cantidadExcipienteAPesar, textoFormulaExcipiente, textoDesglosePorUnidad.
 * - modules/preparaciones/domain/formula-prescripcion.ts: formatearFormulaPrescripcion with excipiente por unidad
 *   (rendered per dosis) and c.s.p.
 */
import { describe, it, expect } from "vitest";
import { dec } from "@/shared/decimal";
import type { UnidadDeConversion } from "@/shared/decimal/convertir-unidad";
import {
  dosisDelItem,
  unidadesDelItem,
  pesoDeDrogas,
  cantidadExcipienteAPesar,
  textoFormulaExcipiente,
  textoExcipientePorUnidad,
  textoDesglosePorUnidad,
  type ItemDosificable,
  type LineaConPeso,
} from "@/modules/preparaciones/domain/excipiente-por-unidad";
import { TEXTO_INSUMO_MAX } from "@/modules/preparaciones/domain/insumo";
import { formatearFormulaPrescripcion, type ItemPrescripto } from "@/modules/preparaciones/domain/formula-prescripcion";

const UNIDAD_G: UnidadDeConversion = { factorABase: "1", tipoMagnitud: "MASA" };
const UNIDAD_MG: UnidadDeConversion = { factorABase: "0.001", tipoMagnitud: "MASA" };
const UNIDAD_ML: UnidadDeConversion = { factorABase: "1", tipoMagnitud: "VOLUMEN" };

describe("excipiente por unidad domain: dosisDelItem", () => {
  it("calculates 30 cápsulas × 0.5 = 15 dosis", () => {
    const item: ItemDosificable = {
      formaFarmaceutica: "CAPSULA",
      cantidadUnidades: 30,
      fraccionDosisPorUnidad: "0.5",
    };
    const res = dosisDelItem(item);
    expect(res).not.toBeNull();
    expect(res!.toString()).toBe("15");
  });

  it("calculates dosis for other unit-based formas (COMPRIMIDO, OVULO, SUPOSITORIO)", () => {
    for (const forma of ["COMPRIMIDO", "OVULO", "SUPOSITORIO"]) {
      const item: ItemDosificable = {
        formaFarmaceutica: forma,
        cantidadUnidades: 20,
        fraccionDosisPorUnidad: "1",
      };
      const res = dosisDelItem(item);
      expect(res).not.toBeNull();
      expect(res!.toString()).toBe("20");
    }
  });

  it("returns null for non-unit formas such as CREMA", () => {
    const item: ItemDosificable = {
      formaFarmaceutica: "CREMA",
      cantidadUnidades: 1,
      fraccionDosisPorUnidad: "1",
    };
    expect(dosisDelItem(item)).toBeNull();
  });

  it("returns null when cantidadUnidades is 0 or negative", () => {
    const itemZero: ItemDosificable = {
      formaFarmaceutica: "CAPSULA",
      cantidadUnidades: 0,
      fraccionDosisPorUnidad: "0.5",
    };
    expect(dosisDelItem(itemZero)).toBeNull();

    const itemNeg: ItemDosificable = {
      formaFarmaceutica: "CAPSULA",
      cantidadUnidades: -5,
      fraccionDosisPorUnidad: "0.5",
    };
    expect(dosisDelItem(itemNeg)).toBeNull();
  });
});

describe("excipiente por unidad domain: unidadesDelItem", () => {
  it("returns units metadata for 30 cápsulas of 0.5 dosis", () => {
    const item: ItemDosificable = {
      formaFarmaceutica: "CAPSULA",
      cantidadUnidades: 30,
      fraccionDosisPorUnidad: "0.5",
    };
    const res = unidadesDelItem(item);
    expect(res).not.toBeNull();
    expect(res!.cantidad.toString()).toBe("30");
    expect(res!.dosis.toString()).toBe("15");
    expect(res!.singular).toBe("cápsula");
    expect(res!.plural).toBe("cápsulas");
  });

  it("maps singular and plural unit names for all unit-based formas", () => {
    const expectativas: Record<string, [string, string]> = {
      CAPSULA: ["cápsula", "cápsulas"],
      COMPRIMIDO: ["comprimido", "comprimidos"],
      OVULO: ["óvulo", "óvulos"],
      SUPOSITORIO: ["supositorio", "supositorios"],
    };

    for (const [forma, [singular, plural]] of Object.entries(expectativas)) {
      const res = unidadesDelItem({
        formaFarmaceutica: forma,
        cantidadUnidades: 10,
        fraccionDosisPorUnidad: "1",
      });
      expect(res).not.toBeNull();
      expect(res!.singular).toBe(singular);
      expect(res!.plural).toBe(plural);
    }
  });

  it("returns null for non-unit formas such as CREMA or SOLUCION", () => {
    expect(
      unidadesDelItem({
        formaFarmaceutica: "CREMA",
        cantidadUnidades: 100,
        fraccionDosisPorUnidad: "1",
      }),
    ).toBeNull();
  });

  it("returns null when cantidadUnidades is 0 or negative", () => {
    expect(
      unidadesDelItem({
        formaFarmaceutica: "CAPSULA",
        cantidadUnidades: 0,
        fraccionDosisPorUnidad: "1",
      }),
    ).toBeNull();
    expect(
      unidadesDelItem({
        formaFarmaceutica: "CAPSULA",
        cantidadUnidades: -10,
        fraccionDosisPorUnidad: "1",
      }),
    ).toBeNull();
  });
});

describe("excipiente por unidad domain: pesoDeDrogas", () => {
  it("sums cantidadAPesar converted to the base unit of MASA", () => {
    const lineas: LineaConPeso[] = [
      { cantidadAPesar: "75", esEnraseManual: false, unidad: UNIDAD_MG }, // 0.075 g
      { cantidadAPesar: "1.5", esEnraseManual: false, unidad: UNIDAD_G }, // 1.5 g
    ];
    const res = pesoDeDrogas(lineas);
    expect(res).not.toBeNull();
    expect(res!.toString()).toBe("1.575");
  });

  it("returns dec(0) for empty lineas array", () => {
    const res = pesoDeDrogas([]);
    expect(res).not.toBeNull();
    expect(res!.toString()).toBe("0");
  });

  it("returns null if any línea is an enrase manual", () => {
    const lineas: LineaConPeso[] = [
      { cantidadAPesar: "75", esEnraseManual: false, unidad: UNIDAD_MG },
      { cantidadAPesar: "1", esEnraseManual: true, unidad: UNIDAD_G },
    ];
    expect(pesoDeDrogas(lineas)).toBeNull();
  });

  it("returns null if any línea has no cantidadAPesar", () => {
    const lineas: LineaConPeso[] = [
      { cantidadAPesar: "75", esEnraseManual: false, unidad: UNIDAD_MG },
      { cantidadAPesar: null, esEnraseManual: false, unidad: UNIDAD_G },
    ];
    expect(pesoDeDrogas(lineas)).toBeNull();
  });

  it("returns null if any línea is not MASA", () => {
    const lineas: LineaConPeso[] = [
      { cantidadAPesar: "75", esEnraseManual: false, unidad: UNIDAD_MG },
      { cantidadAPesar: "10", esEnraseManual: false, unidad: UNIDAD_ML },
    ];
    expect(pesoDeDrogas(lineas)).toBeNull();
  });
});

describe("excipiente por unidad domain: cantidadExcipienteAPesar", () => {
  describe("worked example: 30 cápsulas, 15 dosis, 0.075 g de drogas", () => {
    it("mode c.s.p.: 12 g total -> total 11.925 g, porUnidad null, porDosis null, drogas 0.075", () => {
      const res = cantidadExcipienteAPesar({
        cantidad: "12",
        unidades: null,
        pesoDrogas: dec("0.075"),
        unidad: UNIDAD_G,
      });
      expect(res.total.toString()).toBe("11.925");
      expect(res.porUnidad).toBeNull();
      expect(res.porDosis).toBeNull();
      expect(res.drogas).not.toBeNull();
      expect(res.drogas!.toString()).toBe("0.075");
    });

    it("mode per unidad: 0.4 g -> total 11.925 g, porUnidad 0.3975 g, porDosis 0.795 g, drogas 0.075", () => {
      const res = cantidadExcipienteAPesar({
        cantidad: "0.4",
        unidades: { cantidad: dec(30), dosis: dec(15) },
        pesoDrogas: dec("0.075"),
        unidad: UNIDAD_G,
      });
      expect(res.total.toString()).toBe("11.925");
      expect(res.porUnidad).not.toBeNull();
      expect(res.porUnidad!.toString()).toBe("0.3975");
      expect(res.porDosis).not.toBeNull();
      expect(res.porDosis!.toString()).toBe("0.795");
      expect(res.drogas).not.toBeNull();
      expect(res.drogas!.toString()).toBe("0.075");
    });

    it("converts pesoDrogas in g base into the excipiente's unit (e.g. excipiente in mg)", () => {
      // Excipiente in mg (factorABase: 0.001): c.s.p. 12000 mg, drogas 0.075 g base -> drogas in mg = 75 mg, total = 11925 mg
      const res = cantidadExcipienteAPesar({
        cantidad: "12000",
        unidades: null,
        pesoDrogas: dec("0.075"),
        unidad: UNIDAD_MG,
      });
      expect(res.total.toString()).toBe("11925");
      expect(res.drogas).not.toBeNull();
      expect(res.drogas!.toString()).toBe("75");
      expect(res.porUnidad).toBeNull();
      expect(res.porDosis).toBeNull();
    });
  });

  describe("no-subtraction cases (enrase as typed)", () => {
    it("does not subtract when pesoDrogas is null (c.s.p. mode)", () => {
      const res = cantidadExcipienteAPesar({
        cantidad: "12",
        unidades: null,
        pesoDrogas: null,
        unidad: UNIDAD_G,
      });
      expect(res.total.toString()).toBe("12");
      expect(res.drogas).toBeNull();
      expect(res.porUnidad).toBeNull();
      expect(res.porDosis).toBeNull();
    });

    it("does not subtract when pesoDrogas is null (per unidad mode)", () => {
      const res = cantidadExcipienteAPesar({
        cantidad: "0.4",
        unidades: { cantidad: "30", dosis: "15" },
        pesoDrogas: null,
        unidad: UNIDAD_G,
      });
      expect(res.total.toString()).toBe("12");
      expect(res.porUnidad!.toString()).toBe("0.4");
      expect(res.porDosis!.toString()).toBe("0.8");
      expect(res.drogas).toBeNull();
    });

    it("does not subtract when excipiente unit is not MASA (e.g. excipiente in mL)", () => {
      const res = cantidadExcipienteAPesar({
        cantidad: "100",
        unidades: null,
        pesoDrogas: dec("5"),
        unidad: UNIDAD_ML,
      });
      expect(res.total.toString()).toBe("100");
      expect(res.drogas).toBeNull();
    });
  });

  describe("non-positive total (weight <= drogas)", () => {
    it("results in non-positive total when c.s.p. weight is equal to or less than drogas", () => {
      const resEqual = cantidadExcipienteAPesar({
        cantidad: "0.075",
        unidades: null,
        pesoDrogas: dec("0.075"),
        unidad: UNIDAD_G,
      });
      expect(resEqual.total.isZero()).toBe(true);

      const resLess = cantidadExcipienteAPesar({
        cantidad: "0.05",
        unidades: null,
        pesoDrogas: dec("0.075"),
        unidad: UNIDAD_G,
      });
      expect(resLess.total.isNegative()).toBe(true);
    });

    it("results in non-positive total when per-unidad weight times units is less than drogas", () => {
      // 0.002 g × 30 = 0.06 g < 0.075 g
      const res = cantidadExcipienteAPesar({
        cantidad: "0.002",
        unidades: { cantidad: "30", dosis: "15" },
        pesoDrogas: dec("0.075"),
        unidad: UNIDAD_G,
      });
      expect(res.total.toString()).toBe("-0.015");
      expect(res.total.isNegative()).toBe(true);
    });
  });
});

describe("excipiente por unidad domain: textoFormulaExcipiente", () => {
  it("formats per dosis with quantity and unit symbol formatted in Argentine Spanish", () => {
    expect(textoFormulaExcipiente("Ludipress", "g", "0.795")).toBe("Ludipress 0,795 g");
    expect(textoFormulaExcipiente("Almidón", "g", dec("1.25"))).toBe("Almidón 1,25 g");
  });

  it("formats c.s.p. with the droga name alone when cantidadPorDosis is null", () => {
    expect(textoFormulaExcipiente("Ludipress", "g", null)).toBe("Ludipress");
    expect(textoFormulaExcipiente("Celulosa microcristalina", "g", null)).toBe("Celulosa microcristalina");
  });

  it("truncates to TEXTO_INSUMO_MAX characters if exceeded", () => {
    const longName = "A".repeat(TEXTO_INSUMO_MAX + 50);
    const formatted = textoFormulaExcipiente(longName, "g", "0.5");
    expect(formatted.length).toBe(TEXTO_INSUMO_MAX);
  });
});

describe("excipiente por unidad domain: textoExcipientePorUnidad", () => {
  it("formats '= 0,3975 g por cápsula' with string and Decimal arguments", () => {
    expect(textoExcipientePorUnidad("0.3975", "g", "cápsula")).toBe("= 0,3975 g por cápsula");
    expect(textoExcipientePorUnidad(dec("0.3975"), "g", "cápsula")).toBe("= 0,3975 g por cápsula");
  });

  it("formats '= 0,25 g por comprimido' for COMPRIMIDO", () => {
    expect(textoExcipientePorUnidad("0.25", "g", "comprimido")).toBe("= 0,25 g por comprimido");
  });
});

describe("excipiente por unidad domain: textoDesglosePorUnidad", () => {
  it("formats breakdown text '0,3975 g × 30 cápsulas'", () => {
    expect(textoDesglosePorUnidad("0.3975", "g", "30", "cápsulas")).toBe("0,3975 g × 30 cápsulas");
    expect(textoDesglosePorUnidad(dec("0.3975"), "g", dec("30"), "cápsulas")).toBe("0,3975 g × 30 cápsulas");
    expect(textoDesglosePorUnidad("0.25", "g", "60", "comprimidos")).toBe("0,25 g × 60 comprimidos");
  });
});

describe("formatearFormulaPrescripcion with excipiente por unidad (rendered per dosis in libro) and c.s.p.", () => {
  const baseItem: ItemPrescripto = {
    formaFarmaceutica: "CAPSULA",
    cantidadUnidades: 30,
    fraccionDosisPorUnidad: "0.5",
    cantidadTotal: null,
    unidadTotalSimbolo: null,
    componentes: [
      {
        drogaNombre: "Minoxidil",
        cantidad: "5",
        unidadSimbolo: "mg",
        modoExpresion: "POR_DOSIS",
        esPrincipioActivo: true,
      },
    ],
    excipiente: null,
  };

  it("formats formula with per-unidad excipiente written PER DOSIS ending in 'Ludipress 0,795 g c.s.p.'", () => {
    const item: ItemPrescripto = {
      ...baseItem,
      excipiente: textoFormulaExcipiente("Ludipress", "g", "0.795"),
    };
    expect(formatearFormulaPrescripcion(item)).toBe(
      "Minoxidil 5 mg; Ludipress 0,795 g c.s.p. — 30 Cápsulas (1 cápsula = ½ dosis)",
    );
  });

  it("formats formula with c.s.p. excipiente text ending in 'Ludipress c.s.p.'", () => {
    const item: ItemPrescripto = {
      ...baseItem,
      excipiente: textoFormulaExcipiente("Ludipress", "g", null),
    };
    expect(formatearFormulaPrescripcion(item)).toBe(
      "Minoxidil 5 mg; Ludipress c.s.p. — 30 Cápsulas (1 cápsula = ½ dosis)",
    );
  });
});

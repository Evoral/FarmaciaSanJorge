/**
 * T1-T8 from docs/specs/ficha-tecnica.md, reproduced EXACTLY, plus one case
 * per validation V1-V9 and a dedicated R3/R7/R8 interplay case (CSP must
 * subtract the UNROUNDED teorica of the other components, never their
 * rounded cantidadAPesar).
 */
import { describe, it, expect } from "vitest";
import { dec } from "@/shared/decimal";
import {
  calcularFichaTecnica,
  FichaTecnicaValidationError,
  type ComponenteInput,
  type ItemRecetaInput,
  type ParametrosPesaje,
  type UnidadMedidaRef,
} from "./calcular-ficha-tecnica";

// Mirrors the seed data in prisma/migrations/.../0006_unidades_medida.
const GRAMO: UnidadMedidaRef = { id: "gramo", tipoMagnitud: "MASA", factorABase: 1 };
const MILIGRAMO: UnidadMedidaRef = { id: "miligramo", tipoMagnitud: "MASA", factorABase: 0.001 };
const MILILITRO: UnidadMedidaRef = { id: "mililitro", tipoMagnitud: "VOLUMEN", factorABase: 1 };
const UNIDAD: UnidadMedidaRef = { id: "unidad", tipoMagnitud: "UNIDADES", factorABase: 1 };

const UNIDADES_BASE = { MASA: GRAMO, VOLUMEN: MILILITRO, UNIDADES: UNIDAD };

const SIN_EXCESO: ParametrosPesaje = { precisionBalanza: 0.001, excesoPesadaPorcentaje: 0 };

function componente(overrides: Partial<ComponenteInput>): ComponenteInput {
  return {
    drogaId: "droga",
    drogaNombre: "Droga",
    cantidad: null,
    unidadMedida: GRAMO,
    modoExpresion: "CS",
    esPrincipioActivo: false,
    orden: 0,
    ...overrides,
  };
}

function item(overrides: Partial<ItemRecetaInput>): ItemRecetaInput {
  return {
    formaFarmaceutica: "CREMA",
    cantidadTotal: null,
    unidadTotal: null,
    cantidadUnidades: 1,
    fraccionDosisPorUnidad: 1,
    ...overrides,
  };
}

describe("calcularFichaTecnica -- spec test cases (docs/specs/ficha-tecnica.md)", () => {
  it("T1 -- Crema, asiento 34163: acido salicilico 3 g TOTAL + vaselina solida CSP -> 3.000 g / 27.000 g", () => {
    const lineas = calcularFichaTecnica(
      item({ formaFarmaceutica: "CREMA", cantidadTotal: 30, unidadTotal: GRAMO, cantidadUnidades: 1 }),
      [
        componente({ drogaId: "acido-salicilico", cantidad: 3, unidadMedida: GRAMO, modoExpresion: "TOTAL", esPrincipioActivo: true, orden: 0 }),
        componente({ drogaId: "vaselina-solida", unidadMedida: GRAMO, modoExpresion: "CSP", orden: 1 }),
      ],
      SIN_EXCESO,
      UNIDADES_BASE,
    );

    expect(lineas).toHaveLength(2);
    expect(lineas[0]!.esEnraseManual).toBe(false);
    expect(lineas[0]!.cantidadAPesar!.equals(dec("3.000"))).toBe(true);
    expect(lineas[1]!.esEnraseManual).toBe(false);
    expect(lineas[1]!.cantidadAPesar!.equals(dec("27.000"))).toBe(true);
  });

  it("T2 -- Crema, asiento 34164: hidroquinona 1.2 g TOTAL + crema base CSP -> 1.200 g / 28.800 g", () => {
    const lineas = calcularFichaTecnica(
      item({ formaFarmaceutica: "CREMA", cantidadTotal: 30, unidadTotal: GRAMO }),
      [
        componente({ drogaId: "hidroquinona", cantidad: 1.2, unidadMedida: GRAMO, modoExpresion: "TOTAL", orden: 0 }),
        componente({ drogaId: "crema-base", unidadMedida: GRAMO, modoExpresion: "CSP", orden: 1 }),
      ],
      SIN_EXCESO,
      UNIDADES_BASE,
    );

    expect(lineas[0]!.cantidadAPesar!.equals(dec("1.200"))).toBe(true);
    expect(lineas[1]!.cantidadAPesar!.equals(dec("28.800"))).toBe(true);
  });

  it("T3 -- Capsulas, asiento 34147: mazindol POR_DOSIS + ludipress CSP (capsular, V4 does not apply) -> 0.045 g / manual", () => {
    const lineas = calcularFichaTecnica(
      item({ formaFarmaceutica: "CAPSULA", cantidadTotal: null, unidadTotal: null, cantidadUnidades: 30, fraccionDosisPorUnidad: 0.5 }),
      [
        componente({ drogaId: "mazindol", cantidad: 3, unidadMedida: MILIGRAMO, modoExpresion: "POR_DOSIS", esPrincipioActivo: true, orden: 0 }),
        componente({ drogaId: "ludipress", unidadMedida: GRAMO, modoExpresion: "CSP", orden: 1 }),
      ],
      SIN_EXCESO,
      UNIDADES_BASE,
    );

    expect(lineas[0]!.esEnraseManual).toBe(false);
    expect(lineas[0]!.cantidadAPesar!.toString()).toBe("0.045");
    expect(lineas[1]!.esEnraseManual).toBe(true);
    expect(lineas[1]!.cantidadTeorica).toBeNull();
    expect(lineas[1]!.cantidadAPesar).toBeNull();
  });

  it("T4 -- Jarabe, asiento 34162: sulfato de zinc TOTAL + jarabe simple CS + sorbitol CSP (R4, distinct magnitudes) -> 1.200 g / manual / manual", () => {
    const lineas = calcularFichaTecnica(
      item({ formaFarmaceutica: "JARABE", cantidadTotal: 120, unidadTotal: MILILITRO, cantidadUnidades: 1 }),
      [
        componente({ drogaId: "sulfato-zinc", cantidad: 1200, unidadMedida: MILIGRAMO, modoExpresion: "TOTAL", esPrincipioActivo: true, orden: 0 }),
        componente({ drogaId: "jarabe-simple", unidadMedida: MILILITRO, modoExpresion: "CS", orden: 1 }),
        componente({ drogaId: "sorbitol", unidadMedida: MILILITRO, modoExpresion: "CSP", orden: 2 }),
      ],
      SIN_EXCESO,
      UNIDADES_BASE,
    );

    expect(lineas[0]!.cantidadAPesar!.equals(dec("1.200"))).toBe(true);
    expect(lineas[1]!.esEnraseManual).toBe(true); // CS
    expect(lineas[2]!.esEnraseManual).toBe(true); // CSP, R4 (mg solido vs ml vehiculo)
  });

  it("T5 -- conversion: TOTAL 1200 miligramo -> 1.200 gramo", () => {
    const lineas = calcularFichaTecnica(
      item({ cantidadTotal: null, unidadTotal: null }),
      [componente({ cantidad: 1200, unidadMedida: MILIGRAMO, modoExpresion: "TOTAL", orden: 0 })],
      SIN_EXCESO,
      UNIDADES_BASE,
    );

    expect(lineas[0]!.cantidadTeorica!.equals(dec("1.2"))).toBe(true);
    expect(lineas[0]!.cantidadAPesar!.equals(dec("1.200"))).toBe(true);
  });

  it("T6 -- exceso y redondeo: exceso 5%, precision 0.01, TOTAL 1.234 g -> teorica 1.234, con exceso 1.2957, a pesar 1.30", () => {
    const lineas = calcularFichaTecnica(
      item({ cantidadTotal: null, unidadTotal: null }),
      [componente({ cantidad: 1.234, unidadMedida: GRAMO, modoExpresion: "TOTAL", orden: 0 })],
      { precisionBalanza: 0.01, excesoPesadaPorcentaje: 5 },
      UNIDADES_BASE,
    );

    expect(lineas[0]!.cantidadTeorica!.toString()).toBe("1.234");
    expect(lineas[0]!.cantidadAPesar!.toString()).toBe("1.3");
  });

  it("T7 -- error V5: CREMA total 30 g, activo 31 g TOTAL, CSP -> componentes superan el total", () => {
    expect(() =>
      calcularFichaTecnica(
        item({ cantidadTotal: 30, unidadTotal: GRAMO }),
        [
          componente({ cantidad: 31, unidadMedida: GRAMO, modoExpresion: "TOTAL", orden: 0 }),
          componente({ unidadMedida: GRAMO, modoExpresion: "CSP", orden: 1 }),
        ],
        SIN_EXCESO,
        UNIDADES_BASE,
      ),
    ).toThrowError(FichaTecnicaValidationError);

    try {
      calcularFichaTecnica(
        item({ cantidadTotal: 30, unidadTotal: GRAMO }),
        [
          componente({ cantidad: 31, unidadMedida: GRAMO, modoExpresion: "TOTAL", orden: 0 }),
          componente({ unidadMedida: GRAMO, modoExpresion: "CSP", orden: 1 }),
        ],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FichaTecnicaValidationError);
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V5");
    }
  });

  it("T8 -- error V2: dos componentes CSP", () => {
    try {
      calcularFichaTecnica(
        item({ cantidadTotal: 30, unidadTotal: GRAMO }),
        [
          componente({ unidadMedida: GRAMO, modoExpresion: "CSP", orden: 0 }),
          componente({ unidadMedida: GRAMO, modoExpresion: "CSP", orden: 1 }),
        ],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FichaTecnicaValidationError);
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V2");
    }
  });
});

describe("calcularFichaTecnica -- validations V1-V9 (one case each, beyond T7/T8)", () => {
  it("V1 -- item_receta without components", () => {
    expect(() => calcularFichaTecnica(item({}), [], SIN_EXCESO, UNIDADES_BASE)).toThrowError(/^V1:/);
  });

  it("V3 -- CSP component does not occupy the last orden", () => {
    try {
      calcularFichaTecnica(
        item({ cantidadTotal: 30, unidadTotal: GRAMO }),
        [
          componente({ unidadMedida: GRAMO, modoExpresion: "CSP", orden: 0 }),
          componente({ cantidad: 3, unidadMedida: GRAMO, modoExpresion: "TOTAL", orden: 1 }),
        ],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V3");
    }
  });

  it("V4 -- CSP present on a non-capsular form with cantidadTotal/unidadTotal null", () => {
    try {
      calcularFichaTecnica(
        item({ formaFarmaceutica: "CREMA", cantidadTotal: null, unidadTotal: null }),
        [componente({ unidadMedida: GRAMO, modoExpresion: "CSP", orden: 0 })],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V4");
    }
  });

  it("V6 -- TOTAL with cantidad null", () => {
    try {
      calcularFichaTecnica(
        item({}),
        [componente({ cantidad: null, unidadMedida: GRAMO, modoExpresion: "TOTAL", orden: 0 })],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V6");
    }
  });

  it("V6 -- POR_DOSIS with cantidad <= 0", () => {
    try {
      calcularFichaTecnica(
        item({}),
        [componente({ cantidad: 0, unidadMedida: GRAMO, modoExpresion: "POR_DOSIS", orden: 0 })],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V6");
    }
  });

  it("V7 -- CS with a non-null cantidad", () => {
    try {
      calcularFichaTecnica(
        item({}),
        [componente({ cantidad: 5, unidadMedida: GRAMO, modoExpresion: "CS", orden: 0 })],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V7");
    }
  });

  it("V7 -- CSP with a non-null cantidad", () => {
    try {
      calcularFichaTecnica(
        item({ cantidadTotal: 30, unidadTotal: GRAMO }),
        [componente({ cantidad: 5, unidadMedida: GRAMO, modoExpresion: "CSP", orden: 0 })],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V7");
    }
  });

  it("V8 -- fraccionDosisPorUnidad <= 0", () => {
    try {
      calcularFichaTecnica(
        item({ fraccionDosisPorUnidad: 0 }),
        [componente({ cantidad: 1, unidadMedida: GRAMO, modoExpresion: "TOTAL", orden: 0 })],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V8");
    }
  });

  it("V8 -- fraccionDosisPorUnidad > 1", () => {
    try {
      calcularFichaTecnica(
        item({ fraccionDosisPorUnidad: 1.5 }),
        [componente({ cantidad: 1, unidadMedida: GRAMO, modoExpresion: "TOTAL", orden: 0 })],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V8");
    }
  });

  it("V9 -- cantidadUnidades <= 0", () => {
    try {
      calcularFichaTecnica(
        item({ cantidadUnidades: 0 }),
        [componente({ cantidad: 1, unidadMedida: GRAMO, modoExpresion: "TOTAL", orden: 0 })],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V9");
    }
  });

  it("V9 -- cantidadUnidades not an integer", () => {
    try {
      calcularFichaTecnica(
        item({ cantidadUnidades: 1.5 }),
        [componente({ cantidad: 1, unidadMedida: GRAMO, modoExpresion: "TOTAL", orden: 0 })],
        SIN_EXCESO,
        UNIDADES_BASE,
      );
      expect.unreachable();
    } catch (e) {
      expect((e as FichaTecnicaValidationError).validationCode).toBe("V9");
    }
  });
});

describe("calcularFichaTecnica -- R3/R7/R8 interplay", () => {
  it("R3 subtracts the UNROUNDED teorica of the active, never its rounded cantidadAPesar", () => {
    const lineas = calcularFichaTecnica(
      item({ formaFarmaceutica: "CREMA", cantidadTotal: 20, unidadTotal: GRAMO }),
      [
        componente({ drogaId: "activo", cantidad: 3.0005, unidadMedida: GRAMO, modoExpresion: "TOTAL", esPrincipioActivo: true, orden: 0 }),
        componente({ drogaId: "excipiente", unidadMedida: GRAMO, modoExpresion: "CSP", orden: 1 }),
      ],
      { precisionBalanza: 0.01, excesoPesadaPorcentaje: 10 },
      UNIDADES_BASE,
    );

    const activo = lineas.find((l) => l.drogaId === "activo")!;
    const excipiente = lineas.find((l) => l.drogaId === "excipiente")!;

    // Activo: teorica 3.0005, con exceso 3.30055, a pesar (redondeo 0.01) 3.30
    // -- rounding visibly changes the weighed value vs. the theoretical one.
    expect(activo.cantidadTeorica!.toString()).toBe("3.0005");
    expect(activo.cantidadAPesar!.toString()).toBe("3.3");

    // Excipiente CSP must use 3.0005 (teorica), NOT 3.30 (cantidadAPesar):
    // 20 - 3.0005 = 16.9995 -- not 20 - 3.30 = 16.70.
    expect(excipiente.cantidadTeorica!.toString()).toBe("16.9995");
    expect(dec(excipiente.cantidadTeorica!).equals(dec("16.70"))).toBe(false);
    // con exceso: 16.9995 * 1.10 = 18.69945 -> redondeado a 0.01 -> 18.70
    expect(excipiente.cantidadAPesar!.toString()).toBe("18.7");
  });

  it("non-MASA non-manual lines are NOT rounded to precisionBalanza (pending confirmation, see module doc comment)", () => {
    const lineas = calcularFichaTecnica(
      item({ formaFarmaceutica: "JARABE", cantidadTotal: null, unidadTotal: null }),
      [componente({ cantidad: 10.123456, unidadMedida: MILILITRO, modoExpresion: "TOTAL", orden: 0 })],
      { precisionBalanza: 0.01, excesoPesadaPorcentaje: 0 },
      UNIDADES_BASE,
    );

    expect(lineas[0]!.cantidadAPesar!.toString()).toBe("10.123456");
  });
});

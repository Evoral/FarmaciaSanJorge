/**
 * Unit tests for V12 -- cordura de concentraciones (modules/recetas/domain/receta.ts,
 * openspec/specs/ficha-tecnica/spec.md "V12").
 *
 * Catches absurd concentration prescriptions where the active quantity yields more
 * than the whole preparado (e.g. 2,3 mL/mg in a 30 g cream yields 69.000 mL).
 */
import { describe, it, expect } from "vitest";
import {
  ReglaRecetaError,
  validarCorduraConcentraciones,
  type ComponenteInput,
  type ItemInput,
  type UnidadParaCordura,
} from "@/modules/recetas/domain/receta";

const UNIDAD_G = "u-g";
const UNIDAD_MG = "u-mg";
const UNIDAD_ML = "u-ml";

const UNIDADES = new Map<string, UnidadParaCordura>([
  [UNIDAD_G, { tipoMagnitud: "MASA", factorABase: "1", simbolo: "g" }],
  [UNIDAD_MG, { tipoMagnitud: "MASA", factorABase: "0.001", simbolo: "mg" }],
  [UNIDAD_ML, { tipoMagnitud: "VOLUMEN", factorABase: "1", simbolo: "mL" }],
]);

function crearItem(
  overrides: Partial<ItemInput> = {},
  componentes: ComponenteInput[] = [],
): ItemInput {
  return {
    descripcion: "Crema",
    formaFarmaceutica: "CREMA",
    cantidadUnidades: 1,
    fraccionDosisPorUnidad: "1",
    cantidadTotal: "30",
    unidadTotalId: UNIDAD_G,
    observaciones: null,
    componentes,
    ...overrides,
  };
}

describe("V12 -- cordura de concentraciones (validarCorduraConcentraciones)", () => {
  it("crema 30 g, Aceite de cade 2,3 mL por mg throws V12 with exact formatted message", () => {
    const items = [
      crearItem({}, [
        {
          drogaId: "droga-aceite-cade",
          cantidad: "2.3",
          unidadMedidaId: UNIDAD_ML,
          unidadReferenciaId: UNIDAD_MG,
          modoExpresion: "CONCENTRACION",
        },
      ]),
    ];

    expect(() => validarCorduraConcentraciones(items, UNIDADES)).toThrow(
      new ReglaRecetaError(
        "V12",
        "En el ítem 1, el componente 1 (2,3 mL/mg × 30 g) da 69.000 mL: más que todo el preparado. Revisá el valor y el «por».",
      ),
    );
  });

  it("same crema at 2,3 % does not throw", () => {
    const items = [
      crearItem({}, [
        {
          drogaId: "droga-aceite-cade",
          cantidad: "2.3",
          unidadMedidaId: UNIDAD_ML,
          unidadReferenciaId: null,
          modoExpresion: "CONCENTRACION",
        },
      ]),
    ];

    expect(() => validarCorduraConcentraciones(items, UNIDADES)).not.toThrow();
  });

  it("quantity yielding exactly equal to the total does not throw (strictly greater throws)", () => {
    // 100 % of 30 g = 30 g -> equal, not greater
    const itemsPorcentaje = [
      crearItem({ cantidadTotal: "30", unidadTotalId: UNIDAD_G }, [
        {
          drogaId: "droga-x",
          cantidad: "100",
          unidadMedidaId: UNIDAD_G,
          unidadReferenciaId: null,
          modoExpresion: "CONCENTRACION",
        },
      ]),
    ];
    expect(() => validarCorduraConcentraciones(itemsPorcentaje, UNIDADES)).not.toThrow();

    // 1 g/g * 30 g = 30 g -> equal
    const itemsReferencia = [
      crearItem({ cantidadTotal: "30", unidadTotalId: UNIDAD_G }, [
        {
          drogaId: "droga-x",
          cantidad: "1",
          unidadMedidaId: UNIDAD_G,
          unidadReferenciaId: UNIDAD_G,
          modoExpresion: "CONCENTRACION",
        },
      ]),
    ];
    expect(() => validarCorduraConcentraciones(itemsReferencia, UNIDADES)).not.toThrow();
  });

  describe("skipped cases do not throw", () => {
    it("skips when unidadTotalId is null", () => {
      const items = [
        crearItem({ unidadTotalId: null }, [
          {
            drogaId: "droga-x",
            cantidad: "2.3",
            unidadMedidaId: UNIDAD_ML,
            unidadReferenciaId: UNIDAD_MG,
            modoExpresion: "CONCENTRACION",
          },
        ]),
      ];
      expect(() => validarCorduraConcentraciones(items, UNIDADES)).not.toThrow();
    });

    it("skips when cantidadTotal is null", () => {
      const items = [
        crearItem({ cantidadTotal: null }, [
          {
            drogaId: "droga-x",
            cantidad: "2.3",
            unidadMedidaId: UNIDAD_ML,
            unidadReferenciaId: UNIDAD_MG,
            modoExpresion: "CONCENTRACION",
          },
        ]),
      ];
      expect(() => validarCorduraConcentraciones(items, UNIDADES)).not.toThrow();
    });

    it("skips when modoExpresion is not CONCENTRACION", () => {
      const items = [
        crearItem({}, [
          {
            drogaId: "droga-x",
            cantidad: "2.3",
            unidadMedidaId: UNIDAD_ML,
            unidadReferenciaId: UNIDAD_MG,
            modoExpresion: "TOTAL",
          },
        ]),
      ];
      expect(() => validarCorduraConcentraciones(items, UNIDADES)).not.toThrow();
    });

    it("skips when componente cantidad is null", () => {
      const items = [
        crearItem({}, [
          {
            drogaId: "droga-x",
            cantidad: null,
            unidadMedidaId: UNIDAD_ML,
            unidadReferenciaId: UNIDAD_MG,
            modoExpresion: "CONCENTRACION",
          },
        ]),
      ];
      expect(() => validarCorduraConcentraciones(items, UNIDADES)).not.toThrow();
    });

    it("skips when unidadTotalId is unknown", () => {
      const items = [
        crearItem({ unidadTotalId: "u-desconocida" }, [
          {
            drogaId: "droga-x",
            cantidad: "2.3",
            unidadMedidaId: UNIDAD_ML,
            unidadReferenciaId: UNIDAD_MG,
            modoExpresion: "CONCENTRACION",
          },
        ]),
      ];
      expect(() => validarCorduraConcentraciones(items, UNIDADES)).not.toThrow();
    });

    it("skips when unidadMedidaId is unknown", () => {
      const items = [
        crearItem({}, [
          {
            drogaId: "droga-x",
            cantidad: "2.3",
            unidadMedidaId: "u-desconocida",
            unidadReferenciaId: UNIDAD_MG,
            modoExpresion: "CONCENTRACION",
          },
        ]),
      ];
      expect(() => validarCorduraConcentraciones(items, UNIDADES)).not.toThrow();
    });

    it("skips when unidadReferenciaId is unknown", () => {
      const items = [
        crearItem({}, [
          {
            drogaId: "droga-x",
            cantidad: "2.3",
            unidadMedidaId: UNIDAD_ML,
            unidadReferenciaId: "u-desconocida",
            modoExpresion: "CONCENTRACION",
          },
        ]),
      ];
      expect(() => validarCorduraConcentraciones(items, UNIDADES)).not.toThrow();
    });
  });

  it("reports 'ítem 2' and 'componente 2' when the second item / second componente fails", () => {
    const item1 = crearItem({}, [
      {
        drogaId: "droga-ok",
        cantidad: "1",
        unidadMedidaId: UNIDAD_G,
        unidadReferenciaId: null,
        modoExpresion: "CONCENTRACION",
      },
    ]);

    const item2 = crearItem({ descripcion: "Segunda crema" }, [
      {
        drogaId: "droga-comp1-ok",
        cantidad: "1",
        unidadMedidaId: UNIDAD_G,
        unidadReferenciaId: null,
        modoExpresion: "CONCENTRACION",
      },
      {
        drogaId: "droga-comp2-bad",
        cantidad: "2.3",
        unidadMedidaId: UNIDAD_ML,
        unidadReferenciaId: UNIDAD_MG,
        modoExpresion: "CONCENTRACION",
      },
    ]);

    expect(() => validarCorduraConcentraciones([item1, item2], UNIDADES)).toThrow(
      new ReglaRecetaError(
        "V12",
        "En el ítem 2, el componente 2 (2,3 mL/mg × 30 g) da 69.000 mL: más que todo el preparado. Revisá el valor y el «por».",
      ),
    );
  });
});

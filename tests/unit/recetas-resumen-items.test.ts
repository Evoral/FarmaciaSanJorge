import { describe, it, expect } from "vitest";
import { resumirItemsReceta, type ItemInput } from "@/modules/recetas/domain/receta";

const nombres = {
  drogas: new Map([
    ["d-ibu", "Ibuprofeno"],
    ["d-lac", "Lactosa"],
    ["d-urea", "Urea"],
    ["d-base", "Crema base"],
  ]),
  unidades: new Map([
    ["u-mg", "mg"],
    ["u-g", "g"],
  ]),
};

function item(overrides: Partial<ItemInput>): ItemInput {
  return {
    formaFarmaceutica: "CAPSULA",
    cantidadUnidades: 30,
    fraccionDosisPorUnidad: "1",
    cantidadTotal: null,
    unidadTotalId: null,
    componentes: [],
    ...overrides,
  };
}

describe("resumirItemsReceta (readable audit summary)", () => {
  it("summarizes a capsule item: per-dose component + c.s.p. excipient", () => {
    const resumen = resumirItemsReceta(
      [
        item({
          componentes: [
            { drogaId: "d-ibu", cantidad: "200", unidadMedidaId: "u-mg", modoExpresion: "POR_DOSIS" },
            { drogaId: "d-lac", cantidad: null, unidadMedidaId: "u-mg", modoExpresion: "CSP" },
          ],
        }),
      ],
      nombres,
    );
    expect(resumen).toEqual(["Cápsula ×30: Ibuprofeno 200 mg por dosis + Lactosa c.s.p."]);
  });

  it("uses the description when given, and the item's c.s.p. total", () => {
    const resumen = resumirItemsReceta(
      [
        item({
          descripcion: "Crema de urea",
          formaFarmaceutica: "CREMA",
          cantidadUnidades: 1,
          cantidadTotal: "100",
          unidadTotalId: "u-g",
          componentes: [
            { drogaId: "d-urea", cantidad: "10", unidadMedidaId: "u-g", modoExpresion: "TOTAL" },
            { drogaId: "d-base", cantidad: null, unidadMedidaId: "u-g", modoExpresion: "CS" },
          ],
        }),
      ],
      nombres,
    );
    expect(resumen).toEqual(["Crema de urea (Crema) ×1 c.s.p. 100 g: Urea 10 g + Crema base c.s."]);
  });

  it("never throws on an id it cannot resolve", () => {
    const resumen = resumirItemsReceta(
      [item({ componentes: [{ drogaId: "d-x", cantidad: "1", unidadMedidaId: "u-x", modoExpresion: "TOTAL" }] })],
      nombres,
    );
    expect(resumen).toEqual(["Cápsula ×30: droga desconocida 1"]);
  });
});

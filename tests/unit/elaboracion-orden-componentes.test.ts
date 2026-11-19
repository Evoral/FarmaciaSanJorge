import { describe, it, expect } from "vitest";
import { ordenarComponentes } from "@/modules/elaboracion/domain/orden-componentes";
import { calcularFichaTecnica, type UnidadMedidaRef } from "@/modules/elaboracion/domain/calcular-ficha-tecnica";

const GRAMO: UnidadMedidaRef = {
  id: "u-g",
  tipoMagnitud: "MASA",
  factorABase: "1",
  simbolo: "g",
};
const ML: UnidadMedidaRef = { id: "u-ml", tipoMagnitud: "VOLUMEN", factorABase: "1", simbolo: "mL" };
const UNIDAD: UnidadMedidaRef = { id: "u-u", tipoMagnitud: "UNIDADES", factorABase: "1", simbolo: "u" };

describe("ordenarComponentes (modules/elaboracion/domain/orden-componentes)", () => {
  it("sorts by posicion (load order) regardless of modoExpresion", () => {
    const input = [
      { drogaNombre: "Zinc óxido", modoExpresion: "TOTAL" as const, posicion: 2 },
      { drogaNombre: "Vaselina", modoExpresion: "CSP" as const, posicion: 0 },
      { drogaNombre: "Agua", modoExpresion: "CS" as const, posicion: 1 },
    ];

    expect(ordenarComponentes(input).map((c) => c.drogaNombre)).toEqual(["Vaselina", "Agua", "Zinc óxido"]);
  });

  it("keeps legacy rule (cantidad -> CS -> CSP -> name) when posicion is null or omitted", () => {
    const input = [
      { drogaNombre: "Vaselina", modoExpresion: "CSP" as const, posicion: null },
      { drogaNombre: "Zeta", modoExpresion: "CS" as const, posicion: null },
      { drogaNombre: "Alfa", modoExpresion: "CS" as const },
      { drogaNombre: "Ácido salicílico", modoExpresion: "POR_DOSIS" as const, posicion: null },
      { drogaNombre: "Beta", modoExpresion: "CONCENTRACION" as const },
      { drogaNombre: "alcanfor", modoExpresion: "TOTAL" as const, posicion: null },
    ];

    expect(ordenarComponentes(input).map((c) => c.drogaNombre)).toEqual([
      "Ácido salicílico",
      "alcanfor",
      "Beta",
      "Alfa",
      "Zeta",
      "Vaselina",
    ]);
  });

  it("handles mixed cases where some rows have posicion and others do not", () => {
    const input = [
      { drogaNombre: "Zeta", modoExpresion: "TOTAL" as const, posicion: 0 },
      { drogaNombre: "Alfa", modoExpresion: "TOTAL" as const, posicion: 1 },
      { drogaNombre: "Legacy", modoExpresion: "CS" as const, posicion: null },
    ];

    const result = ordenarComponentes(input);
    expect(result.map((c) => c.drogaNombre)).toEqual(["Zeta", "Alfa", "Legacy"]);
  });
});

describe("calcularFichaTecnica -- CSP always last (07ebae6)", () => {
  it("keeps non-CSP componentes in load order (posicion) and puts CSP last as enrase", () => {
    const lineas = calcularFichaTecnica(
      {
        formaFarmaceutica: "CREMA",
        cantidadTotal: "100",
        unidadTotal: GRAMO,
        cantidadUnidades: 1,
        fraccionDosisPorUnidad: "1",
      },
      [
        { drogaId: "d-csp", drogaNombre: "Crema base", cantidad: null, unidadMedida: GRAMO, modoExpresion: "CSP", posicion: 0 },
        { drogaId: "d-z", drogaNombre: "Zinc óxido", cantidad: "5", unidadMedida: GRAMO, modoExpresion: "TOTAL", posicion: 1 },
        { drogaId: "d-a", drogaNombre: "Alcanfor", cantidad: "1", unidadMedida: GRAMO, modoExpresion: "TOTAL", posicion: 2 },
      ],
      { excesoPesadaPorcentaje: "0" },
      { MASA: GRAMO, VOLUMEN: ML, UNIDADES: UNIDAD },
    );

    expect(lineas.map((l) => ({ nombre: l.drogaNombre, orden: l.orden }))).toEqual([
      { nombre: "Zinc óxido", orden: 0 },
      { nombre: "Alcanfor", orden: 1 },
      { nombre: "Crema base", orden: 2 },
    ]);
  });
});

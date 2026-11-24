/**
 * Unit tests for U.I. validation in recetas (openspec/changes/unidad-internacional, UI3 / task 3.1).
 */
import { describe, it, expect } from "vitest";
import { ValidationError } from "@/shared/errors";
import {
  ReglaRecetaError,
  validarComponentesUi,
  validarConcentracionesReceta,
  validarCorduraConcentraciones,
  type ItemInput,
  type UnidadParaCordura,
} from "@/modules/recetas/domain/receta";
import { crearRecetaInput } from "@/modules/recetas/application/crear-receta";

const DROGA_UI_ID = "11111111-1111-4111-8111-111111111111";
const DROGA_MASA_ID = "22222222-2222-4222-8222-222222222222";
const UNIDAD_UI_ID = "33333333-3333-4333-8333-333333333333";
const UNIDAD_G_ID = "44444444-4444-4444-8444-444444444444";
const PACIENTE_ID = "55555555-5555-4555-8555-555555555555";
const MEDICO_ID = "66666666-6666-4666-8666-666666666666";

const MAGNITUDES = new Map<string, string>([
  [UNIDAD_UI_ID, "ACTIVIDAD"],
  [UNIDAD_G_ID, "MASA"],
]);

const UNIDADES_CORDURA = new Map<string, UnidadParaCordura>([
  [UNIDAD_UI_ID, { tipoMagnitud: "ACTIVIDAD", factorABase: "1", simbolo: "U.I." }],
  [UNIDAD_G_ID, { tipoMagnitud: "MASA", factorABase: "1", simbolo: "g" }],
]);

const DROGAS = new Map([
  [DROGA_UI_ID, { nombre: "Vitamina D3", seDosificaEnUi: true }],
  [DROGA_MASA_ID, { nombre: "Ácido ascórbico", seDosificaEnUi: false }],
]);

function cremaItem(componentes: ItemInput["componentes"]): ItemInput {
  return {
    formaFarmaceutica: "CREMA",
    cantidadUnidades: 1,
    fraccionDosisPorUnidad: "1",
    cantidadTotal: "50",
    unidadTotalId: UNIDAD_G_ID,
    componentes,
  };
}

describe("recetas U.I. validation (UI3)", () => {
  it("allows U.I. in TOTAL, POR_DOSIS, and CONCENTRACION with referencia for a marked droga", () => {
    const items: ItemInput[] = [
      {
        formaFarmaceutica: "CAPSULA",
        cantidadUnidades: 30,
        fraccionDosisPorUnidad: "1",
        cantidadTotal: null,
        unidadTotalId: null,
        componentes: [
          { drogaId: DROGA_UI_ID, cantidad: "50000", unidadMedidaId: UNIDAD_UI_ID, modoExpresion: "POR_DOSIS" },
        ],
      },
      cremaItem([
        {
          drogaId: DROGA_UI_ID,
          cantidad: "10000",
          unidadMedidaId: UNIDAD_UI_ID,
          modoExpresion: "CONCENTRACION",
          unidadReferenciaId: UNIDAD_G_ID,
        },
        { drogaId: DROGA_MASA_ID, cantidad: null, unidadMedidaId: UNIDAD_G_ID, modoExpresion: "CSP" },
      ]),
    ];

    expect(() => validarComponentesUi(items, MAGNITUDES, DROGAS)).not.toThrow();
    expect(() => validarConcentracionesReceta(items, MAGNITUDES)).not.toThrow();
    // 10.000 U.I./g * 50 g = 500.000 U.I. must NOT trigger V12 sanity check against 50 g
    expect(() => validarCorduraConcentraciones(items, UNIDADES_CORDURA)).not.toThrow();
  });

  it("refuses U.I. for an unmarked droga and points to the offending componente field", () => {
    const items = [
      cremaItem([{ drogaId: DROGA_MASA_ID, cantidad: "1000", unidadMedidaId: UNIDAD_UI_ID, modoExpresion: "TOTAL" }]),
    ];

    expect(() => validarComponentesUi(items, MAGNITUDES, DROGAS)).toThrowError(
      expect.objectContaining({
        constructor: ValidationError,
        fields: ["item-0-comp-0-unidad"],
      }),
    );
  });

  it("refuses U.I. in CS and CSP", () => {
    for (const modoExpresion of ["CS", "CSP"] as const) {
      const items = [
        cremaItem([{ drogaId: DROGA_UI_ID, cantidad: null, unidadMedidaId: UNIDAD_UI_ID, modoExpresion }]),
      ];
      expect(() => validarComponentesUi(items, MAGNITUDES, DROGAS)).toThrowError(
        expect.objectContaining({
          constructor: ValidationError,
          fields: ["item-0-comp-0-unidad"],
        }),
      );
    }
  });

  it("refuses U.I. as a percentage (CONCENTRACION without referencia)", () => {
    const items = [
      cremaItem([
        {
          drogaId: DROGA_UI_ID,
          cantidad: "5",
          unidadMedidaId: UNIDAD_UI_ID,
          modoExpresion: "CONCENTRACION",
          unidadReferenciaId: null,
        },
      ]),
    ];

    expect(() => validarConcentracionesReceta(items, MAGNITUDES)).toThrowError(
      expect.objectContaining({
        regla: "V11",
        fields: ["item-0-comp-0-unidad"],
      }),
    );
    expect(() => validarComponentesUi(items, MAGNITUDES, DROGAS)).toThrowError(ReglaRecetaError);
  });

  it("crearRecetaInput zod schema rejects CS/CSP with cantidad or unidadReferenciaId", () => {
    const parsed = crearRecetaInput.safeParse({
      pacienteId: PACIENTE_ID,
      medicoId: MEDICO_ID,
      fechaPrescripcion: "2026-11-24",
      origen: "PRESENCIAL",
      items: [
        {
          formaFarmaceutica: "CREMA",
          cantidadUnidades: 1,
          fraccionDosisPorUnidad: "1",
          cantidadTotal: "50",
          unidadTotalId: UNIDAD_G_ID,
          componentes: [
            {
              drogaId: DROGA_UI_ID,
              cantidad: "10",
              unidadMedidaId: UNIDAD_UI_ID,
              modoExpresion: "CSP",
            },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

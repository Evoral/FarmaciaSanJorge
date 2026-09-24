/**
 * Unit tests for `modules/cierres/domain/pendientes.ts` (DP-18d RESUELTA,
 * FASE 10 point 10.1). Pure -- no mocks needed.
 */
import { describe, it, expect } from "vitest";
import { requiereFirma, filtrarJornadasQueRequierenFirma } from "@/modules/cierres/domain/pendientes";

describe("requiereFirma (DP-18d)", () => {
  it("a jornada with recetario asientos requires firma", () => {
    expect(requiereFirma({ fecha: "2026-06-15", cantidadRecetario: 1, cantidadContralor: 0 })).toBe(true);
  });

  it("a jornada with ONLY contralor asientos also requires firma", () => {
    expect(requiereFirma({ fecha: "2026-06-15", cantidadRecetario: 0, cantidadContralor: 1 })).toBe(true);
  });

  it("a jornada with NO asientos at all does not require firma", () => {
    expect(requiereFirma({ fecha: "2026-06-15", cantidadRecetario: 0, cantidadContralor: 0 })).toBe(false);
  });
});

describe("filtrarJornadasQueRequierenFirma", () => {
  it("drops empty jornadas while preserving order of the rest", () => {
    const jornadas = [
      { fecha: "2026-06-14", cantidadRecetario: 0, cantidadContralor: 0 },
      { fecha: "2026-06-15", cantidadRecetario: 2, cantidadContralor: 0 },
      { fecha: "2026-06-16", cantidadRecetario: 0, cantidadContralor: 1 },
    ];
    expect(filtrarJornadasQueRequierenFirma(jornadas)).toEqual([
      { fecha: "2026-06-15", cantidadRecetario: 2, cantidadContralor: 0 },
      { fecha: "2026-06-16", cantidadRecetario: 0, cantidadContralor: 1 },
    ]);
  });

  it("returns an empty array when every jornada is empty", () => {
    expect(filtrarJornadasQueRequierenFirma([{ fecha: "2026-06-14", cantidadRecetario: 0, cantidadContralor: 0 }])).toEqual([]);
  });
});

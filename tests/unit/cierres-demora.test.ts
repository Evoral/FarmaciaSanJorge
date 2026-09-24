/**
 * Unit tests for `modules/cierres/domain/demora.ts` (FASE 10, M13a points
 * 10.1/10.3/10.4). Pure date arithmetic -- no mocks needed.
 */
import { describe, it, expect } from "vitest";
import { addDiasIso, diasEntreIso, calcularFueraDeTermino, calcularAntiguedadDias, calcularDemoraDias } from "@/modules/cierres/domain/demora";

describe("addDiasIso", () => {
  it("adds days within the same month", () => {
    expect(addDiasIso("2026-06-15", 3)).toBe("2026-06-18");
  });

  it("adds days across a month boundary", () => {
    expect(addDiasIso("2026-06-30", 1)).toBe("2026-07-01");
  });

  it("adds days across a year boundary", () => {
    expect(addDiasIso("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("supports zero and negative offsets", () => {
    expect(addDiasIso("2026-06-15", 0)).toBe("2026-06-15");
    expect(addDiasIso("2026-06-15", -1)).toBe("2026-06-14");
  });
});

describe("diasEntreIso", () => {
  it("returns 0 for the same date", () => {
    expect(diasEntreIso("2026-06-15", "2026-06-15")).toBe(0);
  });

  it("returns a positive count when hasta is later", () => {
    expect(diasEntreIso("2026-06-15", "2026-06-20")).toBe(5);
  });

  it("returns a negative count when hasta is earlier", () => {
    expect(diasEntreIso("2026-06-20", "2026-06-15")).toBe(-5);
  });
});

describe("calcularFueraDeTermino (mirrors fsj.cierre_diario_calcular_fuera_de_termino, migration 0038)", () => {
  it("plazoFirmaDias = 0: signing the SAME jornada is on time", () => {
    expect(calcularFueraDeTermino({ jornadaActual: "2026-06-15", fecha: "2026-06-15", plazoFirmaDias: 0 })).toBe(false);
  });

  it("plazoFirmaDias = 0: signing a PAST jornada is out of term", () => {
    expect(calcularFueraDeTermino({ jornadaActual: "2026-06-16", fecha: "2026-06-15", plazoFirmaDias: 0 })).toBe(true);
  });

  it("plazoFirmaDias = 2: signing 2 days later is still on time", () => {
    expect(calcularFueraDeTermino({ jornadaActual: "2026-06-17", fecha: "2026-06-15", plazoFirmaDias: 2 })).toBe(false);
  });

  it("plazoFirmaDias = 2: signing 3 days later is out of term", () => {
    expect(calcularFueraDeTermino({ jornadaActual: "2026-06-18", fecha: "2026-06-15", plazoFirmaDias: 2 })).toBe(true);
  });
});

describe("calcularAntiguedadDias / calcularDemoraDias", () => {
  it("antiguedad is the number of days since the jornada", () => {
    expect(calcularAntiguedadDias("2026-06-15", "2026-06-18")).toBe(3);
  });

  it("demora is the gap between the jornada's date and the jornada it was actually signed on", () => {
    expect(calcularDemoraDias("2026-06-15", "2026-06-15")).toBe(0);
    expect(calcularDemoraDias("2026-06-15", "2026-06-18")).toBe(3);
  });
});

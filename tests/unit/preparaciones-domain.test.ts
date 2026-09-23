/**
 * Unit tests for `modules/preparaciones/domain/preparacion.ts` (FASE 8
 * points 8.2/8.3): manual-line quantity validation, INV-S15 deviation
 * detection, and INV-S18's motivo-required case. Pure functions, no DB, no
 * mocks -- tests/db covers what the database itself enforces.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "@/shared/decimal";
import { ValidationError } from "@/shared/errors";
import {
  validarCantidadManual,
  esDesvioPropuesta,
  requiereMotivoAperturaAdicional,
  formatearMedicoTexto,
  formatearPacienteTexto,
  formatearFormulaTexto,
  formatearContenidoEtiqueta,
} from "@/modules/preparaciones/domain/preparacion";
import type { PartidaConEstadoApertura } from "@/modules/preparaciones/domain/preparacion";

describe("validarCantidadManual", () => {
  it("accepts a positive finite quantity", () => {
    expect(() => validarCantidadManual(new Decimal("1.5"), 0)).not.toThrow();
  });

  it("rejects zero", () => {
    expect(() => validarCantidadManual(new Decimal(0), 2)).toThrow(ValidationError);
  });

  it("rejects a negative quantity", () => {
    expect(() => validarCantidadManual(new Decimal("-1"), 2)).toThrow(ValidationError);
  });

  it("mentions the 1-based línea number in the message", () => {
    try {
      validarCantidadManual(new Decimal(0), 2);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("línea 3");
    }
  });
});

describe("esDesvioPropuesta (INV-S15)", () => {
  it("is false when the chosen set equals the proposed set, same order", () => {
    expect(esDesvioPropuesta(["p1", "p2"], ["p1", "p2"])).toBe(false);
  });

  it("is false when the chosen set equals the proposed set, different order", () => {
    expect(esDesvioPropuesta(["p1", "p2"], ["p2", "p1"])).toBe(false);
  });

  it("is true when the farmacéutico picks a different partida", () => {
    expect(esDesvioPropuesta(["p1"], ["p2"])).toBe(true);
  });

  it("is true when the chosen set is a strict subset/superset of the proposal", () => {
    expect(esDesvioPropuesta(["p1", "p2"], ["p1"])).toBe(true);
    expect(esDesvioPropuesta(["p1"], ["p1", "p2"])).toBe(true);
  });
});

function partida(overrides: Partial<PartidaConEstadoApertura>): PartidaConEstadoApertura {
  return {
    id: "p1",
    cantidadDisponible: "100",
    fechaVencimiento: "2099-12-31",
    fechaApertura: null,
    elegida: false,
    ...overrides,
  };
}

describe("requiereMotivoAperturaAdicional (INV-S18)", () => {
  const JORNADA = "2026-06-15";

  it("is false when there is no already-open partida for the droga", () => {
    const partidas = [partida({ id: "p1", fechaApertura: null, elegida: true, cantidadDisponible: "50" })];
    expect(requiereMotivoAperturaAdicional(partidas, new Decimal(10), JORNADA)).toBe(false);
  });

  it("is false when the open partida alone does NOT cover the requirement (opening another was necessary)", () => {
    const partidas = [
      partida({ id: "abierta", fechaApertura: "2026-06-01T00:00:00Z", cantidadDisponible: "5", elegida: true }),
      partida({ id: "nueva", fechaApertura: null, cantidadDisponible: "50", elegida: true }),
    ];
    expect(requiereMotivoAperturaAdicional(partidas, new Decimal(20), JORNADA)).toBe(false);
  });

  it("is true when an already-open partida alone covers the requirement, but a NEW partida was also chosen", () => {
    const partidas = [
      partida({ id: "abierta", fechaApertura: "2026-06-01T00:00:00Z", cantidadDisponible: "50", elegida: true }),
      partida({ id: "nueva", fechaApertura: null, cantidadDisponible: "50", elegida: true }),
    ];
    expect(requiereMotivoAperturaAdicional(partidas, new Decimal(10), JORNADA)).toBe(true);
  });

  it("is false when only the already-open partida (sufficient) was chosen -- no new partida opened", () => {
    const partidas = [
      partida({ id: "abierta", fechaApertura: "2026-06-01T00:00:00Z", cantidadDisponible: "50", elegida: true }),
      partida({ id: "otra-cerrada", fechaApertura: null, cantidadDisponible: "50", elegida: false }),
    ];
    expect(requiereMotivoAperturaAdicional(partidas, new Decimal(10), JORNADA)).toBe(false);
  });

  it("ignores an already-open partida that is EXPIRED when checking sufficiency", () => {
    const partidas = [
      partida({ id: "abierta-vencida", fechaApertura: "2026-06-01T00:00:00Z", cantidadDisponible: "50", fechaVencimiento: "2026-01-01", elegida: false }),
      partida({ id: "nueva", fechaApertura: null, cantidadDisponible: "50", elegida: true }),
    ];
    expect(requiereMotivoAperturaAdicional(partidas, new Decimal(10), JORNADA)).toBe(false);
  });
});

describe("snapshot text formatters (INV-L05)", () => {
  it("formatearMedicoTexto includes apellido, nombre and matrícula", () => {
    expect(formatearMedicoTexto("Ana", "Gómez", "MAT-123")).toBe("Gómez, Ana — matrícula MAT-123");
  });

  it("formatearPacienteTexto is apellido, nombre", () => {
    expect(formatearPacienteTexto("Juan", "Pérez")).toBe("Pérez, Juan");
  });

  it("formatearFormulaTexto joins every línea, marking enrase manual", () => {
    const texto = formatearFormulaTexto([
      { drogaNombre: "Ácido salicílico", cantidad: "3", unidadSimbolo: "g", esEnraseManual: false },
      { drogaNombre: "Vaselina", cantidad: "27", unidadSimbolo: "g", esEnraseManual: true },
    ]);
    expect(texto).toBe("Ácido salicílico: 3 g; Vaselina: 27 g (enrase manual)");
  });
});

describe("formatearContenidoEtiqueta", () => {
  it("includes every field and the asiento number when present", () => {
    const contenido = formatearContenidoEtiqueta({
      itemDescripcion: "Crema x 30g",
      formaFarmaceutica: "CREMA",
      cantidadUnidades: 1,
      pacienteTexto: "Pérez, Juan",
      medicoTexto: "Gómez, Ana — matrícula MAT-123",
      formulaTexto: "Ácido salicílico: 3 g",
      preparadaPorNombre: "Lucía",
      preparadaPorApellido: "Farmacéutica",
      confirmadaEn: new Date("2026-06-15T12:00:00Z"),
      asientoNumeroCorrelativo: "42",
    });
    expect(contenido).toContain("Crema x 30g");
    expect(contenido).toContain("Pérez, Juan");
    expect(contenido).toContain("Asiento libro recetario Nº 42");
  });

  it("omits the asiento line when there is none", () => {
    const contenido = formatearContenidoEtiqueta({
      itemDescripcion: null,
      formaFarmaceutica: "CREMA",
      cantidadUnidades: 1,
      pacienteTexto: "Pérez, Juan",
      medicoTexto: "Gómez, Ana — matrícula MAT-123",
      formulaTexto: "x",
      preparadaPorNombre: "Lucía",
      preparadaPorApellido: "Farmacéutica",
      confirmadaEn: new Date("2026-06-15T12:00:00Z"),
      asientoNumeroCorrelativo: null,
    });
    expect(contenido).not.toContain("Asiento libro recetario");
  });
});

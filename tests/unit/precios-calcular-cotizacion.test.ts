/**
 * Unit tests for `modules/precios/domain/calcular-cotizacion.ts` (M10,
 * FASE 7 point 7.4, DP-09 RESUELTA). Pure function, no DB. Each test is
 * designed to FAIL without its guard -- see the task instruction this
 * module was built against.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { calcularCotizacion } from "@/modules/precios/domain/calcular-cotizacion";
import type { LineaCosteoInput, PartidaCosteo } from "@/modules/precios/domain/calcular-cotizacion";

const HOY = "2026-06-15";

function linea(overrides: Partial<LineaCosteoInput>): LineaCosteoInput {
  return {
    drogaId: "droga-1",
    drogaNombre: "Droga 1",
    unidadSimbolo: "g",
    cantidadAPesar: "10",
    esEnraseManual: false,
    orden: 0,
    ...overrides,
  };
}

function partida(overrides: Partial<PartidaCosteo>): PartidaCosteo {
  return {
    id: "P1",
    cantidadDisponible: "100",
    fechaVencimiento: "2026-12-31",
    fechaApertura: null,
    costoUnitario: "5",
    ...overrides,
  };
}

describe("calcularCotizacion", () => {
  it("costs a single non-manual linea fully covered by one partida, and adds the margen on top (DP-09)", () => {
    const lineas = [linea({ cantidadAPesar: "10" })];
    const partidas = { "droga-1": [partida({ costoUnitario: "5" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, "200");

    expect(resultado.costoInsumos.toString()).toBe("50"); // 10 * 5
    expect(resultado.margenAplicado.toString()).toBe("200");
    expect(resultado.precioFinal.toString()).toBe("150"); // 50 + 200% of 50
    expect(resultado.esParcial).toBe(false);
    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.detalle.lineas).toHaveLength(1);
    expect(resultado.detalle.lineas[0].partidas).toEqual([{ partidaId: "P1", cantidad: "10", costoUnitario: "5", subtotal: "50" }]);
  });

  it("margen 0: precioFinal equals costoInsumos -- selling at cost (DP-09)", () => {
    const lineas = [linea({ cantidadAPesar: "10" })];
    const partidas = { "droga-1": [partida({ costoUnitario: "5" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, "0");

    expect(resultado.costoInsumos.toString()).toBe("50");
    expect(resultado.precioFinal.toString()).toBe("50");
  });

  it("a manual-enrase linea contributes ZERO to costoInsumos and marks the cotizacion esParcial -- never invents a quantity", () => {
    const lineas = [
      linea({ orden: 0, drogaId: "activo", cantidadAPesar: "3", esEnraseManual: false }),
      linea({ orden: 1, drogaId: "excipiente", cantidadAPesar: null, esEnraseManual: true }),
    ];
    const partidas = { activo: [partida({ id: "PA", costoUnitario: "10" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, "150");

    expect(resultado.costoInsumos.toString()).toBe("30"); // only the active line: 3 * 10
    expect(resultado.esParcial).toBe(true);
    expect(resultado.esIncompleta).toBe(false);
    const manualDetalle = resultado.detalle.lineas.find((l) => l.drogaId === "excipiente")!;
    expect(manualDetalle.esEnraseManual).toBe(true);
    expect(manualDetalle.cantidadRequerida).toBeNull();
    expect(manualDetalle.subtotal).toBe("0");
    expect(manualDetalle.partidas).toEqual([]);
  });

  it("insufficient stock: costs what EXISTS (does not fail), flags esIncompleta, and records the exact faltante", () => {
    const lineas = [linea({ cantidadAPesar: "10" })];
    // Only 4 available, 10 requested.
    const partidas = { "droga-1": [partida({ id: "P1", cantidadDisponible: "4", costoUnitario: "5" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, "100");

    expect(resultado.esIncompleta).toBe(true);
    expect(resultado.costoInsumos.toString()).toBe("20"); // 4 * 5 -- cost what exists
    const detalle = resultado.detalle.lineas[0];
    expect(detalle.faltante).toBe("6");
    expect(detalle.partidas).toEqual([{ partidaId: "P1", cantidad: "4", costoUnitario: "5", subtotal: "20" }]);
    expect(resultado.precioFinal.toString()).toBe("40"); // 20 + 100% of 20
  });

  it("insufficient stock with ZERO eligible partidas (droga with no stock at all): costoInsumos 0 for that linea, faltante = full requested quantity", () => {
    const lineas = [linea({ cantidadAPesar: "7" })];

    const resultado = calcularCotizacion(lineas, () => [], HOY, "100");

    expect(resultado.esIncompleta).toBe(true);
    expect(resultado.costoInsumos.toString()).toBe("0");
    expect(resultado.detalle.lineas[0].faltante).toBe("7");
    expect(resultado.detalle.lineas[0].partidas).toEqual([]);
  });

  it("expired partidas are never costed (same INV-S10 eligibility as modules/stock/domain/reparto.ts)", () => {
    const lineas = [linea({ cantidadAPesar: "10" })];
    const partidas = {
      "droga-1": [
        partida({ id: "VENCIDA", cantidadDisponible: "100", fechaVencimiento: "2026-01-01", costoUnitario: "1" }),
        partida({ id: "VIGENTE", cantidadDisponible: "10", fechaVencimiento: "2026-12-31", costoUnitario: "9" }),
      ],
    };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, "100");

    expect(resultado.esIncompleta).toBe(false);
    expect(resultado.detalle.lineas[0].partidas).toEqual([{ partidaId: "VIGENTE", cantidad: "10", costoUnitario: "9", subtotal: "90" }]);
    expect(resultado.costoInsumos.toString()).toBe("90");
  });

  it("open partida consumed first, then FEFO for the rest -- exactly the order modules/stock/domain/reparto.ts#proponerReparto decides, reused (not reimplemented)", () => {
    const lineas = [linea({ cantidadAPesar: "20" })];
    const partidas = {
      "droga-1": [
        partida({ id: "ABIERTA", cantidadDisponible: "5", fechaVencimiento: "2027-01-01", fechaApertura: "2026-06-01T10:00:00Z", costoUnitario: "2" }),
        partida({ id: "CERRADA_TEMPRANA", cantidadDisponible: "100", fechaVencimiento: "2026-07-01", costoUnitario: "3" }),
        partida({ id: "CERRADA_TARDIA", cantidadDisponible: "100", fechaVencimiento: "2026-08-01", costoUnitario: "4" }),
      ],
    };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, "100");

    expect(resultado.detalle.lineas[0].partidas).toEqual([
      { partidaId: "ABIERTA", cantidad: "5", costoUnitario: "2", subtotal: "10" },
      { partidaId: "CERRADA_TEMPRANA", cantidad: "15", costoUnitario: "3", subtotal: "45" },
    ]);
    expect(resultado.costoInsumos.toString()).toBe("55"); // 10 + 45
  });

  it("multiple drogas: costoInsumos is the sum across every linea's own subtotal", () => {
    const lineas = [
      linea({ orden: 0, drogaId: "a", cantidadAPesar: "2" }),
      linea({ orden: 1, drogaId: "b", cantidadAPesar: "3" }),
    ];
    const partidas = {
      a: [partida({ id: "PA", costoUnitario: "10" })],
      b: [partida({ id: "PB", costoUnitario: "100" })],
    };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, "100");

    expect(resultado.costoInsumos.toString()).toBe("320"); // (2*10) + (3*100)
  });

  it("uses Decimal precision throughout -- never float (INV-PL-003)", () => {
    const lineas = [linea({ cantidadAPesar: "0.1" })];
    const partidas = { "droga-1": [partida({ costoUnitario: "0.2" })] };

    const resultado = calcularCotizacion(lineas, (id) => partidas[id as keyof typeof partidas] ?? [], HOY, "100");

    // 0.1 * 0.2 = 0.02 exactly under Decimal; float arithmetic would give 0.020000000000000004.
    expect(resultado.costoInsumos.equals(new Decimal("0.02"))).toBe(true);
    expect(resultado.costoInsumos.toString()).toBe("0.02");
  });
});

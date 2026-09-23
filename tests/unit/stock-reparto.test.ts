/**
 * Table-driven unit tests for `modules/stock/domain/reparto.ts` (FASE 5
 * point 5.6, INV-S13/S14/S16/S18/S19/S20). Pure function, no DB, no mocks
 * -- exhaustive per the task's required case list: one exact partida,
 * several partidas, an open partida plus the next, expired excluded,
 * insufficient stock, and a quantity equal to the exact total.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { proponerReparto } from "@/modules/stock/domain/reparto";
import type { PartidaDisponible } from "@/modules/stock/domain/reparto";

const HOY = "2026-06-15";

function partida(id: string, cantidadDisponible: string, fechaVencimiento: string, fechaApertura: string | null = null): PartidaDisponible {
  return { id, cantidadDisponible, fechaVencimiento, fechaApertura };
}

describe("proponerReparto", () => {
  it("one exact partida: a single closed partida covering exactly the requested quantity", () => {
    const partidas = [partida("P1", "50", "2026-12-31")];
    const result = proponerReparto(partidas, "50", HOY);
    expect(result).toEqual({ ok: true, lineas: [{ partidaId: "P1", cantidad: new Decimal("50") }] });
  });

  it("several partidas: FEFO order (earliest fechaVencimiento first) when none is open", () => {
    const partidas = [
      partida("LATE", "30", "2027-01-01"),
      partida("EARLY", "10", "2026-07-01"),
      partida("MID", "30", "2026-09-01"),
    ];
    const result = proponerReparto(partidas, "35", HOY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineas).toEqual([
        { partidaId: "EARLY", cantidad: new Decimal("10") }, // fully consumed (not the last line)
        { partidaId: "MID", cantidad: new Decimal("25") }, // last line, partially consumed (30 available, 25 taken)
      ]);
    }
  });

  it("an open partida plus the next: the ABIERTA partida is consumed FIRST (even if it expires later than a closed one), then FEFO covers the rest", () => {
    const partidas = [
      partida("ABIERTA", "5", "2027-01-01", "2026-06-01T10:00:00Z"),
      partida("CERRADA_TEMPRANA", "100", "2026-07-01"),
      partida("CERRADA_TARDIA", "100", "2026-08-01"),
    ];
    const result = proponerReparto(partidas, "20", HOY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineas).toEqual([
        { partidaId: "ABIERTA", cantidad: new Decimal("5") }, // fully consumed, first
        { partidaId: "CERRADA_TEMPRANA", cantidad: new Decimal("15") }, // FEFO among the rest
      ]);
    }
  });

  it("expired excluded: a partida with fechaVencimiento before jornadaActual is NEVER proposed, even if it has balance", () => {
    const partidas = [partida("VENCIDA", "100", "2026-06-14"), partida("VIGENTE", "40", "2026-12-31")];
    const result = proponerReparto(partidas, "40", HOY);
    expect(result).toEqual({ ok: true, lineas: [{ partidaId: "VIGENTE", cantidad: new Decimal("40") }] });
  });

  it("a partida expiring exactly TODAY (fechaVencimiento === jornadaActual) is still eligible (not yet expired)", () => {
    const partidas = [partida("HOY", "10", HOY)];
    const result = proponerReparto(partidas, "10", HOY);
    expect(result).toEqual({ ok: true, lineas: [{ partidaId: "HOY", cantidad: new Decimal("10") }] });
  });

  it("insufficient stock: total available across every eligible partida is less than requested -- returns an error, not a partial proposal", () => {
    const partidas = [partida("A", "10", "2026-12-31"), partida("B", "5", "2027-01-01")];
    const result = proponerReparto(partidas, "100", HOY);
    expect(result).toEqual({ ok: false, motivo: "STOCK_INSUFICIENTE", faltante: new Decimal("85") });
  });

  it("insufficient stock ignores expired partidas entirely when computing the shortfall", () => {
    const partidas = [partida("VENCIDA", "1000", "2020-01-01"), partida("VIGENTE", "10", "2026-12-31")];
    const result = proponerReparto(partidas, "50", HOY);
    expect(result).toEqual({ ok: false, motivo: "STOCK_INSUFICIENTE", faltante: new Decimal("40") });
  });

  it("quantity equal to the exact total: every eligible partida is drained, the LAST one ends at exactly zero remaining (not merely partial)", () => {
    const partidas = [partida("A", "10", "2026-07-01"), partida("B", "15", "2026-08-01")];
    const result = proponerReparto(partidas, "25", HOY);
    expect(result).toEqual({
      ok: true,
      lineas: [
        { partidaId: "A", cantidad: new Decimal("10") },
        { partidaId: "B", cantidad: new Decimal("15") },
      ],
    });
  });

  it("zero-balance partidas are never proposed", () => {
    const partidas = [partida("VACIA", "0", "2026-12-31"), partida("CON_SALDO", "20", "2027-01-01")];
    const result = proponerReparto(partidas, "20", HOY);
    expect(result).toEqual({ ok: true, lineas: [{ partidaId: "CON_SALDO", cantidad: new Decimal("20") }] });
  });

  it("multiple ABIERTA partidas (should not normally happen, but the schema allows it) are consumed oldest-fechaApertura-first", () => {
    const partidas = [
      partida("ABIERTA_NUEVA", "10", "2026-12-31", "2026-06-10T00:00:00Z"),
      partida("ABIERTA_VIEJA", "10", "2026-12-31", "2026-06-01T00:00:00Z"),
    ];
    const result = proponerReparto(partidas, "15", HOY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lineas).toEqual([
        { partidaId: "ABIERTA_VIEJA", cantidad: new Decimal("10") },
        { partidaId: "ABIERTA_NUEVA", cantidad: new Decimal("5") },
      ]);
    }
  });

  it("throws for a non-positive cantidadRequerida (caller/zod's responsibility to prevent this at the edge)", () => {
    expect(() => proponerReparto([partida("A", "10", "2026-12-31")], "0", HOY)).toThrow(RangeError);
    expect(() => proponerReparto([partida("A", "10", "2026-12-31")], "-5", HOY)).toThrow(RangeError);
  });
});

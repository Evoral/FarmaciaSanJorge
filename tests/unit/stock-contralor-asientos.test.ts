import { describe, expect, it } from "vitest";
import { requiereAsientoContralor } from "@/modules/stock/domain/partida";

// Security audit P3-01: compras and ajustes of a controlled droga write their asiento_contralor once the
// contralor digital is active (INV-L08, fsj.movimiento_stock_validar_contralor).
describe("requiereAsientoContralor", () => {
  const ahora = new Date("2026-10-23T15:00:00Z");

  it("a controlled droga with the contralor active needs the asiento", () => {
    expect(requiereAsientoContralor("PSICOTROPICO", new Date("2026-10-01T00:00:00Z"), ahora)).toBe(true);
    expect(requiereAsientoContralor("ESTUPEFACIENTE", ahora, ahora)).toBe(true);
  });

  it("a droga without control never does", () => {
    expect(requiereAsientoContralor("NINGUNO", new Date("2026-10-01T00:00:00Z"), ahora)).toBe(false);
  });

  it("no asiento while the contralor is not active, or activates later", () => {
    expect(requiereAsientoContralor("PSICOTROPICO", null, ahora)).toBe(false);
    expect(requiereAsientoContralor("PSICOTROPICO", new Date("2026-11-01T00:00:00Z"), ahora)).toBe(false);
  });
});

/**
 * Unit tests for `modules/stock/domain/existencia-inicial.ts`.
 * Focuses on `diferenciasControladas` (openspec/specs/existencia-inicial/spec.md R8):
 * - decimal comparison with dec() (formatting differences do not trigger discrepancy)
 * - saldoContralor = null counts as 0 (no APERTURA yet)
 * - detects mismatches between contralor and physical stock
 */
import { describe, it, expect } from "vitest";
import { diferenciasControladas, type SaldoControlada } from "@/modules/stock/domain/existencia-inicial";

describe("diferenciasControladas", () => {
  it("returns empty array when saldos list is empty", () => {
    expect(diferenciasControladas([])).toEqual([]);
  });

  it("considers exact matching values as having no differences", () => {
    const saldos: SaldoControlada[] = [
      {
        drogaId: "d-1",
        drogaNombre: "Morfina Clorhidrato",
        unidadSimbolo: "g",
        saldoContralor: "50",
        stockFisico: "50",
      },
    ];

    expect(diferenciasControladas(saldos)).toEqual([]);
  });

  it("uses decimal comparison with dec(), ignoring representation formatting differences", () => {
    const saldos: SaldoControlada[] = [
      {
        drogaId: "d-1",
        drogaNombre: "Morfina Clorhidrato",
        unidadSimbolo: "g",
        saldoContralor: "10.0000",
        stockFisico: "10",
      },
      {
        drogaId: "d-2",
        drogaNombre: "Codeína Fosfato",
        unidadSimbolo: "g",
        saldoContralor: "0.5",
        stockFisico: "0.5000000000",
      },
    ];

    expect(diferenciasControladas(saldos)).toEqual([]);
  });

  it("treats saldoContralor = null as 0 (no APERTURA seat yet)", () => {
    const conStock: SaldoControlada = {
      drogaId: "d-1",
      drogaNombre: "Morfina Clorhidrato",
      unidadSimbolo: "g",
      saldoContralor: null,
      stockFisico: "10",
    };
    const sinStock: SaldoControlada = {
      drogaId: "d-2",
      drogaNombre: "Codeína Fosfato",
      unidadSimbolo: "g",
      saldoContralor: null,
      stockFisico: "0",
    };
    const conCeroFormateado: SaldoControlada = {
      drogaId: "d-3",
      drogaNombre: "Fentanilo",
      unidadSimbolo: "mg",
      saldoContralor: null,
      stockFisico: "0.000",
    };

    // conStock has diff: contralor is 0 vs physical 10
    expect(diferenciasControladas([conStock])).toEqual([conStock]);

    // sinStock and conCeroFormateado have no diff: contralor is 0 and physical is 0
    expect(diferenciasControladas([sinStock, conCeroFormateado])).toEqual([]);
  });

  it("detects mismatches when physical stock is higher or lower than contralor saldo", () => {
    const masFisico: SaldoControlada = {
      drogaId: "d-1",
      drogaNombre: "Morfina Clorhidrato",
      unidadSimbolo: "g",
      saldoContralor: "5",
      stockFisico: "10",
    };
    const menosFisico: SaldoControlada = {
      drogaId: "d-2",
      drogaNombre: "Codeína Fosfato",
      unidadSimbolo: "g",
      saldoContralor: "20",
      stockFisico: "15",
    };
    const coincidente: SaldoControlada = {
      drogaId: "d-3",
      drogaNombre: "Metadona",
      unidadSimbolo: "g",
      saldoContralor: "12.34",
      stockFisico: "12.3400",
    };

    const diffs = diferenciasControladas([masFisico, coincidente, menosFisico]);
    expect(diffs).toHaveLength(2);
    expect(diffs).toEqual([masFisico, menosFisico]);
  });
});

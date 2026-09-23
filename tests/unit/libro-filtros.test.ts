/** Unit tests for `modules/libro/domain/filtros.ts` (FASE 9, M12): zod parsing of the list/export/contralor/histórico filters. */
import { describe, it, expect } from "vitest";
import { listAsientosRecetarioFiltro, exportarLibroFiltro, listContralorFiltro, listHistoricoFiltro } from "@/modules/libro/domain/filtros";

describe("listAsientosRecetarioFiltro", () => {
  it("defaults page/pageSize when omitted", () => {
    const result = listAsientosRecetarioFiltro.parse({});
    expect(result).toMatchObject({ page: 1, pageSize: 20 });
  });

  it("parses a valid full filter, coercing numeroDesde/numeroHasta to bigint", () => {
    const result = listAsientosRecetarioFiltro.parse({
      fechaDesde: "2026-01-01",
      fechaHasta: "2026-06-15",
      numeroDesde: "1",
      numeroHasta: "9999999999999",
      estado: "VIGENTE",
      texto: "Pérez",
      page: 2,
      pageSize: 50,
    });
    expect(result.numeroDesde).toBe(BigInt(1));
    expect(result.numeroHasta).toBe(BigInt(9999999999999));
    expect(result.estado).toBe("VIGENTE");
  });

  it("rejects a malformed date", () => {
    expect(() => listAsientosRecetarioFiltro.parse({ fechaDesde: "15-06-2026" })).toThrow();
  });

  it("rejects a non-digit numero", () => {
    expect(() => listAsientosRecetarioFiltro.parse({ numeroDesde: "abc" })).toThrow();
  });

  it("rejects an invalid estado", () => {
    expect(() => listAsientosRecetarioFiltro.parse({ estado: "PENDIENTE" })).toThrow();
  });

  it("caps pageSize at 200", () => {
    expect(() => listAsientosRecetarioFiltro.parse({ pageSize: 500 })).toThrow();
  });
});

describe("exportarLibroFiltro", () => {
  it("has no page/pageSize fields (exports walk every page internally)", () => {
    const result = exportarLibroFiltro.parse({ texto: "Ana" });
    expect(result).not.toHaveProperty("page");
    expect(result).not.toHaveProperty("pageSize");
  });
});

describe("listContralorFiltro", () => {
  it("accepts PSICOTROPICO/ESTUPEFACIENTE only", () => {
    expect(() => listContralorFiltro.parse({ tipoLibro: "RECETARIO" })).toThrow();
    expect(listContralorFiltro.parse({ tipoLibro: "PSICOTROPICO" }).tipoLibro).toBe("PSICOTROPICO");
  });

  it("rejects a non-uuid drogaId", () => {
    expect(() => listContralorFiltro.parse({ drogaId: "not-a-uuid" })).toThrow();
  });
});

describe("listHistoricoFiltro", () => {
  it("accepts all three tipoLibro values (RECETARIO included -- histórico spans every physical book)", () => {
    for (const tipo of ["RECETARIO", "PSICOTROPICO", "ESTUPEFACIENTE"]) {
      expect(listHistoricoFiltro.parse({ tipoLibro: tipo }).tipoLibro).toBe(tipo);
    }
  });
});

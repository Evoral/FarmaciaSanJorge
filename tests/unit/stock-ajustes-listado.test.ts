/** Unit tests for `modules/stock/domain/ajustes-listado.ts`: `/stock/ajustes` filter parsing and link building. */
import { describe, it, expect } from "vitest";
import { ajustesSearchParams, esFechaIso, hayFiltrosAjustes, parseFiltrosAjustes, rangoAjustesInvalido } from "@/modules/stock/domain/ajustes-listado";

describe("esFechaIso", () => {
  it("accepts real calendar dates", () => {
    expect(esFechaIso("2026-06-15")).toBe(true);
    expect(esFechaIso("2028-02-29")).toBe(true);
  });

  it("rejects other formats and impossible dates", () => {
    expect(esFechaIso("15/06/2026")).toBe(false);
    expect(esFechaIso("2026-6-15")).toBe(false);
    expect(esFechaIso("2026-02-30")).toBe(false);
    expect(esFechaIso("2026-13-01")).toBe(false);
    expect(esFechaIso("")).toBe(false);
  });
});

describe("parseFiltrosAjustes", () => {
  it("normalizes valid params", () => {
    expect(parseFiltrosAjustes({ q: "  alfa ", motivo: "ROTURA", desde: "2026-06-01", hasta: "2026-06-30" })).toEqual({
      q: "alfa",
      motivo: "ROTURA",
      desde: "2026-06-01",
      hasta: "2026-06-30",
    });
  });

  it("drops blank or invalid values instead of failing", () => {
    expect(parseFiltrosAjustes({ q: "   ", motivo: "OTRO", desde: "2026-02-30", hasta: "ayer" })).toEqual({
      q: undefined,
      motivo: undefined,
      desde: undefined,
      hasta: undefined,
    });
    expect(hayFiltrosAjustes(parseFiltrosAjustes({}))).toBe(false);
  });
});

describe("rangoAjustesInvalido", () => {
  it("flags only an inverted range", () => {
    expect(rangoAjustesInvalido({ desde: "2026-06-30", hasta: "2026-06-01" })).toBe(true);
    expect(rangoAjustesInvalido({ desde: "2026-06-01", hasta: "2026-06-01" })).toBe(false);
    expect(rangoAjustesInvalido({ desde: "2026-06-30" })).toBe(false);
  });
});

describe("ajustesSearchParams", () => {
  it("keeps every active filter plus the page", () => {
    const qs = ajustesSearchParams({ q: "lote 1", motivo: "VENCIMIENTO", desde: "2026-06-01", hasta: "2026-06-30" }, 2);
    expect(qs.toString()).toBe("q=lote+1&motivo=VENCIMIENTO&desde=2026-06-01&hasta=2026-06-30&page=2");
  });

  it("never carries the one-shot `registrado` flag, even when it was in the URL", () => {
    const filtros = parseFiltrosAjustes({ motivo: "ROTURA", registrado: "1" } as Record<string, string>);
    expect(ajustesSearchParams(filtros, 1).toString()).toBe("motivo=ROTURA&page=1");
  });
});

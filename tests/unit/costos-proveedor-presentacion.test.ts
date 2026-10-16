/** Presentation rules of "Costos de proveedores": the age of a price, the state of each version, the price label. */
import { describe, it, expect } from "vitest";
import { antiguedadDias, clasificarVersiones, etiquetaAntiguedad, etiquetaPrecio } from "@/modules/costos-proveedor/domain/presentacion";

describe("antiguedadDias / etiquetaAntiguedad", () => {
  it("counts whole days between the price date and the jornada actual", () => {
    expect(antiguedadDias("2026-10-15", "2026-10-15")).toBe(0);
    expect(antiguedadDias("2026-10-14", "2026-10-15")).toBe(1);
    expect(antiguedadDias("2026-09-15", "2026-10-15")).toBe(30);
    // Across a month with 31 days and a leap February: calendar days, not "30 per month".
    expect(antiguedadDias("2024-02-28", "2024-03-01")).toBe(2);
  });

  it("never goes negative for a date in the future", () => {
    expect(antiguedadDias("2026-10-20", "2026-10-15")).toBe(0);
  });

  it("words the age: hoy, días, meses, años", () => {
    expect(etiquetaAntiguedad(0)).toBe("hoy");
    expect(etiquetaAntiguedad(1)).toBe("hace 1 día");
    expect(etiquetaAntiguedad(12)).toBe("hace 12 días");
    expect(etiquetaAntiguedad(59)).toBe("hace 59 días");
    expect(etiquetaAntiguedad(90)).toBe("hace 3 meses");
    expect(etiquetaAntiguedad(800)).toBe("hace 2 años");
  });
});

describe("clasificarVersiones", () => {
  const t = (iso: string) => new Date(iso);

  it("tells vigente, reemplazado and dado de baja apart", () => {
    const estados = clasificarVersiones([
      { id: "v4", vigenteDesde: t("2026-10-10T10:00:00Z"), vigenteHasta: null },
      { id: "v3", vigenteDesde: t("2026-09-20T10:00:00Z"), vigenteHasta: t("2026-10-01T09:00:00Z") },
      { id: "v2", vigenteDesde: t("2026-09-01T10:00:00Z"), vigenteHasta: t("2026-09-20T10:00:00Z") },
      { id: "v1", vigenteDesde: t("2026-08-01T10:00:00Z"), vigenteHasta: t("2026-09-01T10:00:00Z") },
    ]);

    expect(estados.get("v4")).toBe("VIGENTE");
    // v3 closed at 09:00 and nothing starts then: closed without a replacement (a baja).
    expect(estados.get("v3")).toBe("BAJA");
    expect(estados.get("v2")).toBe("REEMPLAZADO");
    expect(estados.get("v1")).toBe("REEMPLAZADO");
  });

  it("a single vigente version is just vigente; an empty history is empty", () => {
    expect(clasificarVersiones([{ id: "a", vigenteDesde: t("2026-10-01T00:00:00Z"), vigenteHasta: null }]).get("a")).toBe("VIGENTE");
    expect(clasificarVersiones([]).size).toBe(0);
  });
});

describe("etiquetaPrecio", () => {
  it("shows the precio informado with its unit, es-AR, at least 2 decimals", () => {
    expect(etiquetaPrecio("40898", "kg")).toBe("$ 40.898,00 / kg");
    expect(etiquetaPrecio("40898.5", "kg")).toBe("$ 40.898,50 / kg");
    expect(etiquetaPrecio("12.3456", "L")).toBe("$ 12,3456 / L");
  });
});

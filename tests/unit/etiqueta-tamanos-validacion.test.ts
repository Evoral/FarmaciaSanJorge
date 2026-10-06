/**
 * Unit tests for modules/etiqueta-tamanos: the pure size rules in
 * `domain/etiqueta-tamano.ts` and the input schemas of the admin commands
 * (limits in mm, one decimal, non-empty name).
 */
import { describe, it, expect } from "vitest";
import {
  ETIQUETA_TAMANO_PREDETERMINADO,
  TAMANO_MM_MAX,
  TAMANO_MM_MIN,
  formatearMedidaMm,
  formatearMedidas,
  formatearTamano,
  medidaMmValida,
} from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { crearEtiquetaTamanoInput } from "@/modules/etiqueta-tamanos/application/crear-etiqueta-tamano";
import { editarEtiquetaTamanoInput } from "@/modules/etiqueta-tamanos/application/editar-etiqueta-tamano";

describe("ETIQUETA_TAMANO_PREDETERMINADO", () => {
  it("is the 100 x 42 mm label the layout was designed for", () => {
    expect(ETIQUETA_TAMANO_PREDETERMINADO).toEqual({ anchoMm: 100, altoMm: 42 });
  });
});

describe("medidaMmValida (mirrors the etiqueta_tamano CHECKs)", () => {
  it("accepts the limits and values with one decimal", () => {
    expect(medidaMmValida(TAMANO_MM_MIN)).toBe(true);
    expect(medidaMmValida(TAMANO_MM_MAX)).toBe(true);
    expect(medidaMmValida(42)).toBe(true);
    expect(medidaMmValida(42.5)).toBe(true);
    expect(medidaMmValida(10.1)).toBe(true);
  });

  it("rejects values outside the limits", () => {
    expect(medidaMmValida(9.9)).toBe(false);
    expect(medidaMmValida(0)).toBe(false);
    expect(medidaMmValida(-5)).toBe(false);
    expect(medidaMmValida(300.1)).toBe(false);
  });

  it("rejects more than one decimal and non-finite numbers", () => {
    expect(medidaMmValida(42.55)).toBe(false);
    expect(medidaMmValida(Number.NaN)).toBe(false);
    expect(medidaMmValida(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("formatting", () => {
  it("formats a measure with es-AR decimals and no trailing .0", () => {
    expect(formatearMedidaMm(100)).toBe("100");
    expect(formatearMedidaMm(42.5)).toBe("42,5");
    expect(formatearMedidaMm(30.0)).toBe("30");
  });

  it("formats the measures and the picker label", () => {
    expect(formatearMedidas({ anchoMm: 100, altoMm: 42 })).toBe("100 × 42 mm");
    expect(formatearMedidas({ anchoMm: 50, altoMm: 30.5 })).toBe("50 × 30,5 mm");
    expect(formatearTamano({ nombre: "Frasco chico", anchoMm: 50, altoMm: 30 })).toBe("Frasco chico — 50 × 30 mm");
  });
});

describe("crearEtiquetaTamanoInput", () => {
  const base = { nombre: "Rollo chico", anchoMm: "50", altoMm: "30" };

  it("accepts valid measures given as strings (form input), with comma or dot decimals", () => {
    const result = crearEtiquetaTamanoInput.safeParse({ ...base, anchoMm: "50,5", altoMm: "30.5" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ nombre: "Rollo chico", anchoMm: 50.5, altoMm: 30.5 });
  });

  it("accepts plain numbers too", () => {
    expect(crearEtiquetaTamanoInput.safeParse({ ...base, anchoMm: 50, altoMm: 30 }).success).toBe(true);
  });

  it("trims the name and rejects an empty one", () => {
    const ok = crearEtiquetaTamanoInput.safeParse({ ...base, nombre: "  Rollo  " });
    expect(ok.success && ok.data.nombre).toBe("Rollo");
    expect(crearEtiquetaTamanoInput.safeParse({ ...base, nombre: "   " }).success).toBe(false);
  });

  it("rejects measures below 10 mm or above 300 mm", () => {
    expect(crearEtiquetaTamanoInput.safeParse({ ...base, anchoMm: "9.9" }).success).toBe(false);
    expect(crearEtiquetaTamanoInput.safeParse({ ...base, altoMm: "300.1" }).success).toBe(false);
    expect(crearEtiquetaTamanoInput.safeParse({ ...base, anchoMm: "300" }).success).toBe(true);
  });

  it("rejects more than one decimal, empty and non-numeric measures", () => {
    expect(crearEtiquetaTamanoInput.safeParse({ ...base, anchoMm: "50.55" }).success).toBe(false);
    expect(crearEtiquetaTamanoInput.safeParse({ ...base, anchoMm: "" }).success).toBe(false);
    expect(crearEtiquetaTamanoInput.safeParse({ ...base, altoMm: "abc" }).success).toBe(false);
    expect(crearEtiquetaTamanoInput.safeParse({ ...base, altoMm: "1e2" }).success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(crearEtiquetaTamanoInput.safeParse({ ...base, activo: false }).success).toBe(false);
  });
});

describe("editarEtiquetaTamanoInput", () => {
  it("needs the id of the size plus the same fields as crear", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(editarEtiquetaTamanoInput.safeParse({ id, nombre: "Rollo", anchoMm: "50", altoMm: "30" }).success).toBe(true);
    expect(editarEtiquetaTamanoInput.safeParse({ id: "x", nombre: "Rollo", anchoMm: "50", altoMm: "30" }).success).toBe(false);
    expect(editarEtiquetaTamanoInput.safeParse({ id, nombre: "Rollo", anchoMm: "5", altoMm: "30" }).success).toBe(false);
  });
});

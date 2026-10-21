/**
 * Unit tests for the pure sheet rules in
 * modules/etiqueta-tamanos/domain/etiqueta-hoja.ts (docs/specs/hoja-etiquetas.md
 * R1-R5, R8, R11): the grid in integer tenths of a mm, the cell positions and the
 * formatting.
 */
import { describe, it, expect } from "vitest";
import {
  HOJA_MM_MAX,
  HOJA_MM_MIN,
  HOJA_PREDETERMINADA,
  MARGEN_MM_MAX,
  MARGEN_MM_MIN,
  areaUtilMm,
  areaUtilSuficiente,
  camposQueNoEntran,
  celdaValida,
  conservarCelda,
  entraEnHoja,
  etiquetasPorHoja,
  formatearCapacidad,
  formatearCelda,
  formatearHoja,
  grillaHoja,
  nombreHoja,
  posicionCelda,
  resumenGrilla,
  siguienteCelda,
  tamanosQueNoEntran,
} from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { ETIQUETA_TAMANO_PREDETERMINADO, tieneUnDecimal } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";

const A4 = HOJA_PREDETERMINADA;

describe("HOJA_PREDETERMINADA and limits (R1, R2)", () => {
  it("is A4 portrait with a 5 mm margin", () => {
    expect(A4).toEqual({ anchoMm: 210, altoMm: 297, margenMm: 5 });
  });

  it("mirrors the migration's limits", () => {
    expect([HOJA_MM_MIN, HOJA_MM_MAX, MARGEN_MM_MIN, MARGEN_MM_MAX]).toEqual([50, 500, 0, 30]);
  });

  it("tieneUnDecimal accepts one decimal and rejects more", () => {
    expect(tieneUnDecimal(5)).toBe(true);
    expect(tieneUnDecimal(66.7)).toBe(true);
    expect(tieneUnDecimal(66.75)).toBe(false);
    expect(tieneUnDecimal(Number.NaN)).toBe(false);
  });
});

describe("areaUtilSuficiente (R2)", () => {
  it("needs 10 mm of printable area each way", () => {
    expect(areaUtilSuficiente({ anchoMm: 50, altoMm: 50, margenMm: 20 })).toBe(true);
    expect(areaUtilSuficiente({ anchoMm: 50, altoMm: 50, margenMm: 20.1 })).toBe(false);
    expect(areaUtilSuficiente({ anchoMm: 500, altoMm: 50, margenMm: 20.1 })).toBe(false);
    expect(areaUtilSuficiente({ anchoMm: 50, altoMm: 500, margenMm: 20.1 })).toBe(false);
    expect(areaUtilSuficiente({ anchoMm: 50, altoMm: 50, margenMm: 30 })).toBe(false);
  });

  it("areaUtilMm is the sheet minus both margins", () => {
    expect(areaUtilMm(A4)).toEqual({ anchoMm: 200, altoMm: 287 });
    expect(areaUtilMm({ anchoMm: 50, altoMm: 50, margenMm: 30 })).toEqual({ anchoMm: 0, altoMm: 0 });
  });
});

describe("grillaHoja (R3)", () => {
  it("the seeded 100 x 42 mm size on A4 / 5 mm: 2 columns x 6 rows", () => {
    expect(grillaHoja(A4, ETIQUETA_TAMANO_PREDETERMINADO)).toEqual({ columnas: 2, filas: 6 });
  });

  it("an exact fit never rounds down (200 / 100 = 2)", () => {
    expect(grillaHoja(A4, { anchoMm: 100, altoMm: 287 })).toEqual({ columnas: 2, filas: 1 });
    expect(grillaHoja(A4, { anchoMm: 200, altoMm: 287 })).toEqual({ columnas: 1, filas: 1 });
  });

  it("a near miss never rounds up (3 x 66,7 = 200,1 > 200)", () => {
    expect(grillaHoja(A4, { anchoMm: 66.7, altoMm: 50 }).columnas).toBe(2);
    expect(grillaHoja(A4, { anchoMm: 66.6, altoMm: 50 }).columnas).toBe(3);
  });

  it("is exact for tenths that are not representable in binary floats", () => {
    // 0,1 + 0,2 style drift must not matter: 0,3 x 10 -> 300 tenths.
    expect(grillaHoja({ anchoMm: 50, altoMm: 50, margenMm: 0 }, { anchoMm: 16.7, altoMm: 10 })).toEqual({ columnas: 2, filas: 5 });
    expect(grillaHoja({ anchoMm: 50, altoMm: 50, margenMm: 0 }, { anchoMm: 16.6, altoMm: 10 })).toEqual({ columnas: 3, filas: 5 });
    expect(grillaHoja({ anchoMm: 50.3, altoMm: 50, margenMm: 0.1 }, { anchoMm: 10, altoMm: 10 })).toEqual({ columnas: 5, filas: 4 });
  });

  it("margin 0 uses the whole sheet", () => {
    expect(grillaHoja({ anchoMm: 210, altoMm: 297, margenMm: 0 }, { anchoMm: 70, altoMm: 99 })).toEqual({ columnas: 3, filas: 3 });
  });

  it("landscape is just ancho > alto", () => {
    expect(grillaHoja({ anchoMm: 297, altoMm: 210, margenMm: 5 }, ETIQUETA_TAMANO_PREDETERMINADO)).toEqual({ columnas: 2, filas: 4 });
  });

  it("a size that does not fit gives 0 in that direction", () => {
    expect(grillaHoja(A4, { anchoMm: 200.1, altoMm: 42 })).toEqual({ columnas: 0, filas: 6 });
    expect(grillaHoja(A4, { anchoMm: 100, altoMm: 287.1 })).toEqual({ columnas: 2, filas: 0 });
    expect(grillaHoja({ anchoMm: 50, altoMm: 50, margenMm: 30 }, { anchoMm: 10, altoMm: 10 })).toEqual({ columnas: 0, filas: 0 });
  });

  it("etiquetasPorHoja multiplies", () => {
    expect(etiquetasPorHoja({ columnas: 2, filas: 6 })).toBe(12);
  });
});

describe("entraEnHoja / camposQueNoEntran / tamanosQueNoEntran (R5)", () => {
  it("a size fits when at least one etiqueta fits each way", () => {
    expect(entraEnHoja(A4, { anchoMm: 200, altoMm: 287 })).toBe(true);
    expect(entraEnHoja(A4, { anchoMm: 200.1, altoMm: 287 })).toBe(false);
    expect(entraEnHoja(A4, { anchoMm: 200, altoMm: 287.1 })).toBe(false);
  });

  it("names the measure(s) that do not fit", () => {
    expect(camposQueNoEntran(A4, { anchoMm: 100, altoMm: 42 })).toEqual([]);
    expect(camposQueNoEntran(A4, { anchoMm: 250, altoMm: 42 })).toEqual(["anchoMm"]);
    expect(camposQueNoEntran(A4, { anchoMm: 100, altoMm: 290 })).toEqual(["altoMm"]);
    expect(camposQueNoEntran(A4, { anchoMm: 250, altoMm: 290 })).toEqual(["anchoMm", "altoMm"]);
  });

  it("filters the sizes that would not fit, keeping their other fields", () => {
    const tamanos = [
      { id: "a", nombre: "Chico", anchoMm: 50, altoMm: 30 },
      { id: "b", nombre: "Rollo ancho", anchoMm: 250, altoMm: 30 },
    ];
    expect(tamanosQueNoEntran(A4, tamanos)).toEqual([tamanos[1]]);
    expect(tamanosQueNoEntran({ anchoMm: 300, altoMm: 297, margenMm: 5 }, tamanos)).toEqual([]);
  });
});

describe("posicionCelda (R4)", () => {
  const tamano = ETIQUETA_TAMANO_PREDETERMINADO; // 100 x 42

  it("column 1, row 1 starts at the margin", () => {
    expect(posicionCelda(A4, tamano, { columna: 1, fila: 1 })).toEqual({ xMm: 5, yMm: 5 });
  });

  it("each step moves by one label, cells touch", () => {
    expect(posicionCelda(A4, tamano, { columna: 2, fila: 1 })).toEqual({ xMm: 105, yMm: 5 });
    expect(posicionCelda(A4, tamano, { columna: 1, fila: 2 })).toEqual({ xMm: 5, yMm: 47 });
    expect(posicionCelda(A4, tamano, { columna: 2, fila: 6 })).toEqual({ xMm: 105, yMm: 215 });
  });

  it("is exact with decimal measures", () => {
    expect(posicionCelda({ anchoMm: 210, altoMm: 297, margenMm: 4.5 }, { anchoMm: 66.7, altoMm: 29.3 }, { columna: 3, fila: 3 })).toEqual({ xMm: 137.9, yMm: 63.1 });
  });

  it("a margin of 0 puts the first cell at the corner", () => {
    expect(posicionCelda({ anchoMm: 210, altoMm: 297, margenMm: 0 }, tamano, { columna: 1, fila: 1 })).toEqual({ xMm: 0, yMm: 0 });
  });
});

describe("celdaValida", () => {
  const grilla = { columnas: 2, filas: 6 };

  it("accepts the cells of the grid, 1-based", () => {
    expect(celdaValida(grilla, { columna: 1, fila: 1 })).toBe(true);
    expect(celdaValida(grilla, { columna: 2, fila: 6 })).toBe(true);
  });

  it("rejects out-of-grid, zero, negative and non-integer cells", () => {
    expect(celdaValida(grilla, { columna: 3, fila: 1 })).toBe(false);
    expect(celdaValida(grilla, { columna: 1, fila: 7 })).toBe(false);
    expect(celdaValida(grilla, { columna: 0, fila: 1 })).toBe(false);
    expect(celdaValida(grilla, { columna: 1, fila: -1 })).toBe(false);
    expect(celdaValida(grilla, { columna: 1.5, fila: 1 })).toBe(false);
    expect(celdaValida(grilla, { columna: Number.NaN, fila: 1 })).toBe(false);
    expect(celdaValida({ columnas: 0, filas: 0 }, { columna: 1, fila: 1 })).toBe(false);
  });
});

describe("conservarCelda (R8)", () => {
  it("keeps the cell while it fits, else falls back to 1 / 1", () => {
    expect(conservarCelda({ columnas: 2, filas: 6 }, { columna: 2, fila: 4 })).toEqual({ columna: 2, fila: 4 });
    expect(conservarCelda({ columnas: 1, filas: 3 }, { columna: 2, fila: 1 })).toEqual({ columna: 1, fila: 1 });
    expect(conservarCelda({ columnas: 3, filas: 2 }, { columna: 1, fila: 4 })).toEqual({ columna: 1, fila: 1 });
  });
});

describe("siguienteCelda (R11)", () => {
  const grilla = { columnas: 2, filas: 3 };

  it("moves right, then wraps to the next row", () => {
    expect(siguienteCelda(grilla, { columna: 1, fila: 1 })).toEqual({ columna: 2, fila: 1 });
    expect(siguienteCelda(grilla, { columna: 2, fila: 1 })).toEqual({ columna: 1, fila: 2 });
    expect(siguienteCelda(grilla, { columna: 2, fila: 2 })).toEqual({ columna: 1, fila: 3 });
  });

  it("wraps to 1 / 1 after the last cell", () => {
    expect(siguienteCelda(grilla, { columna: 2, fila: 3 })).toEqual({ columna: 1, fila: 1 });
    expect(siguienteCelda({ columnas: 1, filas: 1 }, { columna: 1, fila: 1 })).toEqual({ columna: 1, fila: 1 });
  });
});

describe("formatting (R8, R12)", () => {
  it("names the A4 sheets", () => {
    expect(nombreHoja({ anchoMm: 210, altoMm: 297 })).toBe("A4 vertical");
    expect(nombreHoja({ anchoMm: 297, altoMm: 210 })).toBe("A4 horizontal");
    expect(nombreHoja({ anchoMm: 215.9, altoMm: 279.4 })).toBeNull();
  });

  it("formats the sheet with its margin", () => {
    expect(formatearHoja(A4)).toBe("A4 vertical — 210 × 297 mm, margen 5 mm");
    expect(formatearHoja({ anchoMm: 297, altoMm: 210, margenMm: 0 })).toBe("A4 horizontal — 297 × 210 mm, margen 0 mm");
    expect(formatearHoja({ anchoMm: 215.9, altoMm: 279.4, margenMm: 4.5 })).toBe("215,9 × 279,4 mm, margen 4,5 mm");
  });

  it("formats the capacity per sheet", () => {
    expect(formatearCapacidad({ columnas: 2, filas: 6 })).toBe("2 × 6 = 12 por hoja");
    expect(resumenGrilla({ columnas: 2, filas: 6 })).toBe("2 columnas × 6 filas · 12 etiquetas por hoja");
    expect(resumenGrilla({ columnas: 1, filas: 1 })).toBe("1 columna × 1 fila · 1 etiqueta por hoja");
  });

  it("formats the chosen cell", () => {
    expect(formatearCelda({ columna: 3, fila: 2 })).toBe("Columna 3, fila 2");
  });
});

/**
 * The default cell of the toma dialog's rows (docs/specs/hoja-etiquetas.md R11): the next cell in reading
 * order after the last printed one, only between rows of the same size.
 */
import { describe, it, expect } from "vitest";
import { celdaPorDefecto } from "@/modules/preparaciones/domain/celda-por-defecto";

const GRILLA = { columnas: 2, filas: 3 };

describe("celdaPorDefecto (R11)", () => {
  it("is 1 / 1 while nothing was printed", () => {
    expect(celdaPorDefecto(GRILLA, "a", null)).toEqual({ columna: 1, fila: 1 });
  });

  it("is the next cell after the last printed one when the size is the same", () => {
    expect(celdaPorDefecto(GRILLA, "a", { tamanoId: "a", celda: { columna: 1, fila: 1 } })).toEqual({ columna: 2, fila: 1 });
    expect(celdaPorDefecto(GRILLA, "a", { tamanoId: "a", celda: { columna: 2, fila: 1 } })).toEqual({ columna: 1, fila: 2 });
  });

  it("wraps to 1 / 1 after the last cell", () => {
    expect(celdaPorDefecto(GRILLA, "a", { tamanoId: "a", celda: { columna: 2, fila: 3 } })).toEqual({ columna: 1, fila: 1 });
  });

  it("keeps 1 / 1 for a row with another size: the grids are not comparable", () => {
    expect(celdaPorDefecto(GRILLA, "b", { tamanoId: "a", celda: { columna: 2, fila: 2 } })).toEqual({ columna: 1, fila: 1 });
  });
});

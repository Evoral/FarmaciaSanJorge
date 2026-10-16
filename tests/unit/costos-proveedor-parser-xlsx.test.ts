/**
 * CP11 (docs/specs/costos-proveedor.md R15, R16): the "Lista de medicamentos" Crystal Reports parser. Pure: every
 * sheet is built here from raw cell values (no binary fixtures; the real file is not in the repo). Descriptions and
 * prices are fictitious but shaped like the real ones.
 */
import { describe, it, expect } from "vitest";
import { ValidationError } from "@/shared/errors";
import { MAX_FILAS_LISTA } from "@/modules/costos-proveedor/domain/archivo-lista";
import {
  MENSAJES_PARSER_LISTA,
  detectarPresentacion,
  parsearListaCrystal,
  type FilaCruda,
} from "@/modules/costos-proveedor/domain/parsers/lista-xlsx-crystal";

const ENCABEZADO: FilaCruda = ["DESCRIPCION", "PRECIO", "PRECIO mg", "mg C/IVA", "COSTO"];

/** A sheet as exceljs hands it over: header on row 1, one row per product, trailing page footer and closing row. */
function hoja(...datos: FilaCruda[]): FilaCruda[] {
  return [ENCABEZADO, ...datos];
}

describe("parsearListaCrystal -- header (R16)", () => {
  it("finds the header on row 1 and reads description and price from their columns, ignoring the other ones", () => {
    const { filas } = parsearListaCrystal(hoja(["ACEITE DE ALMENDRAS PURO FNA VI", 40898, 0.040898, 0.049, 12]));
    expect(filas).toEqual([{ numeroFila: 2, descripcion: "ACEITE DE ALMENDRAS PURO FNA VI", precio: "40898", presentacion: null }]);
  });

  it("is case-, accent- and spacing-insensitive, and finds the header below a title and in other columns", () => {
    const filas: FilaCruda[] = [
      ["Lista de medicamentos", null, null, null],
      [],
      [null, "  Descripción ", "PRECIO", null],
      [null, "ZINC SULFATO 7 H2O", 1234.5, null],
    ];
    expect(parsearListaCrystal(filas).filas).toEqual([{ numeroFila: 4, descripcion: "ZINC SULFATO 7 H2O", precio: "1234.5", presentacion: null }]);
  });

  it("does not take 'PRECIO mg' for the price column", () => {
    const { filas } = parsearListaCrystal([["DESCRIPCION", "PRECIO mg", "PRECIO"], ["X", 1, 2]]);
    expect(filas[0]!.precio).toBe("2");
  });

  it("refuses a sheet with no DESCRIPCION/PRECIO header, with a readable message", () => {
    const error = (() => {
      try {
        parsearListaCrystal([["nombre", "valor"], ["A", 1]]);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe(MENSAJES_PARSER_LISTA.sinEncabezado);
    expect(() => parsearListaCrystal([])).toThrow(ValidationError);
  });

  it("an empty sheet with its header yields no rows", () => {
    expect(parsearListaCrystal(hoja())).toEqual({ filas: [], descartadas: 0 });
  });
});

describe("parsearListaCrystal -- rows to ignore (R16)", () => {
  it("ignores blank rows, repeated page headers and page footers (in either column) without importing them", () => {
    const resultado = parsearListaCrystal(
      hoja(
        ["ALCOHOL ETILICO 96", 2500],
        [null, null],
        [],
        ["", "  "],
        ENCABEZADO, // Crystal repeats the header on every page
        ["ALCOHOL ISOPROPILICO", 3000],
        [null, "Page 65 of 65"],
        ["Page 1 of 65", null],
        ["COSTO PREPARACION ", null, null, 17],
      ),
    );
    expect(resultado.filas.map((f) => f.descripcion)).toEqual(["ALCOHOL ETILICO 96", "ALCOHOL ISOPROPILICO"]);
    // The two page footers and the closing row; blank rows and the repeated header are not counted.
    expect(resultado.descartadas).toBe(3);
  });

  it("discards a row with no description (a lone formula or number in another column)", () => {
    const resultado = parsearListaCrystal(hoja([null, null, null, null, 99], ["BORAX", 500]));
    expect(resultado.filas.map((f) => f.descripcion)).toEqual(["BORAX"]);
    expect(resultado.descartadas).toBe(1);
  });

  it("numbers the rows as the sheet does (row 1 is the first input row)", () => {
    const { filas } = parsearListaCrystal(hoja([null, null], ["A", 1], [null, null], ["B", 2]));
    expect(filas.map((f) => f.numeroFila)).toEqual([3, 5]);
  });
});

describe("parsearListaCrystal -- descriptions", () => {
  it("keeps the control marker as part of the name and collapses the double space", () => {
    const { filas } = parsearListaCrystal(hoja(["ZOLPIDEM TARTRATO  Sicotrop L4", 90000], ["ACETICO ACIDO  Sedronar L2", 3100]));
    expect(filas.map((f) => f.descripcion)).toEqual(["ZOLPIDEM TARTRATO Sicotrop L4", "ACETICO ACIDO Sedronar L2"]);
    expect(filas.every((f) => f.presentacion === null)).toBe(true);
  });

  it("keeps odd but legitimate names untouched", () => {
    const { filas } = parsearListaCrystal(hoja(["SELENIO LEVADURA:1MG SE/1G LEV", 100], ["VITAMINA D 3 (40000000 UI/G)", 200]));
    expect(filas.map((f) => [f.descripcion, f.presentacion])).toEqual([
      ["SELENIO LEVADURA:1MG SE/1G LEV", null],
      ["VITAMINA D 3 (40000000 UI/G)", null],
    ]);
  });

  it("keeps repeated descriptions (with different prices) as separate rows", () => {
    const { filas } = parsearListaCrystal(hoja(["GLICERINA", 1000], ["GLICERINA", 1100]));
    expect(filas.map((f) => [f.numeroFila, f.descripcion, f.precio])).toEqual([
      [2, "GLICERINA", "1000"],
      [3, "GLICERINA", "1100"],
    ]);
  });
});

describe("detectarPresentacion -- base rows vs presentation rows (R16)", () => {
  it.each([
    ["ACEITE DE ALMENDRAS PURO FNA VI", null],
    ["ACEITE DE ALMENDRAS PURO FNA VI Bidon X 10", "Bidon X 10"],
    ["ACEITE DE ALMENDRAS PURO FNA VI X 0.050", "X 0.050"],
    ["ACEITE DE ALMENDRAS PURO FNA VI X 0.500", "X 0.500"],
    ["ACEITE DE ALMENDRAS PURO FNA VI Pet X 0.250", "Pet X 0.250"],
    ["ACEITE DE GIRASOL Tambor X 200", "Tambor X 200"],
    ["ZINC SULFATO 7 H2O Cuñete X 25", "Cuñete X 25"],
    ["CARBON ACTIVADO USP Bolsa X 20", "Bolsa X 20"],
    ["ACEITE DE GIRASOL . X 1", "X 1"],
    ["ACEITE DE GIRASOL Bidón x 5,5", "Bidón x 5,5"],
  ])("%j -> %j", (descripcion, esperada) => {
    expect(detectarPresentacion(descripcion)).toBe(esperada);
  });

  it("only looks at the END: an X in the middle of a name is not a presentation", () => {
    expect(detectarPresentacion("MEZCLA X 25 SOLUCION ESTERIL")).toBeNull();
    expect(detectarPresentacion("VITAMINA MAX 5 COMPLEX")).toBeNull();
    expect(detectarPresentacion("RAYOS X")).toBeNull();
  });

  it("does not take letters glued to the X for it (no whitespace before the X)", () => {
    expect(detectarPresentacion("ACIDO MAX 5")).toBeNull();
  });

  it("LIMITATION: a material whose name already holds a standalone ' X ' (CINTA ... CM X 4 M X 12) is read as a base row, not as a presentation", () => {
    expect(detectarPresentacion("CINTA ADHESIVA BLANCA 2.50 CM X 4 M X 12")).toBeNull();
    // ... and the same limitation the other way around: a real presentation of such a name is read as a base row too.
    expect(detectarPresentacion("CINTA ADHESIVA BLANCA 2.50 CM X 4 M Caja X 12")).toBeNull();
  });

  it("flags presentation rows in the parsed output, base rows stay without one", () => {
    const { filas } = parsearListaCrystal(
      hoja(["ACEITE DE GIRASOL", 1500], ["ACEITE DE GIRASOL Tambor X 200", 250000], ["CINTA ADHESIVA BLANCA  2.50 CM X 4 M X 12", 800], ["ZINC SULFATO 7 H2O Cuñete X 25", 90000]),
    );
    expect(filas.map((f) => [f.descripcion, f.presentacion])).toEqual([
      ["ACEITE DE GIRASOL", null],
      ["ACEITE DE GIRASOL Tambor X 200", "Tambor X 200"],
      ["CINTA ADHESIVA BLANCA 2.50 CM X 4 M X 12", null],
      ["ZINC SULFATO 7 H2O Cuñete X 25", "Cuñete X 25"],
    ]);
  });
});

describe("parsearListaCrystal -- prices", () => {
  const precio = (celda: string | number | null) => parsearListaCrystal(hoja(["P", celda])).filas[0]!.precio;

  it("turns JS numbers into exact decimal strings", () => {
    expect(precio(40898)).toBe("40898");
    expect(precio(39518.6)).toBe("39518.6");
    expect(precio(134189.364)).toBe("134189.364");
    expect(precio(0.5)).toBe("0.5");
  });

  it("drops float noise: 15 significant digits is what Excel keeps", () => {
    expect(precio(29801.136000000002)).toBe("29801.136");
    expect(precio(0.1 + 0.2)).toBe("0.3");
    expect(precio(1234567.8900000001)).toBe("1234567.89");
  });

  it("never emits an exponent and never a negative zero", () => {
    expect(precio(1e21)).toBe("1000000000000000000000");
    expect(precio(0.0000001)).toBe("0.0000001");
    expect(precio(-0)).toBe("0");
  });

  it("parses numbers given as TEXT exactly, es-AR and plain", () => {
    expect(precio("40.898,50")).toBe("40898.5");
    expect(precio("40898,5")).toBe("40898.5");
    expect(precio("40898.5")).toBe("40898.5");
    expect(precio("  $ 39.518,60 ")).toBe("39518.6");
    expect(precio("1.234.567,891")).toBe("1234567.891");
  });

  it("keeps a row whose price is missing or unreadable, with price null (R18 'precio inválido')", () => {
    expect(precio(null)).toBeNull();
    expect(precio("")).toBeNull();
    expect(precio("a consultar")).toBeNull();
    expect(precio(Number.NaN)).toBeNull();
    expect(parsearListaCrystal(hoja(["P", null])).filas).toHaveLength(1);
  });

  it("keeps zero and negative prices as they are: the preview flags them", () => {
    expect(precio(0)).toBe("0");
    expect(precio(-5)).toBe("-5");
  });
});

describe("parsearListaCrystal -- size limit (R15)", () => {
  const filasDe = (cantidad: number): FilaCruda[] => hoja(...Array.from({ length: cantidad }, (_, i): FilaCruda => [`DROGA ${i}`, i + 1]));

  it("accepts exactly the maximum", () => {
    expect(parsearListaCrystal(filasDe(MAX_FILAS_LISTA)).filas).toHaveLength(MAX_FILAS_LISTA);
  });

  it("refuses one more data row", () => {
    expect(MAX_FILAS_LISTA).toBe(5000);
    const error = (() => {
      try {
        parsearListaCrystal(filasDe(MAX_FILAS_LISTA + 1));
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe(MENSAJES_PARSER_LISTA.demasiadasFilas);
    expect((error as ValidationError).message).toMatch(/5\.000/);
  });

  it("blank rows, footers and headers do not count towards the maximum", () => {
    const relleno: FilaCruda[] = Array.from({ length: 200 }, () => [null, null]);
    expect(parsearListaCrystal([...filasDe(MAX_FILAS_LISTA), ...relleno, ["Page 1 of 1", null]]).filas).toHaveLength(MAX_FILAS_LISTA);
  });
});

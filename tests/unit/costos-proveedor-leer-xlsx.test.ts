/**
 * `leer-xlsx.server.ts` (openspec/specs/costos-proveedor/spec.md R14): workbooks built in memory with exceljs (several sheets named
 * by date, one of them empty, a formula cell with a cached result, rich text), read back, and parsed with the real
 * Crystal parser end to end. Malformed bytes must surface as a readable `ValidationError`, never a stack trace.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { ValidationError } from "@/shared/errors";
import { hojaPorDefecto } from "@/modules/costos-proveedor/domain/importacion-lista";
import { parsearListaCrystal } from "@/modules/costos-proveedor/domain/parsers/lista-xlsx-crystal";
import { MENSAJES_LECTURA_XLSX, hashSha256, leerLibroXlsx } from "@/modules/costos-proveedor/infrastructure/leer-xlsx.server";

async function armarLibro(armar: (libro: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  armar(libro);
  return new Uint8Array(await libro.xlsx.writeBuffer());
}

function hojaCrystal(libro: ExcelJS.Workbook, nombre: string, filas: (string | number | null)[][]): ExcelJS.Worksheet {
  const hoja = libro.addWorksheet(nombre);
  hoja.addRow(["DESCRIPCION", "PRECIO", "PRECIO mg", "mg C/IVA", "COSTO"]);
  for (const fila of filas) hoja.addRow(fila);
  return hoja;
}

async function libroConVariasHojas(): Promise<Uint8Array> {
  return armarLibro((libro) => {
    hojaCrystal(libro, "12-23", [["ACEITE DE GIRASOL", 1000]]);
    libro.addWorksheet("vacia"); // an empty sheet in the middle
    hojaCrystal(libro, "11-24", [["ACEITE DE GIRASOL", 1200]]);
    const ultima = hojaCrystal(libro, "04-26", [
      ["ACEITE DE GIRASOL", 1500],
      ["ZINC SULFATO 7 H2O Cuñete X 25", 90000],
      ["ZOLPIDEM TARTRATO  Sicotrop L4", 29801.136000000002],
    ]);
    // A derived column: a formula with its cached result, as Excel saves it.
    ultima.getCell("C2").value = { formula: "B2/1000000", result: 0.0015 };
    ultima.getCell("A5").value = { richText: [{ text: "VITAMINA " }, { text: "D 3" }] };
    ultima.getCell("B5").value = { formula: "B3*2", result: 180000 };
    ultima.addRow(["Page 1 of 1", null]);
  });
}

describe("hashSha256", () => {
  it("is the lowercase hex SHA-256 of the bytes (the DB checks 64 hex chars)", () => {
    expect(hashSha256(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashSha256(new Uint8Array(0))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with one byte", () => {
    expect(hashSha256(new Uint8Array([1, 2, 3]))).not.toBe(hashSha256(new Uint8Array([1, 2, 4])));
  });
});

describe("leerLibroXlsx", () => {
  it("lists the sheets in workbook order, flagging the empty one", async () => {
    const libro = await leerLibroXlsx(await libroConVariasHojas());
    expect(libro.hojas).toEqual([
      { nombre: "12-23", vacia: false },
      { nombre: "vacia", vacia: true },
      { nombre: "11-24", vacia: false },
      { nombre: "04-26", vacia: false },
    ]);
  });

  it("opens by default the LAST sheet with data", async () => {
    const libro = await leerLibroXlsx(await libroConVariasHojas());
    expect(hojaPorDefecto(libro.hojas)).toBe("04-26");
    expect(hojaPorDefecto([{ nombre: "a", vacia: false }, { nombre: "b", vacia: true }])).toBe("a");
    expect(hojaPorDefecto([{ nombre: "a", vacia: true }])).toBeNull();
    expect(hojaPorDefecto([])).toBeNull();
  });

  it("returns the rows of a sheet from row 1 as raw values", async () => {
    const libro = await leerLibroXlsx(await libroConVariasHojas());
    const filas = libro.leerHoja("12-23");
    expect(filas[0]!.slice(0, 2)).toEqual(["DESCRIPCION", "PRECIO"]);
    expect(filas[1]!.slice(0, 2)).toEqual(["ACEITE DE GIRASOL", 1000]);
    expect(filas).toHaveLength(2);
  });

  it("reads the cached result of a formula cell, joins rich text and keeps numbers as numbers", async () => {
    const libro = await leerLibroXlsx(await libroConVariasHojas());
    const filas = libro.leerHoja("04-26");
    expect(filas[1]![2]).toBe(0.0015);
    expect(filas[4]![0]).toBe("VITAMINA D 3");
    expect(filas[4]![1]).toBe(180000);
    expect(filas[3]![1]).toBe(29801.136000000002);
  });

  it("treats a formula with no cached result, a date and a boolean as empty", async () => {
    const bytes = await armarLibro((libro) => {
      const hoja = libro.addWorksheet("x");
      hoja.addRow(["DESCRIPCION", "PRECIO", "fecha", "si"]);
      hoja.getCell("A2").value = "BORAX";
      hoja.getCell("B2").value = { formula: "1+1" } as ExcelJS.CellFormulaValue;
      hoja.getCell("C2").value = new Date("2026-01-01T00:00:00Z");
      hoja.getCell("D2").value = true;
    });
    const fila = (await leerLibroXlsx(bytes)).leerHoja("x")[1]!;
    expect(fila.slice(0, 4)).toEqual(["BORAX", null, null, null]);
  });

  it("pads missing rows and cells with null so an index is a row number minus one", async () => {
    const bytes = await armarLibro((libro) => {
      const hoja = libro.addWorksheet("x");
      hoja.getCell("B3").value = "tercera fila, columna B";
    });
    const filas = (await leerLibroXlsx(bytes)).leerHoja("x");
    expect(filas).toHaveLength(3);
    expect(filas[0]).toEqual([null, null]);
    expect(filas[2]).toEqual([null, "tercera fila, columna B"]);
  });

  it("rejects a sheet that does not exist, naming it", async () => {
    const libro = await leerLibroXlsx(await libroConVariasHojas());
    expect(() => libro.leerHoja("99-99")).toThrow(MENSAJES_LECTURA_XLSX.hojaInexistente("99-99"));
  });

  it("a workbook with no data at all has every sheet empty", async () => {
    const libro = await leerLibroXlsx(await armarLibro((l) => void l.addWorksheet("vacía")));
    expect(libro.hojas).toEqual([{ nombre: "vacía", vacia: true }]);
    expect(hojaPorDefecto(libro.hojas)).toBeNull();
  });
});

describe("leerLibroXlsx -- unreadable files become a ValidationError, never a stack trace", () => {
  async function fallo(bytes: Uint8Array): Promise<unknown> {
    try {
      await leerLibroXlsx(bytes);
    } catch (error) {
      return error;
    }
    throw new Error("expected the read to fail");
  }

  it("rejects bytes that are not a zip at all", async () => {
    const error = await fallo(new TextEncoder().encode("esto no es un xlsx"));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("No se pudo leer el archivo: no parece un .xlsx válido.");
  });

  it("rejects a file with the zip signature but garbage after it", async () => {
    const basura = new Uint8Array(512);
    basura.set([0x50, 0x4b, 0x03, 0x04]);
    expect(await fallo(basura)).toBeInstanceOf(ValidationError);
  });

  it("rejects a truncated .xlsx", async () => {
    const entero = await libroConVariasHojas();
    expect(await fallo(entero.slice(0, Math.floor(entero.length / 2)))).toBeInstanceOf(ValidationError);
  });

  it("rejects an empty buffer", async () => {
    expect(await fallo(new Uint8Array(0))).toBeInstanceOf(ValidationError);
  });
});

describe("read + parse, end to end on a synthetic Crystal workbook", () => {
  it("turns the last sheet into rows with presentations flagged and control markers kept", async () => {
    const libro = await leerLibroXlsx(await libroConVariasHojas());
    const { filas, descartadas } = parsearListaCrystal(libro.leerHoja("04-26"));
    expect(filas.map((f) => [f.descripcion, f.precio, f.presentacion])).toEqual([
      ["ACEITE DE GIRASOL", "1500", null],
      ["ZINC SULFATO 7 H2O Cuñete X 25", "90000", "Cuñete X 25"],
      ["ZOLPIDEM TARTRATO Sicotrop L4", "29801.136", null],
      ["VITAMINA D 3", "180000", null],
    ]);
    expect(descartadas).toBe(1); // "Page 1 of 1"
  });
});

/**
 * `leer-xls.server.ts` (docs/specs/costos-proveedor.md R14): BIFF8 workbooks built in memory by the test-only writer
 * `tests/unit/helpers/xls-builder.ts` (no binary fixtures in the repo), read back. Covers the CFB container (regular
 * FAT, mini stream, several FAT sectors, DIFAT chain, 4096-byte sectors), the record types, strings split across
 * CONTINUE records, sheets located by their BOUNDSHEET offset, and malformed / protected / too old files, which must
 * surface as a readable `ValidationError` and must terminate.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { ValidationError } from "@/shared/errors";
import { hojaPorDefecto } from "@/modules/costos-proveedor/domain/importacion-lista";
import { parsearListaCrystal } from "@/modules/costos-proveedor/domain/parsers/lista-xlsx-crystal";
import { MENSAJES_LECTURA_XLS, leerLibroXls } from "@/modules/costos-proveedor/infrastructure/leer-xls.server";
import { leerLibroXlsx } from "@/modules/costos-proveedor/infrastructure/leer-xlsx.server";
import { armarCfb, armarFlujoBiff8, armarXls } from "./helpers/xls-builder";
import type { CeldaXls, OpcionesCfb, OpcionesFlujo } from "./helpers/xls-builder";

const TEXTO_LARGO = "Texto largo que atraviesa varios registros CONTINUE 0123456789 0123456789";
const TEXTO_LARGO_UTF16 = "Ωmega ".repeat(10);

/** Every cell type the reader handles, on one sheet; next to an empty one, a hidden one and a macro sheet. */
function opcionesCompletas(): OpcionesFlujo {
  const principal: CeldaXls[] = [
    { tipo: "sst", fila: 0, col: 0, texto: "DESCRIPCION" },
    { tipo: "sst", fila: 0, col: 1, texto: "PRECIO" },
    { tipo: "sst", fila: 1, col: 0, texto: "ACEITE DE GIRASOL" },
    { tipo: "numero", fila: 1, col: 1, valor: 1000.5 },
    { tipo: "sst", fila: 2, col: 0, texto: "ZINC Cuñete X 25" }, // compressed: ñ fits one byte
    { tipo: "rk", fila: 2, col: 1, valor: 25, modo: "entero" },
    { tipo: "sst", fila: 3, col: 0, texto: "Ω-3 Omega" }, // UTF-16 (Ω is above 0xFF)
    { tipo: "rk", fila: 3, col: 1, valor: 12.34, modo: "centesimos" },
    { tipo: "rk", fila: 3, col: 2, valor: 1.5, modo: "doble" },
    { tipo: "rk", fila: 3, col: 3, valor: 1.5, modo: "doble100" },
    { tipo: "mulrk", fila: 4, colInicial: 0, valores: [1, -2, 300] },
    { tipo: "formulaTexto", fila: 5, col: 0, texto: "VITAMINA D", conArray: true },
    { tipo: "formulaNumero", fila: 5, col: 1, valor: 0.0015 },
    { tipo: "label", fila: 6, col: 0, texto: "Etiqueta LABEL" },
    { tipo: "blank", fila: 6, col: 1 },
    { tipo: "mulblank", fila: 6, colInicial: 2, cantidad: 2 },
    { tipo: "formulaBooleano", fila: 7, col: 0, valor: true },
    { tipo: "formulaError", fila: 7, col: 1 },
    { tipo: "booleano", fila: 7, col: 2, valor: true },
    { tipo: "sst", fila: 8, col: 0, texto: "Cuñete", utf16: true }, // UTF-16 although every char fits a byte
    { tipo: "sst", fila: 9, col: 0, texto: TEXTO_LARGO },
    { tipo: "sst", fila: 10, col: 0, texto: TEXTO_LARGO_UTF16 },
  ];
  return {
    hojas: [
      { nombre: "12-23", celdas: principal, subflujoIncrustado: true },
      { nombre: "vacia", celdas: [{ tipo: "blank", fila: 0, col: 0 }] },
      { nombre: "oculta", celdas: [{ tipo: "numero", fila: 0, col: 0, valor: 7 }], visibilidad: 1 },
      { nombre: "macro", celdas: [{ tipo: "numero", fila: 0, col: 0, valor: 8 }], tipoHoja: 1 },
      { nombre: "04-26", celdas: [{ tipo: "sst", fila: 0, col: 0, texto: "ZOLPIDEM" }] },
    ],
    // Excel's real record size is 8224; a small one forces every long string to span several CONTINUE records.
    sstExtra: [{ texto: "Texto enriquecido", corridas: 2, extendido: 7 }],
    limiteSst: 64,
  };
}

const FILAS_COMPLETAS = [
  ["DESCRIPCION", "PRECIO", null, null],
  ["ACEITE DE GIRASOL", 1000.5, null, null],
  ["ZINC Cuñete X 25", 25, null, null],
  ["Ω-3 Omega", 12.34, 1.5, 0.015],
  [1, -2, 300, null],
  ["VITAMINA D", 0.0015, null, null],
  ["Etiqueta LABEL", null, null, null],
  [null, null, null, null],
  ["Cuñete", null, null, null],
  [TEXTO_LARGO, null, null, null],
  [TEXTO_LARGO_UTF16, null, null, null],
];

function contarRegistros(flujo: Uint8Array, tipo: number): number {
  const vista = new DataView(flujo.buffer, flujo.byteOffset, flujo.byteLength);
  let posicion = 0;
  let cantidad = 0;
  while (posicion + 4 <= flujo.length) {
    if (vista.getUint16(posicion, true) === tipo) cantidad += 1;
    posicion += 4 + vista.getUint16(posicion + 2, true);
  }
  return cantidad;
}

function falla(bytes: Uint8Array): ValidationError {
  try {
    leerLibroXls(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error("expected the read to fail");
}

describe("leerLibroXls -- the workbook", () => {
  it("lists the worksheets in workbook order, flagging the empty one; hidden sheets stay, macro sheets go", () => {
    const libro = leerLibroXls(armarXls(opcionesCompletas()));
    expect(libro.hojas).toEqual([
      { nombre: "12-23", vacia: false },
      { nombre: "vacia", vacia: true }, // only a BLANK cell: no value
      { nombre: "oculta", vacia: false },
      { nombre: "04-26", vacia: false },
    ]);
    expect(hojaPorDefecto(libro.hojas)).toBe("04-26");
  });

  it("reads every cell type (SST and LABEL strings, NUMBER, RK variants, MULRK, FORMULA results) and nothing else", () => {
    const libro = leerLibroXls(armarXls(opcionesCompletas()));
    expect(libro.leerHoja("12-23")).toEqual(FILAS_COMPLETAS);
    expect(libro.leerHoja("oculta")).toEqual([[7]]);
    expect(libro.leerHoja("04-26")).toEqual([["ZOLPIDEM"]]);
  });

  it("ignores the NUMBER inside an embedded chart substream", () => {
    const filas = leerLibroXls(armarXls(opcionesCompletas())).leerHoja("12-23");
    expect(filas).toHaveLength(11); // the chart's NUMBER sits at row 21: reading it would add rows
    expect(filas.every((fila) => fila.length === 4)).toBe(true);
  });

  it("reads strings that span CONTINUE records, including UTF-16 ones and ones with rich-text runs and extended data before them", () => {
    const flujo = armarFlujoBiff8(opcionesCompletas());
    expect(contarRegistros(flujo, 0x003c)).toBeGreaterThanOrEqual(4);
    const filas = leerLibroXls(armarXls(opcionesCompletas())).leerHoja("12-23");
    expect(filas[9]![0]).toBe(TEXTO_LARGO);
    expect(filas[10]![0]).toBe(TEXTO_LARGO_UTF16);
    expect(filas[3]![0]).toBe("Ω-3 Omega");
  });

  it("reads the same SST at Excel's real record size (no CONTINUE needed)", () => {
    const opciones = { ...opcionesCompletas(), limiteSst: 8224 };
    expect(contarRegistros(armarFlujoBiff8(opciones), 0x003c)).toBe(0);
    expect(leerLibroXls(armarXls(opciones)).leerHoja("12-23")).toEqual(FILAS_COMPLETAS);
  });

  it("finds each sheet by the offset in its BOUNDSHEET, not by the order of the substreams", () => {
    const opciones: OpcionesFlujo = {
      hojas: [
        { nombre: "primera", celdas: [{ tipo: "sst", fila: 0, col: 0, texto: "A" }] },
        { nombre: "segunda", celdas: [{ tipo: "sst", fila: 0, col: 0, texto: "B" }] },
        { nombre: "tercera", celdas: [{ tipo: "sst", fila: 0, col: 0, texto: "C" }] },
      ],
      ordenFisico: [2, 0, 1],
    };
    const libro = leerLibroXls(armarXls(opciones));
    expect(libro.hojas.map((h) => h.nombre)).toEqual(["primera", "segunda", "tercera"]);
    expect(libro.leerHoja("primera")).toEqual([["A"]]);
    expect(libro.leerHoja("segunda")).toEqual([["B"]]);
    expect(libro.leerHoja("tercera")).toEqual([["C"]]);
  });

  it("names the UTF-16 sheet name as it is", () => {
    const libro = leerLibroXls(armarXls({ hojas: [{ nombre: "Ω hoja", celdas: [{ tipo: "numero", fila: 0, col: 0, valor: 1 }] }] }));
    expect(libro.hojas).toEqual([{ nombre: "Ω hoja", vacia: false }]);
  });

  it("pads missing rows and cells with null so an index is a row number minus one", () => {
    const libro = leerLibroXls(armarXls({ hojas: [{ nombre: "x", celdas: [{ tipo: "label", fila: 2, col: 1, texto: "tercera fila, columna B" }] }] }));
    expect(libro.leerHoja("x")).toEqual([
      [null, null],
      [null, null],
      [null, "tercera fila, columna B"],
    ]);
  });

  it("treats an empty string and a non-finite number as empty cells; a later cell wins over an earlier one", () => {
    const libro = leerLibroXls(
      armarXls({
        hojas: [
          {
            nombre: "x",
            celdas: [
              { tipo: "label", fila: 0, col: 0, texto: "" },
              { tipo: "numero", fila: 0, col: 1, valor: Number.NaN },
              { tipo: "numero", fila: 1, col: 0, valor: 1 },
              { tipo: "numero", fila: 1, col: 0, valor: 2 },
            ],
          },
        ],
      }),
    );
    expect(libro.leerHoja("x")).toEqual([[null], [2]]);
  });

  it("rejects a sheet that does not exist, naming it, and a sheet too large to be a list", () => {
    const libro = leerLibroXls(armarXls({ hojas: [{ nombre: "x", celdas: [{ tipo: "numero", fila: 60000, col: 0, valor: 1 }] }] }));
    expect(() => libro.leerHoja("99-99")).toThrow(MENSAJES_LECTURA_XLS.hojaInexistente("99-99"));
    expect(() => libro.leerHoja("x")).toThrow(MENSAJES_LECTURA_XLS.hojaDemasiadoGrande);
  });

  it("a workbook with no data at all has every sheet empty", () => {
    const libro = leerLibroXls(armarXls({ hojas: [{ nombre: "vacía" }] }));
    expect(libro.hojas).toEqual([{ nombre: "vacía", vacia: true }]);
    expect(hojaPorDefecto(libro.hojas)).toBeNull();
    expect(libro.leerHoja("vacía")).toEqual([]);
  });

  it("returns what the xlsx reader returns for the same data (same shape for the parser)", async () => {
    const filas: (string | number | null)[][] = [
      ["DESCRIPCION", "PRECIO", "PRECIO mg"],
      ["ACEITE DE GIRASOL", 1500, null],
      ["ZINC SULFATO 7 H2O Cuñete X 25", 90000, 0.09],
    ];
    const celdas = filas.flatMap((fila, f): CeldaXls[] =>
      fila.flatMap((valor, c): CeldaXls[] => (valor === null ? [] : typeof valor === "string" ? [{ tipo: "sst", fila: f, col: c, texto: valor }] : [{ tipo: "numero", fila: f, col: c, valor }])),
    );
    const libroXls = leerLibroXls(armarXls({ hojas: [{ nombre: "04-26", celdas }] }));
    const wb = new ExcelJS.Workbook();
    const hoja = wb.addWorksheet("04-26");
    for (const fila of filas) hoja.addRow(fila);
    const libroXlsx = await leerLibroXlsx(new Uint8Array(await wb.xlsx.writeBuffer()));

    expect(libroXls.hojas).toEqual(libroXlsx.hojas);
    expect(libroXls.leerHoja("04-26")).toEqual(libroXlsx.leerHoja("04-26"));
  });

  it("read + parse, end to end on a synthetic Crystal workbook", () => {
    const celdas: CeldaXls[] = [
      { tipo: "sst", fila: 0, col: 0, texto: "DESCRIPCION" },
      { tipo: "sst", fila: 0, col: 1, texto: "PRECIO" },
      { tipo: "sst", fila: 1, col: 0, texto: "ACEITE DE GIRASOL" },
      { tipo: "numero", fila: 1, col: 1, valor: 1500 },
      { tipo: "sst", fila: 2, col: 0, texto: "ZINC SULFATO 7 H2O Cuñete X 25" },
      { tipo: "numero", fila: 2, col: 1, valor: 90000 },
      { tipo: "sst", fila: 3, col: 0, texto: "ZOLPIDEM TARTRATO  Sicotrop L4" },
      { tipo: "numero", fila: 3, col: 1, valor: 29801.136000000002 },
      { tipo: "sst", fila: 4, col: 0, texto: "Page 1 of 1" },
    ];
    const libro = leerLibroXls(armarXls({ hojas: [{ nombre: "12-23", celdas: [{ tipo: "sst", fila: 0, col: 0, texto: "x" }] }, { nombre: "04-26", celdas }] }));
    const { filas, descartadas } = parsearListaCrystal(libro.leerHoja(hojaPorDefecto(libro.hojas)!));
    expect(filas.map((f) => [f.descripcion, f.precio, f.presentacion])).toEqual([
      ["ACEITE DE GIRASOL", "1500", null],
      ["ZINC SULFATO 7 H2O Cuñete X 25", "90000", "Cuñete X 25"],
      ["ZOLPIDEM TARTRATO Sicotrop L4", "29801.136", null],
    ]);
    expect(descartadas).toBe(1);
  });
});

describe("leerLibroXls -- the container", () => {
  const celdas: CeldaXls[] = [
    { tipo: "sst", fila: 0, col: 0, texto: "DESCRIPCION" },
    { tipo: "sst", fila: 1, col: 0, texto: "Cuñete" },
    { tipo: "numero", fila: 1, col: 1, valor: 42 },
  ];
  const esperado = [["DESCRIPCION", null], ["Cuñete", 42]];

  function leer(opciones: Partial<OpcionesFlujo>, cfb: OpcionesCfb = {}) {
    const bytes = armarXls({ hojas: [{ nombre: "x", celdas }], ...opciones }, cfb);
    return { bytes, filas: leerLibroXls(bytes).leerHoja("x") };
  }

  it("reads a stream under 4096 bytes from the mini stream (mini FAT)", () => {
    const flujo = armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }] });
    expect(flujo.length).toBeLessThan(4096);
    expect(armarCfb(flujo).primerSectorFlujo).toBe(-1); // it lives in the mini stream
    expect(leer({}).filas).toEqual(esperado);
  });

  it("reads a stream of 4096 bytes or more from the regular FAT", () => {
    const flujo = armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }], relleno: 6000 });
    expect(flujo.length).toBeGreaterThanOrEqual(4096);
    expect(armarCfb(flujo).primerSectorFlujo).toBe(0);
    expect(leer({ relleno: 6000 }).filas).toEqual(esperado);
  });

  it("reads a stream that spans several FAT sectors", () => {
    const flujo = armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }], relleno: 200_000 });
    const contenedor = armarCfb(flujo);
    expect(contenedor.idsFat.length).toBeGreaterThan(2);
    expect(leer({ relleno: 200_000 }).filas).toEqual(esperado);
  });

  it("follows the DIFAT chain when the FAT needs more than the 109 entries of the header", () => {
    const contenedor = armarCfb(armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }], relleno: 7_400_000 }));
    expect(contenedor.idsFat.length).toBeGreaterThan(109);
    expect(leerLibroXls(contenedor.bytes).leerHoja("x")).toEqual(esperado);
  });

  it("reads 4096-byte-sector files, small (mini stream) and big (regular)", () => {
    expect(leer({}, { desplazamientoSector: 12 }).filas).toEqual(esperado);
    expect(leer({ relleno: 20_000 }, { desplazamientoSector: 12 }).filas).toEqual(esperado);
  });

  it("reads BIFF8 content stored in a stream named Book (what matters is the BOF version, not the stream name)", () => {
    expect(leer({}, { nombre: "Book" }).filas).toEqual(esperado);
  });
});

describe("leerLibroXls -- protected and old files", () => {
  it("refuses an encrypted workbook (FILEPASS) with its own message", () => {
    const error = falla(armarXls({ hojas: [{ nombre: "x" }], filepass: true }));
    expect(error.message).toBe(MENSAJES_LECTURA_XLS.protegido);
    expect(error.message).toBe("El archivo .xls está protegido con contraseña: quitale la protección o guardalo como .xlsx.");
  });

  it("refuses a BIFF5/7 workbook (BOF version 0x0500, stream `Book`) with its own message", () => {
    const error = falla(armarXls({ hojas: [{ nombre: "x" }], versionBof: 0x0500 }, { nombre: "Book" }));
    expect(error.message).toBe(MENSAJES_LECTURA_XLS.formatoAntiguo);
    expect(error.message).toBe("Formato .xls muy antiguo (anterior a Excel 97): guardalo como .xlsx.");
  });

  it("refuses an unknown BOF version as unreadable, not as old", () => {
    expect(falla(armarXls({ hojas: [{ nombre: "x" }], versionBof: 0x0700 })).message).toBe(MENSAJES_LECTURA_XLS.ilegible);
  });
});

describe("leerLibroXls -- malformed files become a ValidationError, never a stack trace, never a loop", () => {
  const ILEGIBLE = "No se pudo leer el archivo: no parece un .xls válido.";
  const celdas: CeldaXls[] = [{ tipo: "sst", fila: 0, col: 0, texto: "DESCRIPCION" }];

  function contenedorGrande() {
    return armarCfb(armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }], relleno: 30_000 }));
  }

  it("says what is wrong in readable Spanish", () => {
    expect(MENSAJES_LECTURA_XLS.ilegible).toBe(ILEGIBLE);
    expect(falla(new Uint8Array(0)).message).toBe(ILEGIBLE);
  });

  it("rejects bytes that are not a compound file, and a file shorter than the header", () => {
    expect(falla(new TextEncoder().encode("esto no es un xls")).message).toBe(ILEGIBLE);
    expect(falla(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])).message).toBe(ILEGIBLE);
  });

  it("rejects a file with the OLE signature but garbage after it", () => {
    const basura = new Uint8Array(4096).fill(0x7);
    basura.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(falla(basura).message).toBe(ILEGIBLE);
    const ceros = new Uint8Array(4096);
    ceros.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(falla(ceros).message).toBe(ILEGIBLE);
  });

  it("rejects truncated files, whichever half is missing", () => {
    for (const bytes of [armarXls({ hojas: [{ nombre: "x", celdas }] }), armarXls({ hojas: [{ nombre: "x", celdas }], relleno: 30_000 })]) {
      for (const largo of [bytes.length - 512, Math.floor(bytes.length * 0.75), Math.floor(bytes.length / 2), 1024, 600, 100]) {
        expect(falla(bytes.slice(0, largo)).message).toBe(ILEGIBLE);
      }
    }
  });

  it("rejects a FAT chain that loops (a sector pointing back at the stream's first one)", () => {
    const contenedor = contenedorGrande();
    new DataView(contenedor.bytes.buffer).setUint32(contenedor.offsetEntradaFat(3), 1, true);
    expect(falla(contenedor.bytes).message).toBe(ILEGIBLE);
  });

  it("rejects every sector pointing at itself (stream, directory), whatever it is chained from", () => {
    const contenedor = contenedorGrande();
    const vista = new DataView(contenedor.bytes.buffer);
    for (let sector = 0; sector < 80; sector++) vista.setUint32(contenedor.offsetEntradaFat(sector), sector, true);
    expect(falla(contenedor.bytes).message).toBe(ILEGIBLE);
  });

  it("rejects a FAT entry that points outside the file or into the special values", () => {
    for (const destino of [0x00ffffff, 0xfffffffa, 0xfffffffd, 0xffffffff]) {
      const contenedor = contenedorGrande();
      new DataView(contenedor.bytes.buffer).setUint32(contenedor.offsetEntradaFat(2), destino, true);
      expect(falla(contenedor.bytes).message).toBe(ILEGIBLE);
    }
  });

  it("rejects a stream whose declared size is larger than what its chain (or the file) holds", () => {
    const flujo = armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }], relleno: 30_000 });
    const contenedor = armarCfb(flujo);
    // The directory is the sector after the data sectors; the workbook entry is its second one, size at +120.
    const sectoresDatos = Math.ceil(flujo.length / 512);
    const entrada = (sectoresDatos + 1) * 512 + 128 + 120;
    expect(new DataView(contenedor.bytes.buffer).getUint32(entrada, true)).toBe(flujo.length);
    new DataView(contenedor.bytes.buffer).setUint32(entrada, flujo.length + 100_000, true);
    expect(falla(contenedor.bytes).message).toBe(ILEGIBLE);
  });

  it("rejects bad header fields: byte order, sector shift, FAT count, DIFAT chain that loops", () => {
    const base = () => contenedorGrande().bytes;
    const cambios: [number, number, 16 | 32][] = [
      [28, 0xfeff, 16], // byte order
      [30, 10, 16], // sector shift
      [32, 7, 16], // mini sector shift
      [44, 0, 32], // no FAT sectors
      [44, 0x7fffffff, 32], // more FAT sectors than the file can hold
      [48, 0x00ffffff, 32], // directory outside the file
    ];
    for (const [offset, valor, bits] of cambios) {
      const bytes = base();
      const vista = new DataView(bytes.buffer);
      if (bits === 16) vista.setUint16(offset, valor, true);
      else vista.setUint32(offset, valor, true);
      expect(falla(bytes).message).toBe(ILEGIBLE);
    }

    // A DIFAT chain that points at itself: the header claims one DIFAT sector, the FAT is incomplete, and the sector links to itself.
    const contenedor = armarCfb(armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }], relleno: 7_400_000 }));
    const bytes = contenedor.bytes;
    const vista = new DataView(bytes.buffer);
    const primerDifat = vista.getUint32(68, true);
    vista.setUint32((primerDifat + 1) * 512 + 127 * 4, primerDifat, true); // its link points to itself
    vista.setUint32(72, 5, true);
    // Make the FAT look longer than what the chain provides so the reader keeps walking the DIFAT.
    vista.setUint32(44, vista.getUint32(44, true) + 3, true);
    expect(falla(bytes).message).toBe(ILEGIBLE);
  });

  it("rejects a compound file without a Workbook / Book stream", () => {
    const flujo = armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }] });
    expect(falla(armarCfb(flujo, { nombre: "Otra cosa" }).bytes).message).toBe(ILEGIBLE);
  });

  it("rejects a workbook stream that is not BIFF at all, or whose records are cut short", () => {
    expect(falla(armarCfb(new Uint8Array(300).fill(0x41)).bytes).message).toBe(ILEGIBLE);
    const flujo = armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }] });
    expect(falla(armarCfb(flujo.slice(0, flujo.length - 3)).bytes).message).toBe(ILEGIBLE); // the last EOF is cut
    expect(falla(armarCfb(flujo.slice(0, 30)).bytes).message).toBe(ILEGIBLE); // a record that runs past the end
    expect(falla(armarCfb(flujo.slice(0, 4)).bytes).message).toBe(ILEGIBLE);
  });

  it("rejects a BOUNDSHEET whose offset does not point at a worksheet BOF", () => {
    const flujo = armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }] });
    const vista = new DataView(flujo.buffer);
    // BOF (4 + 16 bytes), CODEPAGE (4 + 2), then the BOUNDSHEET: its lbPlyPos is the first 4 bytes of its data.
    expect(vista.getUint16(20 + 6, true)).toBe(0x0085);
    for (const destino of [0, 7, flujo.length, 0x7fffffff]) {
      const copia = flujo.slice();
      new DataView(copia.buffer).setUint32(20 + 6 + 4, destino, true);
      expect(falla(armarCfb(copia).bytes).message).toBe(ILEGIBLE);
    }
  });

  it("rejects an SST string that claims more characters than its record (and CONTINUEs) hold", () => {
    const flujo = armarFlujoBiff8({ hojas: [{ nombre: "x", celdas }] });
    const vista = new DataView(flujo.buffer);
    let posicion = 0;
    while (vista.getUint16(posicion, true) !== 0x00fc) posicion += 4 + vista.getUint16(posicion + 2, true);
    const copia = flujo.slice();
    new DataView(copia.buffer).setUint16(posicion + 4 + 8, 5000, true); // the first string claims 5000 characters; no CONTINUE follows
    expect(falla(armarCfb(copia).bytes).message).toBe(ILEGIBLE);
  });
});

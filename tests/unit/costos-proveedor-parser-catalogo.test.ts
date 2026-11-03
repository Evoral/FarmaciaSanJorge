/**
 * openspec/specs/costos-proveedor/spec.md R16, R16b, R16c: the "Listado de precios: Catálogo" parser and the layout
 * detection. Pure: every sheet is built here from raw cell values laid out like the real export (2026-10-27): the
 * header cells and their values are NOT always in the same column.
 */
import { describe, it, expect } from "vitest";
import { ValidationError } from "@/shared/errors";
import { esListaCatalogo, parsearListaCatalogo } from "@/modules/costos-proveedor/domain/parsers/lista-catalogo";
import { parsearLista } from "@/modules/costos-proveedor/domain/parsers/parsear-lista";
import { MENSAJES_PARSER_LISTA, type FilaCruda } from "@/modules/costos-proveedor/domain/parsers/lista-xlsx-crystal";

const ANCHO = 21;

/** A row with the given cells at their column indexes, `null` elsewhere. */
function filaCon(celdas: Record<number, string | number>): FilaCruda {
  return Array.from({ length: ANCHO }, (_, columna) => celdas[columna] ?? null);
}

// As in the real file: "Codigo Producto" in A (0) with its codes in B (1), "Precio" in R (17) with its numbers in
// Q (16), "Tipo Iva" in T (19) with its letters in U (20); Descripción (4), UM (11) and Mínimo (14) aligned.
const ENCABEZADO = filaCon({ 0: "Codigo Producto", 4: "Descripción", 11: "UM", 14: "Mínimo", 17: "Precio", 19: "Tipo Iva" });

function producto(codigo: string, descripcion: string, um: string, precio: number | string | null, tipoIva = "G"): FilaCruda {
  const celdas: Record<number, string | number> = { 1: codigo, 4: descripcion, 11: um, 14: "0.001", 20: tipoIva };
  if (precio !== null) celdas[16] = precio;
  return filaCon(celdas);
}

/** The block above the header, the header, the products, a page footer, a repeated header and the closing line. */
function hoja(...productos: FilaCruda[]): FilaCruda[] {
  return [
    filaCon({}),
    filaCon({ 1: "Fecha Impresión:", 2: 46322 }),
    filaCon({ 6: "LISTADO DE PRECIOS:", 7: "CATALOGO" }),
    ENCABEZADO,
    ...productos,
    filaCon({ 16: "Page 1 of 59" }),
    ENCABEZADO,
    filaCon({ 1: "SUJETA A VARIACION DE PRECIOS SIN PREVIO AVISO.", 16: "Page 59 of 59" }),
  ];
}

describe("parsearListaCatalogo -- rows (R16b)", () => {
  it("reads the price from the column next to its header, and keeps only the rows with a product code", () => {
    const { filas, descartadas } = parsearListaCatalogo(hoja(producto("00052/000", "ACEITE DE ALMENDRAS PURO FNA VI", "L", 64664.38)));
    expect(filas).toEqual([
      {
        numeroFila: 5,
        descripcion: "ACEITE DE ALMENDRAS PURO FNA VI",
        precio: "64664.38",
        presentacion: null,
        unidadLista: { um: "L", codigo: "LITRO", porMillar: false },
        alicuotaIva: null,
      },
    ]);
    // The page footer and the closing line; blank rows and the repeated header are not counted.
    expect(descartadas).toBe(2);
  });

  it("tells base rows from presentations by the code, whatever the text says", () => {
    const { filas } = parsearListaCatalogo(
      hoja(
        producto("00052/000", "ACEITE DE ALMENDRAS PURO FNA VI", "L", 64664.38),
        producto("00052/014", "ACEITE DE ALMENDRAS PURO FNA VI Bidon X 10", "L", 60452.04),
        producto("02492/000", "JARRA GRADUADA PP <KARTELL> X 500", "UN", 9000),
        producto("90052/105", "ACEITE DE ALMENDRAS PURO FNA VI", "UN", 2742.1128000000003),
      ),
    );
    expect(filas.map((f) => f.presentacion)).toEqual([null, "Bidon X 10", null, "código 90052/105"]);
  });

  it("keeps a row whose price is missing, with precio null", () => {
    expect(parsearListaCatalogo(hoja(producto("00001/000", "BORAX", "Kg", null))).filas[0]!.precio).toBeNull();
  });

  it("collapses the layout's double spaces and keeps the control markers", () => {
    expect(parsearListaCatalogo(hoja(producto("03524/000", "ZOLPIDEM TARTRATO  Sicotrop L4", "Kg", 14278292))).filas[0]!.descripcion).toBe(
      "ZOLPIDEM TARTRATO Sicotrop L4",
    );
  });
});

describe("parsearListaCatalogo -- unit and IVA (R16c)", () => {
  const leer = (...productos: FilaCruda[]) => parsearListaCatalogo(hoja(...productos)).filas;

  it("maps Kg, G, L and UN to the catalog units", () => {
    const filas = leer(producto("1/000", "A", "Kg", 1), producto("2/000", "B", "G", 1), producto("3/000", "C", "L", 1), producto("4/000", "D", "UN", 1));
    expect(filas.map((f) => f.unidadLista?.codigo)).toEqual(["KILOGRAMO", "GRAMO", "LITRO", "UNIDAD"]);
  });

  it("turns a price per millar into the price of one unit, exactly", () => {
    const [fila] = leer(producto("00311/000", "CAPSULAS GELAT 0", "Mi", 44100));
    expect(fila).toMatchObject({ precio: "44.1", unidadLista: { um: "Mi", codigo: "UNIDAD", porMillar: true } });
    expect(leer(producto("00313/000", "CAPSULAS GELAT 000", "Mi", 129339))[0]!.precio).toBe("129.339");
  });

  it("leaves a UM without equivalent with no unit", () => {
    expect(leer(producto("1/000", "A", "CJ", 1))[0]!.unidadLista).toEqual({ um: "CJ", codigo: null, porMillar: false });
  });

  it("gives an exempt row alícuota 0 and a taxed one none (R7a inheritance)", () => {
    const filas = leer(producto("04650/000", "PARAFARM INDEX", "UN", 74612, "E"), producto("00001/000", "BORAX", "Kg", 1000, "G"));
    expect(filas.map((f) => f.alicuotaIva)).toEqual(["0", null]);
  });
});

describe("parsearLista -- layout detection (R16)", () => {
  it("reads a Catálogo sheet with the Catálogo parser", () => {
    const filas = hoja(producto("00052/000", "ACEITE DE ALMENDRAS PURO FNA VI", "L", 64664.38));
    expect(esListaCatalogo(filas)).toBe(true);
    expect(parsearLista(filas).filas[0]!.unidadLista?.codigo).toBe("LITRO");
  });

  it("reads a Lista de medicamentos sheet as before, with no unit or IVA of the list", () => {
    const filas: FilaCruda[] = [["DESCRIPCION", "PRECIO", "PRECIO mg", "mg C/IVA", "COSTO"], ["ACEITE DE GIRASOL", 1500]];
    expect(esListaCatalogo(filas)).toBe(false);
    expect(parsearLista(filas).filas).toEqual([{ numeroFila: 2, descripcion: "ACEITE DE GIRASOL", precio: "1500", presentacion: null }]);
  });

  it("refuses a sheet with neither header, naming both layouts", () => {
    expect(() => parsearLista([["nombre", "valor"], ["A", 1]])).toThrow(ValidationError);
    expect(() => parsearLista([["nombre", "valor"]])).toThrow(MENSAJES_PARSER_LISTA.sinEncabezado);
    expect(MENSAJES_PARSER_LISTA.sinEncabezado).toContain("catálogo");
  });
});

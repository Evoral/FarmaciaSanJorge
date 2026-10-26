/**
 * Reads an uploaded .xlsx supplier price list (openspec/specs/costos-proveedor/spec.md R14) with `exceljs`
 * (already a dependency; `shared/xlsx/xlsx-report.ts` WRITES workbooks with it). Its .xls twin is
 * `leer-xls.server.ts`; both return a `LibroHojas` (`./libro-hojas.ts`). Interpreting the
 * cells is the pure parser's job (`../domain/parsers/lista-xlsx-crystal.ts`); this file only turns
 * the workbook into plain values:
 *
 *   - sheet names in workbook order, each flagged when it has no data (the list arrives as one sheet
 *     per date, newest last, and an empty one may exist);
 *   - for one sheet, its rows from row 1 as raw cell values (`string | number | null`), so the index of a
 *     row is its row number minus one.
 *
 * Cell values: a FORMULA cell yields its cached result (the file was saved by Excel, which stores it;
 * a formula with no cached result is empty), rich text is joined into plain text, a hyperlink yields its
 * text; dates, booleans and error values are ignored (`null`) -- the lists carry only text and numbers.
 *
 * Anything exceljs can not read (not a zip, truncated, corrupt XML) is a `ValidationError` with a
 * user-readable message, never a stack trace. The bytes only live in memory and nothing is logged.
 */
import "server-only";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { ValidationError } from "@/shared/errors";
import type { HojaLibro } from "../domain/importacion-lista";
import type { CeldaCruda } from "../domain/parsers/lista-xlsx-crystal";
import { MAX_COLUMNAS_HOJA, MAX_FILAS_HOJA, MENSAJES_LECTURA_HOJA, type LibroHojas } from "./libro-hojas";

export const MENSAJES_LECTURA_XLSX = {
  ilegible: "No se pudo leer el archivo: no parece un .xlsx válido.",
  ...MENSAJES_LECTURA_HOJA,
} as const;

/** SHA-256 of the file's bytes, lowercase hex (the DB checks 64 hex chars, R21). */
export function hashSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A cell's content as the parser takes it. Recursive on a formula's cached result. */
function valorDeCelda(valor: ExcelJS.CellValue | undefined): CeldaCruda {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string") return valor;
  if (typeof valor === "boolean" || valor instanceof Date) return null;
  if (typeof valor !== "object") return null;
  if ("richText" in valor) return valor.richText.map((trozo) => trozo.text).join("");
  if ("formula" in valor || "sharedFormula" in valor) return valorDeCelda((valor as { result?: ExcelJS.CellValue }).result);
  if ("hyperlink" in valor) return valorDeCelda((valor as { text?: ExcelJS.CellValue }).text);
  return null;
}

/** Opens the workbook. Throws `ValidationError(MENSAJES_LECTURA_XLSX.ilegible)` for anything that is not a readable .xlsx. */
export async function leerLibroXlsx(bytes: Uint8Array): Promise<LibroHojas> {
  const libro = new ExcelJS.Workbook();
  try {
    // exceljs types `load`'s input as its own Buffer alias; a Node Buffer is what it reads at runtime.
    await libro.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  } catch {
    throw new ValidationError(MENSAJES_LECTURA_XLSX.ilegible);
  }

  const hojas = libro.worksheets.map((hoja): HojaLibro => ({ nombre: hoja.name, vacia: hoja.actualRowCount === 0 }));

  return {
    hojas,
    leerHoja(nombre) {
      const hoja = libro.getWorksheet(nombre);
      if (!hoja) throw new ValidationError(MENSAJES_LECTURA_XLSX.hojaInexistente(nombre));
      if (hoja.rowCount > MAX_FILAS_HOJA) throw new ValidationError(MENSAJES_LECTURA_XLSX.hojaDemasiadoGrande);
      try {
        const columnas = Math.min(hoja.columnCount, MAX_COLUMNAS_HOJA);
        const filas: CeldaCruda[][] = [];
        for (let numero = 1; numero <= hoja.rowCount; numero++) {
          const fila = hoja.findRow(numero);
          const celdas: CeldaCruda[] = [];
          for (let columna = 1; columna <= columnas; columna++) celdas.push(fila ? valorDeCelda(fila.getCell(columna).value) : null);
          filas.push(celdas);
        }
        return filas;
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw new ValidationError(MENSAJES_LECTURA_XLSX.ilegible);
      }
    },
  };
}

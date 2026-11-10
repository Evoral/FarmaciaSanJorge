/**
 * Reads an uploaded .xlsx spreadsheet with `exceljs`. Returns a `LibroHojas` (`./libro-hojas.ts`).
 * Interpreting domain semantics is the consumer's job; this file turns the workbook into plain values:
 *
 *   - sheet names in workbook order, each flagged when it has no data (`vacia: true`);
 *   - for one sheet, its rows from row 1 as raw cell values (`string | number | Date | null`),
 *     so the index of a row is its 1-based row number minus one.
 *
 * Cell values:
 *   - a FORMULA cell yields its cached result (the file was saved by Excel, which stores it;
 *     a formula with no cached result is empty);
 *   - rich text is joined into plain text;
 *   - a hyperlink yields its text;
 *   - booleans and error values are ignored (`null`);
 *   - dates: by default ignored (`null`) for consumers that expect text and numbers only;
 *     when `options.admitirFechas` is `true`, a Date cell yields its JS `Date` instance.
 *
 * Anything exceljs cannot read (not a zip, truncated, corrupt XML) is a `ValidationError` with a
 * user-readable message, never a stack trace. The bytes only live in memory and nothing is logged.
 */
import "server-only";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { ValidationError } from "@/shared/errors";
import {
  MAX_COLUMNAS_HOJA,
  MAX_FILAS_HOJA,
  MENSAJES_LECTURA_HOJA,
  type CeldaCruda,
  type CeldaCrudaBase,
  type HojaLibro,
  type LibroHojas,
} from "./libro-hojas";

export const MENSAJES_LECTURA_XLSX = {
  ilegible: "No se pudo leer el archivo: no parece un .xlsx válido.",
  ...MENSAJES_LECTURA_HOJA,
} as const;

/** SHA-256 of the file's bytes, lowercase hex. */
export function hashSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface LeerXlsxOptions {
  /** If true, Excel date cells are returned as JS Date instances instead of null. */
  admitirFechas?: boolean;
}

/** A cell's content as plain value. Recursive on a formula's cached result. */
function valorDeCelda(
  valor: ExcelJS.CellValue | undefined,
  admitirFechas: boolean,
): CeldaCruda {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string") return valor;
  if (valor instanceof Date) return admitirFechas ? valor : null;
  if (typeof valor === "boolean") return null;
  if (typeof valor !== "object") return null;
  if ("richText" in valor) return valor.richText.map((trozo) => trozo.text).join("");
  if ("formula" in valor || "sharedFormula" in valor) {
    return valorDeCelda((valor as { result?: ExcelJS.CellValue }).result, admitirFechas);
  }
  if ("hyperlink" in valor) {
    return valorDeCelda((valor as { text?: ExcelJS.CellValue }).text, admitirFechas);
  }
  return null;
}

/** Opens the workbook. Throws `ValidationError(MENSAJES_LECTURA_XLSX.ilegible)` for anything that is not a readable .xlsx. */
export async function leerLibroXlsx(
  bytes: Uint8Array,
  options?: { admitirFechas?: false },
): Promise<LibroHojas<CeldaCrudaBase>>;
export async function leerLibroXlsx(
  bytes: Uint8Array,
  options: { admitirFechas: true },
): Promise<LibroHojas<CeldaCruda>>;
export async function leerLibroXlsx(
  bytes: Uint8Array,
  options?: LeerXlsxOptions,
): Promise<LibroHojas<CeldaCruda>>;
export async function leerLibroXlsx(
  bytes: Uint8Array,
  options?: LeerXlsxOptions,
): Promise<LibroHojas<CeldaCruda>> {
  const admitirFechas = options?.admitirFechas === true;
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  } catch {
    throw new ValidationError(MENSAJES_LECTURA_XLSX.ilegible);
  }

  const hojas = libro.worksheets.map(
    (hoja): HojaLibro => ({ nombre: hoja.name, vacia: hoja.actualRowCount === 0 }),
  );

  return {
    hojas,
    leerHoja(nombre: string) {
      const hoja = libro.getWorksheet(nombre);
      if (!hoja) throw new ValidationError(MENSAJES_LECTURA_XLSX.hojaInexistente(nombre));
      if (hoja.rowCount > MAX_FILAS_HOJA) {
        throw new ValidationError(MENSAJES_LECTURA_XLSX.hojaDemasiadoGrande);
      }
      try {
        const columnas = Math.min(hoja.columnCount, MAX_COLUMNAS_HOJA);
        const filas: CeldaCruda[][] = [];
        for (let numero = 1; numero <= hoja.rowCount; numero++) {
          const fila = hoja.findRow(numero);
          const celdas: CeldaCruda[] = [];
          for (let columna = 1; columna <= columnas; columna++) {
            celdas.push(fila ? valorDeCelda(fila.getCell(columna).value, admitirFechas) : null);
          }
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

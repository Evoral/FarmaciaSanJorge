/**
 * What every workbook reader of the supplier price list import hands the application layer
 * (openspec/specs/costos-proveedor/spec.md R14): `leer-xlsx.server.ts` (.xlsx, exceljs) and `leer-xls.server.ts` (.xls, the
 * BIFF8 reader written in this repo). The parser (`../domain/parsers/lista-xlsx-crystal.ts`) only sees this shape, so it
 * stays format-agnostic.
 */
import type { HojaLibro } from "../domain/importacion-lista";
import type { FilaCruda } from "../domain/parsers/lista-xlsx-crystal";

/** A price list has a few thousand rows; far beyond that the sheet is not a list (and looping over it would cost). */
export const MAX_FILAS_HOJA = 50_000;
export const MAX_COLUMNAS_HOJA = 60;

export const MENSAJES_LECTURA_HOJA = {
  hojaInexistente: (nombre: string) => `La hoja «${nombre}» no existe en el archivo.`,
  hojaDemasiadoGrande: "La hoja es demasiado grande para ser una lista de precios.",
} as const;

export interface LibroHojas {
  /** In workbook order. */
  hojas: HojaLibro[];
  /** The rows of one sheet from row 1 (row N = index N-1), padded with `null` to the sheet's widest used column. Throws a `ValidationError` for an unknown sheet. */
  leerHoja(nombre: string): FilaCruda[];
}

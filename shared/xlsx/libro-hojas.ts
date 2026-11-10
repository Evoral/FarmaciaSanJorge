/**
 * Generic spreadsheet reader contracts and types for exceljs (.xlsx) and BIFF8 (.xls) readers.
 * Used by supplier price list import and stock existencia inicial import.
 */

export interface HojaLibro {
  nombre: string;
  vacia: boolean;
}

export type CeldaCrudaBase = string | number | null;
export type CeldaCruda = string | number | Date | null;
export type FilaCruda<T = CeldaCruda> = readonly T[];

/** Maximum rows and columns a sheet reader will process before throwing. */
export const MAX_FILAS_HOJA = 50_000;
export const MAX_COLUMNAS_HOJA = 60;

export const MENSAJES_LECTURA_HOJA = {
  hojaInexistente: (nombre: string) => `La hoja «${nombre}» no existe en el archivo.`,
  hojaDemasiadoGrande: "La hoja es demasiado grande para ser procesada.",
} as const;

export interface LibroHojas<T = CeldaCruda> {
  /** In workbook order. */
  hojas: HojaLibro[];
  /**
   * The rows of one sheet from row 1 (row N = index N-1), padded with `null` to the sheet's widest used column.
   * Throws a `ValidationError` for an unknown sheet.
   */
  leerHoja(nombre: string): FilaCruda<T>[];
}

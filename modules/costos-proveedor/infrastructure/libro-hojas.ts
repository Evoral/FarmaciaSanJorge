/**
 * Re-exports LibroHojas and sheet constants for costos-proveedor, delegating to shared/xlsx/libro-hojas.
 */
import type { HojaLibro } from "../domain/importacion-lista";
import type { FilaCruda } from "../domain/parsers/lista-xlsx-crystal";
import {
  MAX_COLUMNAS_HOJA,
  MAX_FILAS_HOJA,
} from "@/shared/xlsx/libro-hojas";

export { MAX_COLUMNAS_HOJA, MAX_FILAS_HOJA };

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

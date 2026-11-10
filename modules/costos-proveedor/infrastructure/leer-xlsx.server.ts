/**
 * Re-exports the generic .xlsx reader from shared/xlsx/leer-xlsx.server.
 */
import "server-only";
import {
  hashSha256,
  leerLibroXlsx,
  MENSAJES_LECTURA_XLSX as SHARED_MENSAJES,
} from "@/shared/xlsx/leer-xlsx.server";
import { MENSAJES_LECTURA_HOJA } from "./libro-hojas";

export { hashSha256, leerLibroXlsx };

export const MENSAJES_LECTURA_XLSX = {
  ...SHARED_MENSAJES,
  ...MENSAJES_LECTURA_HOJA,
} as const;

/**
 * Trust boundary for uploaded .xlsx spreadsheets.
 * Verifies file instance, size, MIME/extension and zip signature (PK\x03\x04).
 */
import { ValidationError } from "@/shared/errors";

export const MAX_XLSX_BYTES = 4 * 1024 * 1024; // 4 MiB
export const MAX_CARACTERES_NOMBRE_XLSX = 200;

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const MENSAJES_ARCHIVO_XLSX = {
  noEsArchivo: "Adjuntá un archivo de Excel (.xlsx).",
  vacio: "El archivo está vacío.",
  demasiadoGrande: `El archivo supera el máximo de ${MAX_XLSX_BYTES / (1024 * 1024)} MB.`,
  tipoIncorrecto: "El archivo debe ser una planilla de Excel (.xlsx).",
  sinFirma: "El archivo no es una planilla de Excel válida (.xlsx).",
} as const;

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

function empiezaCon(bytes: Uint8Array, firma: readonly number[]): boolean {
  return bytes.length >= firma.length && firma.every((b, i) => bytes[i] === b);
}

export interface ArchivoXlsxValidado {
  bytes: Uint8Array;
  nombreArchivo: string;
}

/** Sanitizes the file's name without path and bounds it to 200 characters. */
export function sanitizarNombreArchivoXlsx(archivo: File): string {
  const nombre = archivo.name.split(/[\\/]/).pop()?.trim() ?? "";
  return (nombre || "archivo.xlsx").slice(0, MAX_CARACTERES_NOMBRE_XLSX);
}

/**
 * Validates that the input is a valid .xlsx file within size limits with a zip signature.
 * Throws a ValidationError with a user-facing message on failure.
 */
export async function validarArchivoXlsx(archivo: unknown): Promise<ArchivoXlsxValidado> {
  if (!(archivo instanceof File)) {
    throw new ValidationError(MENSAJES_ARCHIVO_XLSX.noEsArchivo);
  }
  if (archivo.size === 0) {
    throw new ValidationError(MENSAJES_ARCHIVO_XLSX.vacio);
  }
  if (archivo.size > MAX_XLSX_BYTES) {
    throw new ValidationError(MENSAJES_ARCHIVO_XLSX.demasiadoGrande);
  }

  const nombre = archivo.name.trim().toLowerCase();
  const declaraXlsx = nombre.endsWith(".xlsx") || archivo.type === XLSX_MIME;
  if (!declaraXlsx) {
    throw new ValidationError(MENSAJES_ARCHIVO_XLSX.tipoIncorrecto);
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (!empiezaCon(bytes, ZIP_SIGNATURE)) {
    throw new ValidationError(MENSAJES_ARCHIVO_XLSX.sinFirma);
  }

  return {
    bytes,
    nombreArchivo: sanitizarNombreArchivoXlsx(archivo),
  };
}

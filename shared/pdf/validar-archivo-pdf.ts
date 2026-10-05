/**
 * Trust boundary for an uploaded PDF, shared by every PDF import (spec order
 * from docs/specs/importacion-receta-pdf.md, "Pieza 3"; the caller's
 * use-case pipeline checks the permiso BEFORE this runs):
 *
 *   1. `instanceof File`;
 *   2. `size === 0` -> error;
 *   3. `size > maxBytes` -> error, BEFORE `arrayBuffer()` (never read an
 *      oversized body into memory);
 *   4. `file.type === "application/pdf"`;
 *   5. the `%PDF-` signature within the first 1024 bytes -- the check that
 *      actually counts (type and extension are client-controlled).
 *
 * The bytes only ever live in memory and nothing is logged. No runtime
 * dependencies.
 */
import { ValidationError } from "@/shared/errors";

export interface MensajesArchivoPdf {
  noEsArchivo: string;
  vacio: string;
  demasiadoGrande: string;
  tipoIncorrecto: string;
  sinFirmaPdf: string;
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const SIGNATURE_WINDOW_BYTES = 1024;

function tieneFirmaPdf(bytes: Uint8Array): boolean {
  const limite = Math.min(bytes.length, SIGNATURE_WINDOW_BYTES) - PDF_SIGNATURE.length;
  for (let i = 0; i <= limite; i++) {
    if (PDF_SIGNATURE.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

/** Steps 1-5 above, in that order; returns the file's bytes. Throws `ValidationError` (shown verbatim in the UI) on the first failure. */
export async function validarArchivoPdf(archivo: unknown, maxBytes: number, mensajes: MensajesArchivoPdf): Promise<Uint8Array> {
  if (!(archivo instanceof File)) throw new ValidationError(mensajes.noEsArchivo);
  if (archivo.size === 0) throw new ValidationError(mensajes.vacio);
  if (archivo.size > maxBytes) throw new ValidationError(mensajes.demasiadoGrande);
  if (archivo.type !== "application/pdf") throw new ValidationError(mensajes.tipoIncorrecto);

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (!tieneFirmaPdf(bytes)) throw new ValidationError(mensajes.sinFirmaPdf);
  return bytes;
}

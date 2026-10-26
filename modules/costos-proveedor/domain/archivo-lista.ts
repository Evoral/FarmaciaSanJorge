/**
 * Trust boundary for an uploaded supplier price list (openspec/specs/costos-proveedor/spec.md
 * R14, R15). Sibling of `shared/pdf/validar-archivo-pdf.ts`: the use case's
 * pipeline checks the permiso BEFORE this runs, then, in this order:
 *
 *   1. `instanceof File`;
 *   2. `size === 0` -> error;
 *   3. `size > MAX_LISTA_BYTES` -> error, BEFORE `arrayBuffer()` (never read an
 *      oversized body into memory);
 *   4. the name ends in `.xlsx` or `.xls`, or the MIME type is the xlsx or the
 *      xls one -- browsers may send an empty or generic MIME type for a
 *      spreadsheet, so the extension is an accepted fallback;
 *   5. the signature, which decides the format: `PK\x03\x04` (an .xlsx is a zip)
 *      -> "XLSX"; `D0 CF 11 E0 A1 B1 1A E1` (an OLE2 compound file, what a
 *      BIFF8 .xls is) -> "XLS". Type and name are client-controlled, so the
 *      SIGNATURE wins: an OLE2 file named `.xlsx` is read as .xls and a zip
 *      named `.xls` as .xlsx -- a wrong extension is not an error, the content
 *      is what gets parsed (and an unreadable one fails with its own message).
 *
 * The bytes only ever live in memory and nothing is logged. No runtime
 * dependencies.
 */
import { ValidationError } from "@/shared/errors";
import { MULTIPART_MARGIN_BYTES } from "@/modules/recetas/domain/archivo-receta-pdf";

/** The two spreadsheet formats a price list can be read from (`lista_precio_proveedor.formato` also allows "PDF", unused). */
export type FormatoLista = "XLS" | "XLSX";

/**
 * 4 MiB: the real supplier list is a 2.1 MB .xls (Crystal Reports, four sheets). Its OWN limit, no longer tied to the
 * PDF imports (1 MiB, `MAX_PDF_BYTES`). `next.config.ts`'s Server Actions `bodySizeLimit` must cover it:
 * `LISTA_BODY_SIZE_LIMIT_BYTES` (this plus the multipart margin) is asserted against it by tests/unit/archivo-receta-pdf.test.ts.
 */
export const MAX_LISTA_BYTES = 4 * 1024 * 1024;

/** The body size a price list upload needs: the file plus the `multipart/form-data` framing. */
export const LISTA_BODY_SIZE_LIMIT_BYTES = MAX_LISTA_BYTES + MULTIPART_MARGIN_BYTES;

/** R15: data rows of one sheet (presentation rows included). */
export const MAX_FILAS_LISTA = 5000;

/**
 * Largest JSON the confirmation may send (R13: the whole preview payload travels in ONE Server Action body, capped by
 * `bodySizeLimit`): that limit minus a margin for the multipart framing and the action's own fields.
 */
export const MAX_CONFIRMACION_BYTES = LISTA_BODY_SIZE_LIMIT_BYTES - MULTIPART_MARGIN_BYTES;

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const XLS_MIME = "application/vnd.ms-excel";

export const MENSAJES_ARCHIVO_LISTA = {
  noEsArchivo: "Adjuntá la lista de precios del proveedor (.xls o .xlsx).",
  vacio: "El archivo está vacío.",
  demasiadoGrande: `El archivo supera el máximo de ${MAX_LISTA_BYTES / (1024 * 1024)} MB.`,
  tipoIncorrecto: "El archivo debe ser una planilla de Excel (.xls o .xlsx).",
  sinFirma: "El archivo no es una planilla de Excel válida (.xls o .xlsx).",
} as const;

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // OLE2 compound file (BIFF8 .xls)

function empiezaCon(bytes: Uint8Array, firma: readonly number[]): boolean {
  return bytes.length >= firma.length && firma.every((b, i) => bytes[i] === b);
}

export interface ArchivoListaValidado {
  bytes: Uint8Array;
  /** Detected from the signature, whatever the name or MIME type say. */
  formato: FormatoLista;
}

/** Steps 1-5 above, in that order; returns the file's bytes and format. Throws `ValidationError` (shown verbatim in the UI) on the first failure. */
export async function validarArchivoLista(archivo: unknown): Promise<ArchivoListaValidado> {
  if (!(archivo instanceof File)) throw new ValidationError(MENSAJES_ARCHIVO_LISTA.noEsArchivo);
  if (archivo.size === 0) throw new ValidationError(MENSAJES_ARCHIVO_LISTA.vacio);
  if (archivo.size > MAX_LISTA_BYTES) throw new ValidationError(MENSAJES_ARCHIVO_LISTA.demasiadoGrande);

  const nombre = archivo.name.trim().toLowerCase();
  const declaraXlsx = nombre.endsWith(".xlsx") || archivo.type === XLSX_MIME;
  const declaraXls = nombre.endsWith(".xls") || archivo.type === XLS_MIME;
  if (!declaraXlsx && !declaraXls) throw new ValidationError(MENSAJES_ARCHIVO_LISTA.tipoIncorrecto);

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (empiezaCon(bytes, OLE_SIGNATURE)) return { bytes, formato: "XLS" };
  if (empiezaCon(bytes, ZIP_SIGNATURE)) return { bytes, formato: "XLSX" };
  throw new ValidationError(MENSAJES_ARCHIVO_LISTA.sinFirma);
}

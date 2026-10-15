/**
 * Trust boundary for an uploaded supplier price list (docs/specs/costos-proveedor.md
 * R14, R15). Sibling of `shared/pdf/validar-archivo-pdf.ts`: the use case's
 * pipeline checks the permiso BEFORE this runs, then, in this order:
 *
 *   1. `instanceof File`;
 *   2. `size === 0` -> error;
 *   3. `size > MAX_LISTA_BYTES` -> error, BEFORE `arrayBuffer()` (never read an
 *      oversized body into memory);
 *   4. the name ends in `.xlsx` (or `.xls`, to give it its own message) or the
 *      MIME type is the xlsx one -- browsers may send an empty or generic MIME
 *      type for a spreadsheet, so the extension is an accepted fallback;
 *   5. the signature: `PK\x03\x04` (an .xlsx is a zip) -- the check that
 *      actually counts, type and name are client-controlled. A legacy .xls
 *      (BIFF8, `D0 CF 11 E0`) gets its own message: reading it needs a new
 *      dependency (R14), so the user saves the sheet as .xlsx.
 *
 * The bytes only ever live in memory and nothing is logged. No runtime
 * dependencies.
 */
import { ValidationError } from "@/shared/errors";
import { MAX_PDF_BYTES, SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES } from "@/modules/recetas/domain/archivo-receta-pdf";

/**
 * 1 MiB: the SAME limit as the PDF imports. Tied to them on purpose -- `next.config.ts`'s Server Actions
 * `bodySizeLimit` (`SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES` = this plus the multipart margin) must let a file of exactly
 * this size through, asserted by tests/unit/costos-proveedor-archivo.test.ts.
 */
export const MAX_LISTA_BYTES = MAX_PDF_BYTES;

/** R15: data rows of one sheet (presentation rows included). */
export const MAX_FILAS_LISTA = 5000;

/**
 * Largest JSON the confirmation may send (R13: the whole preview payload travels in ONE Server Action body, capped by
 * `bodySizeLimit`): that limit minus a margin for the multipart framing and the action's own fields.
 */
export const MAX_CONFIRMACION_BYTES = SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES - 32 * 1024;

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const MENSAJES_ARCHIVO_LISTA = {
  noEsArchivo: "Adjuntá la lista de precios del proveedor (.xlsx).",
  vacio: "El archivo está vacío.",
  demasiadoGrande: `El archivo supera el máximo de ${MAX_LISTA_BYTES / (1024 * 1024)} MB.`,
  tipoIncorrecto: "El archivo debe ser una planilla de Excel (.xlsx).",
  esXls: "Es un archivo .xls (Excel 97-2003). Abrilo en Excel y guardalo como .xlsx.",
  sinFirmaXlsx: "El archivo no es un .xlsx válido.",
} as const;

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0]; // BIFF8 (.xls) compound file

function empiezaCon(bytes: Uint8Array, firma: readonly number[]): boolean {
  return bytes.length >= firma.length && firma.every((b, i) => bytes[i] === b);
}

/** Steps 1-5 above, in that order; returns the file's bytes. Throws `ValidationError` (shown verbatim in the UI) on the first failure. */
export async function validarArchivoLista(archivo: unknown): Promise<Uint8Array> {
  if (!(archivo instanceof File)) throw new ValidationError(MENSAJES_ARCHIVO_LISTA.noEsArchivo);
  if (archivo.size === 0) throw new ValidationError(MENSAJES_ARCHIVO_LISTA.vacio);
  if (archivo.size > MAX_LISTA_BYTES) throw new ValidationError(MENSAJES_ARCHIVO_LISTA.demasiadoGrande);

  const nombre = archivo.name.trim().toLowerCase();
  const declaraXlsx = nombre.endsWith(".xlsx") || archivo.type === XLSX_MIME;
  const declaraXls = nombre.endsWith(".xls") || archivo.type === "application/vnd.ms-excel";
  if (!declaraXlsx && !declaraXls) throw new ValidationError(MENSAJES_ARCHIVO_LISTA.tipoIncorrecto);

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (empiezaCon(bytes, OLE_SIGNATURE)) throw new ValidationError(MENSAJES_ARCHIVO_LISTA.esXls);
  if (!empiezaCon(bytes, ZIP_SIGNATURE)) throw new ValidationError(MENSAJES_ARCHIVO_LISTA.sinFirmaXlsx);
  return bytes;
}

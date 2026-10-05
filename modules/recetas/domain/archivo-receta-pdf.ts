/**
 * Trust boundary for an uploaded receta PDF (docs/specs/importacion-receta-pdf.md,
 * "Pieza 3 -- Frontera de confianza"). The spec's order is mandatory:
 *
 *   1. permiso `recetas.crear` -- the use-case pipeline, BEFORE this runs
 *      (modules/recetas/application/leer-receta-pdf.ts);
 *   2. `instanceof File`;
 *   3. `size === 0` -> error;
 *   4. `size > MAX_PDF_BYTES` -> error, BEFORE `arrayBuffer()` (never read
 *      an oversized body into memory);
 *   5. `file.type === "application/pdf"`;
 *   6. the `%PDF-` signature within the first 1024 bytes -- the check that
 *      actually counts (type and extension are client-controlled).
 *
 * The bytes only ever live in memory: nothing here (or downstream) stores
 * the file, and nothing is logged (DP-24 -- it carries patient data).
 * The checks themselves live in shared/pdf/validar-archivo-pdf.ts (shared
 * with the factura de compra import).
 */
import { validarArchivoPdf } from "@/shared/pdf/validar-archivo-pdf";

/** 1 MiB. Server Actions' `bodySizeLimit` (next.config.ts) is this plus the multipart overhead margin -- see `SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES`. */
export const MAX_PDF_BYTES = 1024 * 1024;

/**
 * Room for the `multipart/form-data` framing (boundaries, part headers,
 * the action's own fields) on top of the file itself, so a file of exactly
 * `MAX_PDF_BYTES` still reaches the checks above instead of being cut off
 * by Next's body limit (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:
 * "an additional 10–20 KB is a reasonable rule of thumb").
 */
export const MULTIPART_MARGIN_BYTES = 32 * 1024;

/** What next.config.ts must set as `experimental.serverActions.bodySizeLimit` (asserted by tests/unit/archivo-receta-pdf.test.ts). */
export const SERVER_ACTIONS_BODY_SIZE_LIMIT_BYTES = MAX_PDF_BYTES + MULTIPART_MARGIN_BYTES;

/** A receta is one page; a few pages of slack, but never an unbounded document to extract. */
export const MAX_PDF_PAGINAS = 5;

export const MENSAJES_ARCHIVO_PDF = {
  noEsArchivo: "Adjuntá el PDF de la receta.",
  vacio: "El archivo está vacío.",
  demasiadoGrande: `El archivo supera el máximo de ${MAX_PDF_BYTES / (1024 * 1024)} MB.`,
  tipoIncorrecto: "El archivo debe ser un PDF.",
  sinFirmaPdf: "El archivo no es un PDF válido.",
  protegido: "PDF protegido: pide contraseña para abrirlo. Solo se pueden importar recetas que se abran sin contraseña.",
  ilegible: "No se pudo leer el PDF.",
  demasiadasPaginas: `El PDF tiene más de ${MAX_PDF_PAGINAS} páginas; no parece una receta.`,
} as const;

/** Steps 2-6 above, in that order (shared/pdf/validar-archivo-pdf.ts); returns the file's bytes. */
export async function validarArchivoRecetaPdf(archivo: unknown): Promise<Uint8Array> {
  return validarArchivoPdf(archivo, MAX_PDF_BYTES, MENSAJES_ARCHIVO_PDF);
}

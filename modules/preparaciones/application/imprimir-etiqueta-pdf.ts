/**
 * `imprimirEtiquetaPdf` (M11, FASE 8 point 8.5). The ONLY entry point
 * `app/api/preparaciones/[id]/etiqueta/pdf/route.ts` uses -- same
 * discipline as `modules/elaboracion/application/imprimir-ficha-tecnica-pdf.ts`
 * (eslint's `appBoundaryPatterns` forbids `app/**` from importing a
 * module's `infrastructure/` layer directly). Marks the etiqueta as
 * impresa (idempotent, not audited) AFTER the authorized read succeeds and
 * BEFORE rendering, so a route hit that fails mid-render still recorded
 * the print attempt -- consistent with the fact that impression itself
 * carries no audit trail either way (plan §14).
 *
 * The PDF is the SHEET (modules/etiqueta-tamanos, docs/specs/hoja-etiquetas.md) with
 * the etiqueta drawn in one cell of it. What decides the page and the spot is
 * resolved FIRST, before anything is marked as printed (R7):
 *   - the sheet of the farmacia;
 *   - the size picked in the print dialog (`tamanoId`): one that does not resolve
 *     (unknown, another tenant's, deactivated) is `NOT_FOUND`. Without one (old links)
 *     it is the first active size that fits the sheet, in the admin list's order, and
 *     none is `NOT_FOUND`. A size that does not fit the sheet is a `VALIDATION_ERROR`;
 *   - the cell (`columna`, `fila`, 1-based; missing = 1 / 1): not an integer, or outside
 *     the grid the sheet and the size make, is a `VALIDATION_ERROR`.
 *
 * WHAT is printed is the persisted `etiqueta.contenido` snapshot, parsed back
 * (`parsearContenidoEtiqueta`), so a reprint is exactly the etiqueta
 * recorded at its generation even if the médico, the DT or the farmacia's
 * data changed since (docs/specs/vencimiento-preparado.md R7). Only an
 * etiqueta stored in an older text layout that does not parse is rebuilt
 * from the preparación's data (`armarContenidoEtiqueta`), as before. A
 * preparado no longer valid is refused by `getEtiquetaParaImprimir` before
 * anything is marked (docs/specs/reserva-stock-preparacion.md R22).
 */
import { getHojaParaImprimir } from "@/modules/etiqueta-tamanos/application/get-hoja-para-imprimir";
import { getTamanoParaImprimir } from "@/modules/etiqueta-tamanos/application/get-tamano-para-imprimir";
import { listTamanosParaImprimir } from "@/modules/etiqueta-tamanos/application/list-tamanos-para-imprimir";
import { celdaValida, entraEnHoja, grillaHoja } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { getEtiquetaParaImprimir } from "./get-etiqueta-para-imprimir";
import { marcarEtiquetaImpresa } from "./marcar-etiqueta-impresa";
import { armarContenidoEtiqueta, parsearContenidoEtiqueta } from "../domain/etiqueta";
import { buildEtiquetaPdf } from "../infrastructure/etiqueta-pdf";

export interface EtiquetaPdfResult {
  preparacionId: string;
  pdf: Buffer;
}

/** What the print dialog chose, as the route reads it from the query string (raw text) -- nothing is trusted. */
export interface OpcionesEtiquetaPdf {
  tamanoId?: string;
  columna?: string;
  fila?: string;
}

export const CELDA_NO_VALIDA_MESSAGE = "La posición elegida no está en la hoja.";
export const TAMANO_NO_ENTRA_MESSAGE = "El tamaño de etiqueta no entra en la hoja.";
export const SIN_TAMANOS_MESSAGE = "No hay tamaños de etiqueta activos que entren en la hoja.";

/** A cell coordinate from the query string: missing -> 1; anything but a positive integer in plain digits is refused. */
function leerCoordenada(valor: string | undefined): number {
  if (valor === undefined || valor === "") return 1;
  if (!/^\d{1,6}$/.test(valor)) throw new ValidationError(CELDA_NO_VALIDA_MESSAGE);
  return Number(valor);
}

export async function imprimirEtiquetaPdf(preparacionId: string, opciones: OpcionesEtiquetaPdf = {}): Promise<EtiquetaPdfResult> {
  const celda = { columna: leerCoordenada(opciones.columna), fila: leerCoordenada(opciones.fila) };

  const hoja = await getHojaParaImprimir();
  let tamano;
  if (opciones.tamanoId) {
    tamano = await getTamanoParaImprimir(opciones.tamanoId);
    if (!entraEnHoja(hoja, tamano)) throw new ValidationError(TAMANO_NO_ENTRA_MESSAGE);
  } else {
    tamano = (await listTamanosParaImprimir())[0];
    if (!tamano) throw new NotFoundError(SIN_TAMANOS_MESSAGE);
  }
  if (!celdaValida(grillaHoja(hoja, tamano), celda)) throw new ValidationError(CELDA_NO_VALIDA_MESSAGE);

  const datos = await getEtiquetaParaImprimir(preparacionId);
  await marcarEtiquetaImpresa(datos.etiquetaId);
  const pdf = await buildEtiquetaPdf(parsearContenidoEtiqueta(datos.contenido) ?? armarContenidoEtiqueta(datos), tamano, hoja, celda);
  return { preparacionId, pdf };
}

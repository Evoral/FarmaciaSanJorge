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
import type { Celda, HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { getEtiquetaParaImprimir } from "./get-etiqueta-para-imprimir";
import { marcarEtiquetaImpresa } from "./marcar-etiqueta-impresa";
import { armarContenidoEtiqueta, parsearContenidoEtiqueta } from "../domain/etiqueta";
import { buildEtiquetaPdf, buildEtiquetasPdf } from "../infrastructure/etiqueta-pdf";

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

/** The size and the cell, resolved and checked against the sheet (R7): nothing is marked before every one passes. */
async function resolverColocacion(hoja: HojaEtiqueta, opciones: OpcionesEtiquetaPdf): Promise<{ tamano: EtiquetaTamano; celda: Celda }> {
  const celda = { columna: leerCoordenada(opciones.columna), fila: leerCoordenada(opciones.fila) };
  let tamano;
  if (opciones.tamanoId) {
    tamano = await getTamanoParaImprimir(opciones.tamanoId);
    if (!entraEnHoja(hoja, tamano)) throw new ValidationError(TAMANO_NO_ENTRA_MESSAGE);
  } else {
    tamano = (await listTamanosParaImprimir())[0];
    if (!tamano) throw new NotFoundError(SIN_TAMANOS_MESSAGE);
  }
  if (!celdaValida(grillaHoja(hoja, tamano), celda)) throw new ValidationError(CELDA_NO_VALIDA_MESSAGE);
  return { tamano, celda };
}

export async function imprimirEtiquetaPdf(preparacionId: string, opciones: OpcionesEtiquetaPdf = {}): Promise<EtiquetaPdfResult> {
  const hoja = await getHojaParaImprimir();
  const { tamano, celda } = await resolverColocacion(hoja, opciones);

  const datos = await getEtiquetaParaImprimir(preparacionId);
  await marcarEtiquetaImpresa(datos.etiquetaId);
  const pdf = await buildEtiquetaPdf(parsearContenidoEtiqueta(datos.contenido) ?? armarContenidoEtiqueta(datos), tamano, hoja, celda);
  return { preparacionId, pdf };
}

/** One etiqueta of the multi-etiqueta print, as the route reads it (raw text). */
export interface EtiquetaPedida extends OpcionesEtiquetaPdf {
  preparacionId: string;
}

export const SIN_ETIQUETAS_MESSAGE = "No se indicó ninguna etiqueta para imprimir.";
/** A receta has a handful of ítems; the cap only bounds a hand-made URL. */
const MAX_ETIQUETAS = 50;

/**
 * Several etiquetas in ONE PDF (the toma's single "Imprimir", docs/specs/hoja-etiquetas.md R14), in the given order,
 * sharing the sheet while they do not overlap. All or nothing: every size, cell and etiqueta is resolved before any
 * is marked as printed, so one refused etiqueta prints (and marks) none.
 */
export async function imprimirEtiquetasPdf(pedidas: readonly EtiquetaPedida[]): Promise<Buffer> {
  if (pedidas.length === 0 || pedidas.length > MAX_ETIQUETAS) throw new ValidationError(SIN_ETIQUETAS_MESSAGE);
  const hoja = await getHojaParaImprimir();

  const etiquetas = [];
  for (const pedida of pedidas) {
    const { tamano, celda } = await resolverColocacion(hoja, pedida);
    const datos = await getEtiquetaParaImprimir(pedida.preparacionId);
    etiquetas.push({ datos, tamano, celda });
  }
  for (const { datos } of etiquetas) await marcarEtiquetaImpresa(datos.etiquetaId);

  return buildEtiquetasPdf(
    etiquetas.map(({ datos, tamano, celda }) => ({ contenido: parsearContenidoEtiqueta(datos.contenido) ?? armarContenidoEtiqueta(datos), tamano, celda })),
    hoja,
  );
}

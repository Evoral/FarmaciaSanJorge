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
 * `tamanoId` is the size picked in the "Seleccionar tamaño" dialog
 * (modules/etiqueta-tamanos). It is resolved FIRST: a size that does not
 * resolve (unknown, another tenant's, deactivated) is `NOT_FOUND` and must
 * not leave the etiqueta marked as printed. Without one (old links) the
 * etiqueta is rendered on the default 100 × 42 mm.
 */
import { getTamanoParaImprimir } from "@/modules/etiqueta-tamanos/application/get-tamano-para-imprimir";
import { ETIQUETA_TAMANO_PREDETERMINADO } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { getEtiquetaParaImprimir } from "./get-etiqueta-para-imprimir";
import { marcarEtiquetaImpresa } from "./marcar-etiqueta-impresa";
import { armarContenidoEtiqueta } from "../domain/etiqueta";
import { buildEtiquetaPdf } from "../infrastructure/etiqueta-pdf";

export interface EtiquetaPdfResult {
  preparacionId: string;
  pdf: Buffer;
}

export async function imprimirEtiquetaPdf(preparacionId: string, tamanoId?: string): Promise<EtiquetaPdfResult> {
  const tamano = tamanoId ? await getTamanoParaImprimir(tamanoId) : ETIQUETA_TAMANO_PREDETERMINADO;
  const datos = await getEtiquetaParaImprimir(preparacionId);
  await marcarEtiquetaImpresa(datos.etiquetaId);
  const pdf = await buildEtiquetaPdf(armarContenidoEtiqueta(datos), tamano);
  return { preparacionId, pdf };
}

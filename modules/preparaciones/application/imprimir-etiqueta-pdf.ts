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
 */
import { getEtiquetaParaImprimir } from "./get-etiqueta-para-imprimir";
import { marcarEtiquetaImpresa } from "./marcar-etiqueta-impresa";
import { buildEtiquetaPdf } from "../infrastructure/etiqueta-pdf";

export interface EtiquetaPdfResult {
  preparacionId: string;
  pdf: Buffer;
}

export async function imprimirEtiquetaPdf(preparacionId: string): Promise<EtiquetaPdfResult> {
  const datos = await getEtiquetaParaImprimir(preparacionId);
  await marcarEtiquetaImpresa(datos.etiquetaId);
  const pdf = await buildEtiquetaPdf(datos);
  return { preparacionId, pdf };
}

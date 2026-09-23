/**
 * `imprimirFichaTecnicaPdf` (M10, FASE 7 point 7.3). The ONLY entry point
 * `app/api/fichas-tecnicas/[id]/pdf/route.ts` uses -- eslint's
 * `appBoundaryPatterns` forbids `app/**` from importing a module's
 * `infrastructure/` layer (where the actual pdfkit rendering,
 * `ficha-pdf.ts#buildFichaTecnicaPdf`, lives) directly, so this thin
 * application-layer wrapper is what the route handler calls instead --
 * same "go through application/" discipline as every other module.
 * `getFichaParaImprimir` already runs the full
 * `requireSession -> authorize('fichas.imprimir') -> zod -> tx` pipeline
 * before this function ever touches a byte of patient data.
 */
import { getFichaParaImprimir } from "./get-ficha-para-imprimir";
import { buildFichaTecnicaPdf } from "../infrastructure/ficha-pdf";

export interface FichaTecnicaPdfResult {
  fichaId: string;
  version: number;
  pdf: Buffer;
}

export async function imprimirFichaTecnicaPdf(id: string): Promise<FichaTecnicaPdfResult> {
  const ficha = await getFichaParaImprimir(id);
  const pdf = await buildFichaTecnicaPdf(ficha);
  return { fichaId: ficha.id, version: ficha.version, pdf };
}

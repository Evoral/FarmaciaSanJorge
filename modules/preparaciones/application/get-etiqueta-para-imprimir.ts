/**
 * `getEtiquetaParaImprimir` (M11, FASE 8 point 8.5). Read-only,
 * `etiquetas.imprimir` (plan §7: FAR/DT). This is the ONLY entry point the
 * etiqueta PDF route handler uses to read data -- same discipline as
 * `modules/elaboracion/application/get-ficha-para-imprimir.ts`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { NotFoundError } from "@/shared/errors";
import { getPreparacionParaEtiqueta, getEtiquetaParaImprimir as getEtiquetaParaImprimirRepo } from "../infrastructure/preparacion-repository";
import type { EtiquetaParaImprimirDatos } from "../infrastructure/preparacion-repository";

export type { EtiquetaParaImprimirDatos };

const getEtiquetaParaImprimirInput = z.object({ preparacionId: uuid });

export const getEtiquetaParaImprimirQuery = defineQuery({
  name: "etiquetas.imprimir.datos",
  permiso: "etiquetas.imprimir",
  input: getEtiquetaParaImprimirInput,
  handler: async ({ tx, session, input }): Promise<EtiquetaParaImprimirDatos> => {
    const etiqueta = await getEtiquetaParaImprimirRepo(tx, session.tenantId, input.preparacionId);
    if (!etiqueta) throw new NotFoundError("Todavía no se generó la etiqueta de esta preparación.");

    const datos = await getPreparacionParaEtiqueta(tx, session.tenantId, input.preparacionId);
    if (!datos) throw new NotFoundError("La preparación no está CONFIRMADA.");

    return { ...datos, etiquetaId: etiqueta.id, generadaEn: etiqueta.generadaEn };
  },
});

export async function getEtiquetaParaImprimir(preparacionId: string): Promise<EtiquetaParaImprimirDatos> {
  return getEtiquetaParaImprimirQuery.execute({ preparacionId });
}

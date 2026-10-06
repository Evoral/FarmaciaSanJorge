/**
 * `getTamanoParaImprimir`: resolves the size chosen in the print dialog to its
 * measures, for the etiqueta PDF route. Only an ACTIVE size of the session's
 * tenant resolves (RLS + `activo`): anything else -- unknown id, another
 * tenant's size, a deactivated one -- is `NOT_FOUND`. Gated on
 * `etiquetas.imprimir`, like the PDF itself.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { getEtiquetaTamanoActivo } from "../infrastructure/etiqueta-tamano-repository";
import type { EtiquetaTamano } from "../domain/etiqueta-tamano";

export const getTamanoParaImprimirQuery = defineQuery({
  name: "etiquetaTamanos.paraImprimir.ver",
  permiso: "etiquetas.imprimir",
  input: z.object({ tamanoId: uuid }).strict(),
  handler: async ({ tx, session, input }): Promise<EtiquetaTamano> => {
    const tamano = await getEtiquetaTamanoActivo(tx, session.tenantId, input.tamanoId);
    if (!tamano) throw new NotFoundError("El tamaño de etiqueta no existe o está dado de baja.");
    return tamano;
  },
});

export async function getTamanoParaImprimir(tamanoId: string): Promise<EtiquetaTamano> {
  return getTamanoParaImprimirQuery.execute({ tamanoId });
}

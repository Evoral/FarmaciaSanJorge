/**
 * `listTamanosParaImprimir`: the ACTIVE sizes offered in the "Seleccionar
 * tamaño" dialog when printing an etiqueta. Gated on `etiquetas.imprimir`
 * (FAR/DT), NOT on `config.ver`: whoever prints is not an administrator, and
 * must see the sizes the administrator configured.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listEtiquetaTamanosActivos } from "../infrastructure/etiqueta-tamano-repository";
import type { EtiquetaTamano } from "../domain/etiqueta-tamano";

export const listTamanosParaImprimirQuery = defineQuery({
  name: "etiquetaTamanos.paraImprimir",
  permiso: "etiquetas.imprimir",
  input: z.object({}).strict(),
  handler: async ({ tx, session }): Promise<EtiquetaTamano[]> => listEtiquetaTamanosActivos(tx, session.tenantId),
});

export async function listTamanosParaImprimir(): Promise<EtiquetaTamano[]> {
  return listTamanosParaImprimirQuery.execute({});
}

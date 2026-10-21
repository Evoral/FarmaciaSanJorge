/**
 * `getHojaParaImprimir`: the sheet the print dialogs draw their grid from and the
 * etiqueta PDF is rendered on. Gated on `etiquetas.imprimir` (FAR/DT), NOT on
 * `config.ver`: whoever prints is not an administrator.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { getEtiquetaHoja } from "../infrastructure/etiqueta-hoja-repository";
import type { HojaEtiqueta } from "../domain/etiqueta-hoja";

export const getHojaParaImprimirQuery = defineQuery({
  name: "etiquetaHoja.paraImprimir",
  permiso: "etiquetas.imprimir",
  input: z.object({}).strict(),
  handler: async ({ tx, session }): Promise<HojaEtiqueta> => getEtiquetaHoja(tx, session.tenantId),
});

export async function getHojaParaImprimir(): Promise<HojaEtiqueta> {
  return getHojaParaImprimirQuery.execute({});
}
